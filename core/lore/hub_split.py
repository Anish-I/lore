"""Hub-topic splitting: when one topic swallows too much of a tenant, re-classify
its notes into more specific sub-topics (2026-07-28 Ellington sectioning eval).

The trigger is NUMERIC, not model-driven: a topic is a "hub" when its junk-free
note count crosses BOTH bars — share of all topic-tagged notes >= LORE_HUB_SHARE
(default 0.15) AND absolute count >= LORE_HUB_MIN_NOTES (default 30). On the
494-email Ellington eval, "Records Management" hit 108 notes (22%) at 0.56 gold
purity — a folder proposal nobody would apply. Everything below the bars is
left alone; topic_merge remains the counterweight if a split ever overshoots.

The split reuses the classify contract: batched strict-JSON calls to the
configured (cheap) provider, each note presented WITH its stored tags so the
model differentiates on evidence it already produced. The candidate vocabulary
is the tenant's existing topics (minus the hub) reloaded every batch — the C2
discipline — so hub notes converge into existing topics or a small set of NEW
sub-topics instead of fragmenting.

ADD-only posture: the note's kind='topic' row is repointed to the sub-topic
(source='split') and the hub name is preserved as a kind='tag' row, so search
and lineage keep the old handle. User files are never touched; sections built
on the new sub-topics remain proposals until explicitly applied.
"""
import json
import os
import re

from .classify import (
    _BATCH_SIZE, _BODY_CHARS, _norm_tag, _norm_topic, _slug_key,
    canon_topic, load_vocabulary,
)
from .llm_providers import provider_available, resolve_llm_call

_RUN_CAP = 160   # hub notes re-examined per run (cost bound; the rest next run)


def _share() -> float:
    try:
        return float(os.environ.get("LORE_HUB_SHARE", "0.15"))
    except ValueError:
        return 0.15


def _min_notes() -> int:
    try:
        return int(os.environ.get("LORE_HUB_MIN_NOTES", "30"))
    except ValueError:
        return 30


def enabled() -> bool:
    return os.environ.get("LORE_HUB_SPLIT", "auto").strip().lower() not in (
        "0", "false", "off")


def find_hubs(conn, tenant: str, share: float = None, min_notes: int = None) -> list:
    """[(topic, junk_free_count), ...] for topics crossing BOTH numeric bars,
    biggest first. Junk-roled notes are invisible here — they no longer count
    toward sections, so they must not trigger splits either. Deterministic."""
    share = _share() if share is None else float(share)
    min_notes = _min_notes() if min_notes is None else int(min_notes)
    rows = conn.execute(
        "select t.tag, count(*) from note_tags t "
        "where t.tenant_id=%s and t.kind='topic' "
        "and not exists (select 1 from note_tags r "
        "                where r.tenant_id = t.tenant_id and r.note_id = t.note_id "
        "                and r.kind='role' and r.tag in ('solicitation','bulk')) "
        "group by t.tag", (tenant,)).fetchall()
    total = sum(c for _t, c in rows)
    if not total:
        return []
    hubs = [(t, c) for t, c in rows if c >= min_notes and c / total >= share]
    hubs.sort(key=lambda x: (-x[1], x[0]))
    return hubs


def _split_prompt(hub: str, items: list, vocabulary: list) -> str:
    """items: (idx, title, text, tags). The model sees each note's stored tags —
    they are the cheap evidence axis that differentiates hub members."""
    lines = []
    for idx, title, text, tags in items:
        snippet = (text or '')[:_BODY_CHARS].replace('\n', ' ')
        tag_str = ", ".join(tags) if tags else "none"
        lines.append(
            f'NOTE {idx}: title="{title or "(untitled)"}" tags=[{tag_str}] text="{snippet}"')
    notes_block = "\n".join(lines)
    vocab_block = ""
    if vocabulary:
        vocab_block = (
            "EXISTING TOPICS (when a note truly belongs to one, reuse the EXACT "
            "name):\n" + "\n".join(f"- {v}" for v in vocabulary) + "\n"
            "Only when none fits, propose one as \"NEW: Topic Name\".\n\n"
        )
    return (
        f'The topic "{hub}" has grown too broad to be a useful folder. '
        "Reassign each note below to ONE more specific durable topic "
        "(1-4 words, title case) describing what the note is actually about.\n"
        f'NEVER answer "{hub}" itself, and never a vague catch-all like '
        '"General", "Miscellaneous", or "Admin".\n\n'
        f"{vocab_block}"
        f"{notes_block}\n\n"
        'Reply with a STRICT JSON array only — no prose, no markdown fences. '
        'Each item: {"id":<note number>,"topic":"Topic Name"}'
    )


