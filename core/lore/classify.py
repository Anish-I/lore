"""Auto-classification: tags + a topic for notes that have none (upkeep opt-in).

Runs during `run_upkeep` when the caller enables auto-classify.  For each untagged
note we produce {tags:[...], topic:"..."} and store it in the `note_tags` table
(kind='tag' rows plus one kind='topic' row).  Two paths:

  * LLM (preferred): batched strict-JSON prompts via the configured provider
    (`resolve_llm_call` — codex subscription / claude subscription / BYOK).
    When `provider_available()` is false the run reports status
    'provider-unavailable' and falls through to the deterministic path.
  * Deterministic fallback: frontmatter `tags:` / `topic:`, inline #hashtags,
    and the first [[wikilink]] as the topic.  No network, fully repeatable.

SAFETY: classification writes ONLY to the note_tags table.  It never moves,
renames, or rewrites the user's files — sections built on top of these topics
are *proposals* until the user explicitly applies them (see sections.py).
"""
import json
import os
import re

from .llm_providers import resolve_llm_call, provider_available

_RUN_CAP = 80        # max untagged notes classified per upkeep run (cost/latency bound)
_BATCH_SIZE = 8      # notes per LLM call — batched to keep the run cheap
_BODY_CHARS = 500    # note text sent to the model per item
_MAX_TAGS = 6

_FM_RE = re.compile(r'^---\s*\r?\n(.*?)\r?\n---', re.DOTALL)
_FM_TAGS_INLINE = re.compile(r'^tags:\s*\[([^\]]*)\]', re.MULTILINE)
_FM_TAGS_BLOCK = re.compile(r'^tags:\s*\r?\n((?:[ \t]*-[ \t]*.+\r?\n?)+)', re.MULTILINE)
_FM_TOPIC = re.compile(r'^topic:\s*(.+)$', re.MULTILINE)
_HASHTAG = re.compile(r'(?<!\w)#([A-Za-z]\w{1,30})')
_WIKILINK = re.compile(r'\[\[([^\]|#]+?)(?:[|#][^\]]*)?\]\]')


def _norm_tag(t: str) -> str:
    """Normalise a tag to a lowercase slug ('LLM Ops' -> 'llm-ops')."""
    return re.sub(r'[^a-z0-9]+', '-', str(t or '').strip().lower()).strip('-')[:40]


def _norm_topic(t: str) -> str:
    """Normalise a topic display name (trim, collapse whitespace, cap length)."""
    return re.sub(r'\s+', ' ', str(t or '').strip())[:60]


# --- C2: canonical topic vocabulary (2026-07-21 cold-start findings) --------
# Batch-blind naming invented ~1 topic per note on a real dump (338 topics /
# 400 notes, F1 0.002 vs the owner's folders). Two fixes, both here:
#   1. the prompt SHOWS the model the existing vocabulary and asks it to pick
#      an exact known name unless nothing fits (then "NEW: <name>");
#   2. every stored topic passes through the tenant's topic_registry — surface
#      forms that collapse to the same slug key reuse the FIRST canonical
#      display name ("kalshi-bot" / "KalshiBot" → one topic, deterministically).
# The registry's first_seen also powers the auto-apply stability gate.
_VOCAB_CAP = 60


def _slug_key(name: str) -> str:
    """Aggressive normal form (mirrors topic_merge._slug_key): separators
    stripped, trailing plural 's' dropped."""
    s = re.sub(r'[^a-z0-9]+', '-', str(name or '').lower()).strip('-').replace('-', '')
    return s[:-1] if s.endswith('s') and len(s) > 3 else s


