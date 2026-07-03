"""Lore upkeep: convert ephemeral date/session notes INTO durable topic nodes.

Ephemeral notes — daily threads (2026-01-15), `Session: …` notes, `…-sync` notes,
and captured Claude sessions — must not linger as isolated date nodes.  This module
does the real restructuring the user asked for: each ephemeral note's content is
**folded into its topic notes as a dated entry**, and the ephemeral date node is then
**removed** from Lore's store.  The graph becomes topic-centric and stays that way.

Why deletion is safe and idempotent:
  * We delete only Lore's DB/Qdrant copy — the source `.md` on disk is untouched.
    The Obsidian watcher re-ingests it, and the next upkeep pass re-folds + re-deletes.
  * Every folded entry carries a stable HTML-comment anchor (`<!-- lore:from <id> -->`).
    Before appending, we skip any entry whose anchor already exists in the topic body,
    so re-ingested date notes never duplicate content.  Steady state: date `.md` files
    live on disk; their content lives, de-duplicated and dated, inside topic nodes.
"""
import re
from .index import index_document, _parse_wikilinks, _upsert_edges
from . import qdrant_store
from . import llm

# Cap notes processed per run to keep runtime predictable.
_RUN_CAP = 500
# Max characters of a date note's body folded into a single topic entry.
_ENTRY_CHARS = 1500
# Max topics a single ephemeral note may fan out to (avoid explosion).
_MAX_TOPICS_PER_NOTE = 5

# Ephemeral title patterns.
_DATE_TITLE_RE = re.compile(r'^(session:\s*)?\d{4}[-/]\d{2}[-/]\d{2}', re.IGNORECASE)
_SYNC_SUFFIX_RE = re.compile(r'-sync$', re.IGNORECASE)
_LEADING_DATE_RE = re.compile(r'^(?:session:\s*)?(\d{4})[-/](\d{2})[-/](\d{2})', re.IGNORECASE)
_EPHEMERAL_SOURCE_TYPES = frozenset(('claude-session', 'claude-history'))
# Telemetry lines from captured CC/Codex sessions ("… post-tool event"): pure noise, no knowledge.
_EVENT_LINE_RE = re.compile(r'\b(post-tool|pre-tool|session-(start|end)|user-prompt|codex-turn|notification)\s+event\b', re.IGNORECASE)


def _is_event_log(text: str) -> bool:
    """True if a note is mostly captured session telemetry (event-trace lines) rather than
    knowledge — these date-titled captures are noise and are purged, not folded."""
    lines = [ln for ln in (text or '').splitlines() if ln.strip()]
    if not lines:
        return False
    ev = sum(1 for ln in lines if _EVENT_LINE_RE.search(ln))
    return ev / len(lines) > 0.5


def _is_ephemeral(title: str, source_type: str) -> bool:
    """Return True if this note is ephemeral (date-named, *-sync, or captured session)."""
    t = title or ''
    if _DATE_TITLE_RE.match(t):
        return True
    if _SYNC_SUFFIX_RE.search(t):
        return True
    return (source_type or '') in _EPHEMERAL_SOURCE_TYPES


def _slug(name: str) -> str:
    """Normalise a topic name into a URL-safe slug."""
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def _entry_date(title: str) -> str:
    """Extract an ISO date (YYYY-MM-DD) from an ephemeral note title, for entry headings
    and chronological sorting.  Falls back to a low sentinel when no date is present."""
    m = _LEADING_DATE_RE.match(title or '')
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return "0000-00-00"


def _camel_tokens(name: str) -> list:
    """Split a topic name into matchable tokens, keeping acronyms whole.
    'DevOps' -> ['Dev','Ops']; 'WingmanV3' -> ['Wingman','V','3']; 'LLM' -> ['LLM']."""
    return re.findall(r'[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+', name)


def _build_topic_vocab(conn, tenant: str) -> list:
    """Build the topic vocabulary from every [[wikilink]] used by ephemeral notes, plus any
    existing topic notes.  Returns [(name, slug, compiled_pattern, freq)] sorted by frequency
    desc — used to fold wikilink-less Session notes into the topics they MENTION in prose.
    Each pattern matches the name with flexible separators ('Mobile App' ~ 'MobileApp') at
    word boundaries (so 'Server' won't match inside 'observer')."""
    freq: dict[str, int] = {}
    rows = conn.execute(
        "select id, title, source_type, body from notes where tenant_id=%s", (tenant,)
    ).fetchall()
    for nid, title, stype, body in rows:
        if _is_ephemeral(title or '', stype or ''):
            for name in _parse_wikilinks(_note_text(conn, nid, body)):
                freq[name] = freq.get(name, 0) + 1
    # include already-materialised topic notes (their display title)
    for (title,) in conn.execute(
        "select title from notes where tenant_id=%s and source_type='topic'", (tenant,)
    ).fetchall():
        if title:
            freq.setdefault(title, 1)

    vocab = []
    for name, f in freq.items():
        toks = _camel_tokens(name)
        if not toks:
            continue
        body_pat = r'[\s\-]?'.join(re.escape(t) for t in toks)
        pat = re.compile(r'(?<![A-Za-z0-9])' + body_pat + r'(?![A-Za-z0-9])', re.IGNORECASE)
        vocab.append((name, _slug(name), pat, f))
    vocab.sort(key=lambda v: -v[3])
    return vocab


