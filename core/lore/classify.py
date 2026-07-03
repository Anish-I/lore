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


def _classify_prompt(items: list) -> str:
    """Strict-JSON batch prompt: items are (idx, title, text)."""
    lines = []
    for idx, title, text in items:
        snippet = (text or '')[:_BODY_CHARS].replace('\n', ' ')
        lines.append(f'NOTE {idx}: title="{title or "(untitled)"}" text="{snippet}"')
    notes_block = "\n".join(lines)
    return (
        "You classify notes in a personal knowledge base.\n"
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
        topic = _norm_topic(it.get("topic") or '') or None
        out[idx] = {"tags": tags[:_MAX_TAGS], "topic": topic}
    return out


def _store(conn, tenant: str, note_id: str, tags: list, topic, source: str) -> None:
    for tag in tags:
        conn.execute(
            "insert into note_tags(note_id, tenant_id, tag, kind, source) "
            "values(%s,%s,%s,'tag',%s) on conflict do nothing",
            (note_id, tenant, tag, source))
    if topic:
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
            try:
                parsed = parse_classification(llm_call(_classify_prompt(items)))
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