def load_vocabulary(conn, tenant: str, cap: int = _VOCAB_CAP) -> list:
    """Canonical topic names for the prompt: registry entries first (they ARE
    the canon), then any pre-registry topic tags by frequency."""
    seen, out = set(), []
    for (canonical,) in conn.execute(
            "select canonical from topic_registry where tenant_id=%s "
            "order by first_seen", (tenant,)).fetchall():
        k = _slug_key(canonical)
        if k and k not in seen:
            seen.add(k)
            out.append(canonical)
    for (tag,) in conn.execute(
            "select tag from note_tags where tenant_id=%s and kind='topic' "
            "group by tag order by count(*) desc limit %s",
            (tenant, cap)).fetchall():
        k = _slug_key(tag)
        if k and k not in seen:
            seen.add(k)
            out.append(tag)
    return out[:cap]


def canon_topic(conn, tenant: str, topic: str, source: str = 'llm') -> str:
    """Resolve a topic through the registry: same slug key → the registered
    canonical display name; unseen key → register this form as canonical.
    ADD-only; never rewrites existing registrations."""
    topic = _norm_topic(topic)
    if not topic:
        return topic
    key = _slug_key(topic)
    if not key:
        return topic
    row = conn.execute(
        "select canonical from topic_registry where tenant_id=%s and slug_key=%s",
        (tenant, key)).fetchone()
    if row:
        return row[0]
    conn.execute(
        "insert into topic_registry(tenant_id, slug_key, canonical, source) "
        "values(%s,%s,%s,%s) on conflict do nothing",
        (tenant, key, topic, source))
    return topic


def classify_fallback(title: str, body: str) -> dict:
    """Deterministic no-LLM classification from frontmatter, #hashtags, and wikilinks.

    Returns {"tags": [...], "topic": str|None}.  Repeatable and offline.
    """
    text = body or ''
    tags: list[str] = []
    topic = None

    fm = _FM_RE.match(text)
    if fm:
        head = fm.group(1)
        m = _FM_TAGS_INLINE.search(head)
        if m:
            tags.extend(p.strip().strip('\'"') for p in m.group(1).split(',') if p.strip())
        else:
            m = _FM_TAGS_BLOCK.search(head)
            if m:
                for line in m.group(1).splitlines():
                    v = line.strip().lstrip('-').strip().strip('\'"')
                    if v:
                        tags.append(v)
        m = _FM_TOPIC.search(head)
        if m:
            topic = _norm_topic(m.group(1).strip().strip('\'"'))

    tags.extend(_HASHTAG.findall(text))

    if not topic:
        m = _WIKILINK.search(text)
        if m:
            topic = _norm_topic(m.group(1))
    if not topic and tags:
        topic = _norm_topic(tags[0])

    seen, out = set(), []
    for t in tags:
        n = _norm_tag(t)
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return {"tags": out[:_MAX_TAGS], "topic": topic or None}


def _classify_prompt(items: list, vocabulary: list = None) -> str:
    """Strict-JSON batch prompt: items are (idx, title, text). When the tenant
    already has topics, the model must PICK from them or explicitly mark a
    new one — batch-blind free naming is what fragmented cold starts."""
    lines = []
    for idx, title, text in items:
        snippet = (text or '')[:_BODY_CHARS].replace('\n', ' ')
        lines.append(f'NOTE {idx}: title="{title or "(untitled)"}" text="{snippet}"')
    notes_block = "\n".join(lines)
    vocab_block = ""
    if vocabulary:
        vocab_block = (
            "KNOWN TOPICS (when a note belongs to one of these, you MUST reuse "
            "the EXACT name):\n" + "\n".join(f"- {v}" for v in vocabulary) +
            "\nOnly when NO known topic fits, propose one as \"NEW: Topic Name\". "
            "Prefer broad, durable topics over one-off names.\n\n"
        )
    return (
        "You classify notes in a personal knowledge base.\n"
        f"{vocab_block}"
        f"{notes_block}\n\n"
        "For EACH note return 1-5 short lowercase tags and ONE durable topic name "
        "(a project/subject the note belongs to, 1-4 words, title case).\n"
        'Reply with a STRICT JSON array only — no prose, no markdown fences. Each item: '
        '{"id":<note number>,"tags":["tag1","tag2"],"topic":"Topic Name"}'
    )