def _match_vocab_topics(text: str, vocab: list, limit: int) -> list:
    """Topics from `vocab` whose pattern appears in `text` (most-established first)."""
    if not text:
        return []
    hits = [name for name, _slug, pat, _f in vocab if pat.search(text)]
    return hits[:limit]


def _note_text(conn, note_id: str, body: str) -> str:
    """The note's text for topic extraction + folding. Prefer the stored original body;
    fall back to concatenated chunk text for notes ingested before the body column existed
    (the [[wikilinks]] and prose survive in chunk text)."""
    if body:
        return body
    rows = conn.execute(
        "select text from chunks where note_id=%s order by chunk_index", (note_id,)
    ).fetchall()
    return "\n".join(r[0] for r in rows if r[0]) if rows else ""


def _existing_topic_body(conn, topic_note_id: str) -> str:
    """Current stored body of a topic note, or '' if it does not exist yet."""
    row = conn.execute(
        "select body from notes where id=%s", (topic_note_id,)
    ).fetchone()
    return (row[0] if row and row[0] else "")


def _delete_note(conn, tenant: str, note_id: str) -> None:
    """Remove a note from Lore (Qdrant vectors, edges both directions, and the row).
    The source file on disk is NOT touched.

    A file-backed note gets a TOMBSTONE in folded_paths first — without it, the
    boot reconcile sees the on-disk file as "unindexed", re-indexes it, and the
    next upkeep pass folds + deletes it again, oscillating counts and burning
    embedding compute every launch. /reindex honors the tombstone (skips the
    path unless the file was modified after folding — see api.reindex)."""
    row = conn.execute(
        "select source_path from notes where id=%s", (note_id,)).fetchone()
    if row and row[0]:
        conn.execute(
            "insert into folded_paths(tenant_id, path, folded_at) values(%s,%s,now())"
            " on conflict (tenant_id, path) do update set folded_at=excluded.folded_at",
            (tenant, row[0]),
        )
    try:
        qdrant_store.delete_note(note_id)
    except Exception:
        pass  # vector store may lag; the row delete is what removes it from the graph
    conn.execute(
        "delete from edges where tenant_id=%s and (src_note_id=%s or dst_note_id=%s)",
        (tenant, note_id, note_id),
    )
    conn.execute("delete from notes where id=%s", (note_id,))  # chunks cascade