def parse_split(raw: str) -> dict:
    """{idx: topic_display_name}. Malformed items are dropped (note keeps hub)."""
    m = re.search(r'\[.*\]', raw or '', re.DOTALL)
    if not m:
        return {}
    try:
        items = json.loads(m.group(0))
    except Exception:
        return {}
    out = {}
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict):
            continue
        try:
            idx = int(it.get("id"))
        except Exception:
            continue
        topic = _norm_topic(re.sub(r'^\s*NEW\s*:\s*', '', str(it.get("topic") or ''),
                                   flags=re.IGNORECASE))
        if topic:
            out[idx] = topic
    return out


def split_hub(conn, tenant: str, hub: str, llm_call, cap: int) -> dict:
    """Re-classify up to `cap` junk-free notes currently topic'd `hub`.

    A note moves only when the model names a topic whose slug key differs from
    the hub's — same-name and catch-all replies keep the note where it is.
    The hub name survives as a kind='tag' row on every moved note."""
    rows = conn.execute(
        "select t.note_id, n.title, n.body from note_tags t "
        "join notes n on n.id = t.note_id and n.tenant_id = t.tenant_id "
        "where t.tenant_id=%s and t.kind='topic' and t.tag=%s "
        "and not exists (select 1 from note_tags r "
        "                where r.tenant_id = t.tenant_id and r.note_id = t.note_id "
        "                and r.kind='role' and r.tag in ('solicitation','bulk')) "
        "order by n.updated_at desc, n.id limit %s",
        (tenant, hub, max(1, cap))).fetchall()

    hub_key = _slug_key(hub)
    hub_tag = _norm_tag(hub)
    moved = kept = 0
    for start in range(0, len(rows), _BATCH_SIZE):
        batch = rows[start:start + _BATCH_SIZE]
        tags_by_note = {
            nid: sorted(r[0] for r in conn.execute(
                "select tag from note_tags where tenant_id=%s and note_id=%s and kind='tag'",
                (tenant, nid)).fetchall())
            for nid, _t, _b in batch}
        items = [(i, title, body or '', tags_by_note[nid])
                 for i, (nid, title, body) in enumerate(batch)]
        # Vocabulary reloads EVERY batch (minus the hub) so batch N reuses the
        # sub-topics batch N-1 just registered — the split converges.
        vocabulary = [v for v in load_vocabulary(conn, tenant) if _slug_key(v) != hub_key]
        try:
            parsed = parse_split(llm_call(_split_prompt(hub, items, vocabulary)))
        except Exception:
            parsed = {}   # LLM failure is non-fatal — the whole batch keeps the hub
        for i, (nid, _title, _body) in enumerate(batch):
            topic = parsed.get(i)
            if not topic or _slug_key(topic) == hub_key:
                kept += 1
                continue
            topic = canon_topic(conn, tenant, topic, source='split')
            if _slug_key(topic) == hub_key:
                kept += 1
                continue
            conn.execute(
                "update note_tags set tag=%s, source='split' "
                "where tenant_id=%s and note_id=%s and kind='topic'",
                (topic, tenant, nid))
            if hub_tag:
                conn.execute(
                    "insert into note_tags(note_id, tenant_id, tag, kind, source) "
                    "values(%s,%s,%s,'tag','split') on conflict do nothing",
                    (nid, tenant, hub_tag))
            moved += 1
    return {"topic": hub, "examined": len(rows), "moved": moved, "kept": kept}


def split_hubs(conn, tenant: str, llm_call=None, limit: int = _RUN_CAP,
               share: float = None, min_notes: int = None) -> dict:
    """Detect hubs and split them, biggest first, within one shared run cap.

    No LLM → no split: the deterministic fallback cannot invent meaningful
    sub-topics, so the run reports 'provider-unavailable' and changes nothing."""
    status = "ok"
    if llm_call is None:
        prov = (os.environ.get("LORE_LLM_PROVIDER") or "byok").strip().lower()
        if provider_available(prov):
            try:
                llm_call = resolve_llm_call(prov)
            except Exception:
                status = "provider-unavailable"
        else:
            status = "provider-unavailable"
    hubs = find_hubs(conn, tenant, share=share, min_notes=min_notes)
    if llm_call is None or not hubs:
        return {"status": status, "hubs": [], "moved": 0}

    budget = max(1, min(int(limit), _RUN_CAP))
    results = []
    for hub, _count in hubs:
        if budget <= 0:
            break
        r = split_hub(conn, tenant, hub, llm_call, cap=budget)
        budget -= r["examined"]
        results.append(r)
    return {"status": status, "hubs": results,
            "moved": sum(r["moved"] for r in results)}