def parse_classification(raw: str) -> dict:
    """Parse the model's strict-JSON reply. Returns {idx: {"tags":[...], "topic":str|None}}.
    Invalid/malformed items are dropped (callers fall back deterministically)."""
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
        tags_raw = it.get("tags") if isinstance(it.get("tags"), list) else []
        tags, seen = [], set()
        for t in tags_raw:
            n = _norm_tag(t)
            if n and n not in seen:
                seen.add(n)
                tags.append(n)
        raw_topic = str(it.get("topic") or '')
        is_new = bool(re.match(r'^\s*NEW\s*:', raw_topic, re.IGNORECASE))
        topic = _norm_topic(re.sub(r'^\s*NEW\s*:\s*', '', raw_topic, flags=re.IGNORECASE)) or None
        out[idx] = {"tags": tags[:_MAX_TAGS], "topic": topic, "is_new": is_new}
    return out


def _store(conn, tenant: str, note_id: str, tags: list, topic, source: str) -> None:
    for tag in tags:
        conn.execute(
            "insert into note_tags(note_id, tenant_id, tag, kind, source) "
            "values(%s,%s,%s,'tag',%s) on conflict do nothing",
            (note_id, tenant, tag, source))
    if topic:
        # C2: every stored topic resolves through the tenant registry so
        # surface-form variants collapse to one canonical name at write time.
        topic = canon_topic(conn, tenant, topic, source)
        conn.execute(
            "insert into note_tags(note_id, tenant_id, tag, kind, source) "
            "values(%s,%s,%s,'topic',%s) on conflict do nothing",
            (note_id, tenant, topic, source))


def classify_untagged(conn, tenant: str, llm_call=None, scope: str = None,
                      limit: int = _RUN_CAP) -> dict:
    """Classify notes that have no note_tags rows yet.  Batched + capped per run.

    Args:
        llm_call: callable(prompt)->str, injectable for tests.  When None, the
            configured provider is resolved; if unavailable the run degrades to
            the deterministic fallback and reports status 'provider-unavailable'.

    Returns {"status", "notesTagged", "llmTagged", "fallbackTagged"}.
    """
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

    q = ("select n.id, n.title, n.body from notes n "
         "where n.tenant_id=%s and coalesce(n.source_type,'') != 'topic' "
         "and not exists (select 1 from note_tags t "
         "                where t.note_id=n.id and t.tenant_id=%s)")
    params = [tenant, tenant]
    if scope:
        q += " and n.scope_id=%s"
        params.append(scope)
    q += " order by n.updated_at desc, n.id limit %s"
    params.append(max(1, min(limit, _RUN_CAP)))
    rows = conn.execute(q, params).fetchall()

    llm_tagged = fallback_tagged = 0
    for start in range(0, len(rows), _BATCH_SIZE):
        batch = rows[start:start + _BATCH_SIZE]
        parsed = {}
        if llm_call is not None:
            items = [(i, title, body or '') for i, (nid, title, body) in enumerate(batch)]
            # Vocabulary reloads EVERY batch so batch N sees the topics batch
            # N-1 just registered — within-run consistency, not just cross-run.
            vocabulary = load_vocabulary(conn, tenant)
            try:
                parsed = parse_classification(llm_call(_classify_prompt(items, vocabulary)))
            except Exception:
                parsed = {}  # LLM failure is non-fatal — fall back per note below
        for i, (nid, title, body) in enumerate(batch):
            res = parsed.get(i)
            if res and (res["tags"] or res["topic"]):
                _store(conn, tenant, nid, res["tags"], res["topic"], "llm")
                llm_tagged += 1
                continue
            fb = classify_fallback(title or '', body or '')
            if fb["tags"] or fb["topic"]:
                _store(conn, tenant, nid, fb["tags"], fb["topic"], "heuristic")
                fallback_tagged += 1

    return {
        "status": status,
        "notesTagged": llm_tagged + fallback_tagged,
        "llmTagged": llm_tagged,
        "fallbackTagged": fallback_tagged,
    }