def run_upkeep(conn, embedder, tenant: str, scope: str = None,
               use_llm: bool = False, delete_source: bool = True,
               auto_classify: bool = False, classify_llm=None,
               section_threshold: int = 5, auto_file: bool = False) -> dict:
    """Convert ephemeral date/session notes into durable topic nodes.

    Algorithm (idempotent — safe to re-run; re-ingested date notes never duplicate):
      1. Find ephemeral notes: date-titled, *-sync, or source_type in
         ('claude-session', 'claude-history'), for the given tenant (+ optional scope),
         deterministically ordered.
      2. Extract topics per note: [[wikilinks]] from the body, plus (only when use_llm and
         Ollama is up) 1-3 topic names from the local LLM.
      3. Fold the note's content into each topic note as a **dated entry**
         (`## <date> — <title>` + body), de-duplicated by a stable per-source anchor.
      4. Re-index each touched topic note ONCE with its full accumulated body (edges
         recompute from the wikilinks the entries carry).
      5. Delete the now-converted ephemeral date notes from Lore (delete_source=True).

    Args:
        conn: Postgres connection (autocommit).
        embedder: Dense embedder used to index topic notes.
        tenant: Tenant namespace to operate on.
        scope: Optional ACL scope filter; when None all scopes for the tenant are used.
        use_llm: When True (and Ollama is reachable) augment wikilink topics with LLM-named
            topics. Default False — keeps the job fast and fully deterministic.
        delete_source: When True (default) remove the converted date notes from Lore.
        auto_classify: Opt-in (cfg.autoClassify). When True, tag/topic-classify untagged
            notes (classify.py) and upsert Section PROPOSALS (sections.py). Proposals are
            state only — NO files are ever moved by upkeep; the user must explicitly
            apply a section from the desktop for anything to move.
        classify_llm: injectable callable(prompt)->str for classification (tests);
            when None the configured provider is used, degrading to the deterministic
            fallback with status 'provider-unavailable' when no provider is usable.
        section_threshold: notes on one topic before a Section is proposed (default 5).
        auto_file: Opt-in (cfg.autoFileObvious, default OFF). When True, notes whose
            classification points unambiguously at ONE existing applied section are
            recorded into it and their moves returned in stats["autoFile"] — state
            only; the desktop executes the moves under its path-guard (autofile.py).

    Returns:
        {"dateNotes": int, "topics": int, "folded": int, "deleted": int, ...}
    """
    # --- Step 1: find ephemeral notes (deterministic order) ---
    base_q = (
        "select id, title, scope_id, source_type, body "
        "from notes where tenant_id=%s"
    )
    params: list = [tenant]
    if scope:
        base_q += " and scope_id=%s"
        params.append(scope)
    base_q += f" order by id limit {_RUN_CAP}"
    rows = conn.execute(base_q, params).fetchall()

    ephemeral = [
        (nid, title, scope_id, stype, body)
        for nid, title, scope_id, stype, body in rows
        if _is_ephemeral(title or '', stype or '')
    ]

    # slug -> {name, scope, entries: [(date_key, anchor, heading, text)]}
    topics_acc: dict[str, dict] = {}
    folded_source_ids: list[str] = []   # ephemeral notes that produced >=1 topic (safe to delete)
    noise_ids: list[str] = []           # pure telemetry event-log captures (purge, don't fold)

    # Check Ollama ONCE (a per-note check would do ~N socket timeouts when down → minutes hang).
    ollama_up = use_llm and llm.is_ollama_up()
    # Topic vocabulary from all wikilinks — lets us fold wikilink-less Session notes by mention.
    vocab = _build_topic_vocab(conn, tenant)

    # Reasoned-graph: extract entity-pair relations from each session note's FULL text BEFORE it
    # is folded + deleted (the richest cues live here). Edges go between the named notes (which
    # survive) and are stored with origin='capture' so the index recompute never wipes them.
    from . import relations
    _title_index = relations.build_title_index(conn, tenant)

    def _resolve_title_to_id(t):
        row = conn.execute(
            "select id from notes where lower(title)=%s and tenant_id=%s limit 1",
            (t.lower(), tenant),
        ).fetchone()
        return row[0] if row else None

    capture_edges: dict[tuple, list] = {}   # (src_id, kind) -> [(dst, conf, evidence)]

    for note_id, title, scope_id, source_type, body in ephemeral:
        # --- Step 2: extract topics ---
        text = _note_text(conn, note_id, body)
        topics = list(_parse_wikilinks(text))

        # Reasoned-graph capture: A <cue> B relations between named notes in this session's prose.
        for a_id, b_id, kind, conf, evidence in relations.extract_entity_pairs(
                text, _title_index, _resolve_title_to_id):
            capture_edges.setdefault((a_id, kind), []).append((b_id, conf, evidence))

        # Fallback for notes with no explicit [[wikilinks]] (e.g. captured Session: notes):
        # fold them into whichever known topics they mention in prose.
        if not topics:
            topics = _match_vocab_topics(text, vocab, _MAX_TOPICS_PER_NOTE)

        # No topic signal at all → if it's pure session telemetry, mark it for purge.
        if not topics and _is_event_log(text):
            noise_ids.append(note_id)
            continue

        if ollama_up and text and len(text) > 100:
            try:
                raw = llm.ollama_answer(
                    "List 1-3 durable topic names for this note. "
                    "Reply with comma-separated short nouns only, no explanation.",
                    [{"title": title or '', "text": text[:800]}],
                )
                for name in raw.split(','):
                    name = name.strip().strip('.')
                    if name and name not in topics:
                        topics.append(name)
            except Exception:
                pass  # LLM failure is non-fatal; wikilinks alone are sufficient

        if not topics:
            # No topic signal → leave it for a future pass; do NOT delete (would lose content).
            continue
        folded_source_ids.append(note_id)

        date_key = _entry_date(title or '')
        anchor = f"<!-- lore:from {note_id} -->"
        # Drop a redundant "Session: <date>"/"<date>" label that just repeats date_key.
        label = re.sub(r'^(session:\s*)?\d{4}[-/]\d{2}[-/]\d{2}\s*[—\-]?\s*', '', title or '', flags=re.IGNORECASE).strip()
        heading = f"## {date_key} — {label}" if label else f"## {date_key}"
        entry_text = (text or '').strip()
        if len(entry_text) > _ENTRY_CHARS:
            entry_text = entry_text[:_ENTRY_CHARS].rstrip() + " …"

        seen_slugs: set[str] = set()
        for topic_name in topics[:_MAX_TOPICS_PER_NOTE]:
            slug = _slug(topic_name)
            if not slug or slug in seen_slugs:
                continue
            seen_slugs.add(slug)
            acc = topics_acc.setdefault(
                slug, {"name": topic_name, "scope": scope_id, "entries": []}
            )
            acc["entries"].append((date_key, anchor, heading, entry_text))

    # --- Steps 3+4: build & index each topic note ONCE, appending only new entries ---
    folded_anchors: set[str] = set()
    topics_written = 0
    for slug, acc in topics_acc.items():
        topic_note_id = f"topic:{tenant}:{slug}"
        existing = _existing_topic_body(conn, topic_note_id)
        is_new = not existing
        if is_new:
            existing = f"# {acc['name']}\n\n_Topic node — Lore folds dated entries here automatically._\n"

        # Append entries not already present (anchor-deduped), newest first.
        new_blocks: list[tuple[str, str]] = []   # (date_key, block)
        for date_key, anchor, heading, entry_text in acc["entries"]:
            folded_anchors.add(anchor)  # source was folded (now or in a prior pass) → safe to delete
            if anchor in existing:
                continue
            block = f"\n{heading}\n{anchor}\n\n{entry_text}\n"
            new_blocks.append((date_key, block))

        if new_blocks or is_new:
            new_blocks.sort(key=lambda b: b[0], reverse=True)
            body_out = existing.rstrip() + "\n" + "".join(b for _, b in new_blocks)
            index_document(
                source_id=topic_note_id,
                title=acc["name"],
                text=body_out,
                scope_id=acc["scope"],
                owner_id="upkeep",
                tenant_id=tenant,
                embedder=embedder,
                conn=conn,
                source_type="topic",
            )
            topics_written += 1

    # --- Step 5: delete converted notes + purge telemetry noise (DB/Qdrant only; .md stays) ---
    # Delete exactly the notes that were folded into a topic above (mirrors the fold decision)
    # plus the pure event-log captures, which carry no knowledge to preserve.
    deleted = 0
    purged = 0
    if delete_source:
        for note_id in folded_source_ids:
            _delete_note(conn, tenant, note_id)
            deleted += 1
        for note_id in noise_ids:
            _delete_note(conn, tenant, note_id)
            purged += 1

    # --- Step 6: persist captured entity-pair relations (origin='capture') ---
    # These edges (between named notes in the session prose) survive the date-note deletion
    # and are not wiped by index recompute. Accumulated across ALL session notes, so each
    # (src, kind) is upserted once with its full deduped set.
    capture_count = 0
    for (src_id, kind), targets in capture_edges.items():
        deduped: dict = {}
        for dst, conf, ev in targets:
            if dst not in deduped or conf > deduped[dst][0]:
                deduped[dst] = (conf, ev)
        _upsert_edges(conn, tenant, src_id, kind,
                      [(dst, c, e) for dst, (c, e) in deduped.items()], origin="capture")
        capture_count += len(deduped)

    # --- Step 7: refresh the reasoned graph (typed relations + node importance) ---
    rel_edges = relations.backfill_relations(conn, tenant)
    relations.recompute_importance(conn, tenant)

    result = {
        "dateNotes": len(ephemeral),
        "topics": len(topics_acc),
        "folded": len(folded_anchors),
        "deleted": deleted,
        "purgedNoise": purged,
        "relations": rel_edges,
        "captureRelations": capture_count,
    }

    # --- Step 8 (opt-in): auto-classify tags/topics + propose Sections ---
    # Proposals are rows in section_proposals ONLY. Files never move here — the
    # user applies a proposed section explicitly from the desktop (sections.py).
    if auto_classify:
        from . import classify as classify_mod
        result["classify"] = classify_mod.classify_untagged(
            conn, tenant, llm_call=classify_llm, scope=scope)
    # Auto-file (opt-in, OFF by default) runs AFTER classification (fresh topics
    # count) and BEFORE propose (filed notes are claimed → never re-proposed).
    # State only: the returned moves are executed by the desktop, never here.
    if auto_file:
        from . import autofile
        result["autoFile"] = autofile.auto_file_notes(conn, tenant, scope=scope)
    if auto_classify:
        from . import sections as sections_mod
        result["sections"] = sections_mod.propose_sections(
            conn, tenant, threshold=section_threshold)

    return result
