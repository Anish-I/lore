import datetime, hashlib, os, re, uuid
from . import qdrant_store
from .chunker import chunk_markdown
from .contextualize import apply_context
from .distill import distill_md
from . import relations

# --- Edge extraction constants ---
_EDGE_CAP_FOLDER = 8    # max folder-sibling edges per note
_EDGE_CAP_TAG    = 8    # max tag-sharing edges per tag
_EDGE_CAP_TOTAL  = 24   # hard cap on total outgoing edges per note (all kinds combined)

# [[Target Title]] or [[Target Title|alias]] or [[Target#section]]
_WIKILINK_RE = re.compile(r'\[\[([^\]|#]+?)(?:[|#][^\]]*)?\]\]')
# #tag (must not be part of a longer word; e.g. "color: #fff" is excluded)
_TAG_RE = re.compile(r'(?<!\w)#([A-Za-z]\w*)')

# --- created_at derivation (the NOTE's real date, never index time) ---
# Leading YAML frontmatter block at the very top of the text.
_FM_BLOCK_RE = re.compile(r'\A---[ \t]*\n(.*?)\n---', re.DOTALL)
# `created: <date>` / `date: <date>` keys inside that block (created wins).
_FM_CREATED_RE = re.compile(
    r'^created\s*:\s*["\']?(\d{4}-\d{2}-\d{2}(?:[ T][0-9:.+Z]+)?)', re.I | re.M)
_FM_DATE_RE = re.compile(
    r'^date\s*:\s*["\']?(\d{4}-\d{2}-\d{2}(?:[ T][0-9:.+Z]+)?)', re.I | re.M)


def _parse_fm_datetime(raw):
    """Parse a frontmatter date value to a tz-aware UTC datetime, or None."""
    try:
        dt = datetime.datetime.fromisoformat(raw.strip().replace('Z', '+00:00'))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=datetime.timezone.utc)


def derive_created_at(text, mtime=None):
    """Derive a note's creation time, by precedence:
      1. frontmatter ``created:`` (then ``date:``) in the leading ``---`` block
      2. caller-passed file mtime (epoch seconds)
      3. None — the caller falls back to first-seen (now); the upsert then
         preserves that value forever (created_at is never overwritten).
    Returns a tz-aware datetime or None.
    """
    if text:
        m = _FM_BLOCK_RE.match(text[:4000])
        if m:
            block = m.group(1)
            for key_re in (_FM_CREATED_RE, _FM_DATE_RE):
                km = key_re.search(block)
                if km:
                    dt = _parse_fm_datetime(km.group(1))
                    if dt:
                        return dt
    if mtime:
        try:
            return datetime.datetime.fromtimestamp(float(mtime), tz=datetime.timezone.utc)
        except (ValueError, OSError, OverflowError):
            return None
    return None


def _chunk_id(note_id, heading_path, idx):
    return hashlib.sha1(f"{note_id}|{heading_path}|{idx}".encode()).hexdigest()[:24]


# ---------------------------------------------------------------------------
# Pure-logic helpers (no I/O; testable without DB or Qdrant)
# ---------------------------------------------------------------------------

def _parse_wikilinks(text):
    """Extract [[Target]] link targets from markdown text.  Returns a list of
    title strings (deduplicated, preserving first-seen order)."""
    seen, out = set(), []
    for m in _WIKILINK_RE.finditer(text):
        t = m.group(1).strip()
        if t and t not in seen:
            seen.add(t); out.append(t)
    return out


def _parse_tags(text):
    """Extract #tag names from markdown text.  Returns deduplicated list."""
    seen, out = set(), []
    for m in _TAG_RE.finditer(text):
        t = m.group(1)
        if t not in seen:
            seen.add(t); out.append(t)
    return out


# ---------------------------------------------------------------------------
# DB-backed edge helpers
# ---------------------------------------------------------------------------

def _resolve_wikilink_edges(conn, tenant_id, src_id, targets):
    """Resolve [[wikilink]] titles to note IDs within the same tenant.

    Only creates an edge when the target note already exists in Postgres.
    Unresolved links are dropped (not stored as dangling edges) to avoid
    cluttering the graph with phantom nodes.

    Returns list of (dst_id, weight, evidence) tuples, capped at _EDGE_CAP_TOTAL.
    """
    edges, seen = [], set()
    for title in targets:
        if len(edges) >= _EDGE_CAP_TOTAL:
            break
        row = conn.execute(
            "select id from notes where lower(title)=%s and tenant_id=%s limit 1",
            (title.lower(), tenant_id),
        ).fetchone()
        if row and row[0] != src_id and row[0] not in seen:
            seen.add(row[0])
            edges.append((row[0], 1.0, f"wikilink:{title}"))
    return edges


def _folder_edges(conn, tenant_id, src_id, path):
    """Edges to sibling notes that share the same immediate parent folder.

    Design choice: cap at _EDGE_CAP_FOLDER siblings (most-recently-updated) rather
    than creating a full clique, which would generate O(N²) edges and make graph
    traversal noisy.  Returns list of (dst_id, weight, evidence) tuples.
    """
    if not path:
        return []
    parent = os.path.dirname(str(path)).replace("\\", "/")
    if not parent:
        return []
    # Match notes whose source_path starts with the same parent directory.
    # This is an approximation that may include subdirectory files; the _EDGE_CAP_FOLDER
    # cap keeps the degree bounded regardless.
    pattern = parent + "/%"
    rows = conn.execute(
        """select id from notes
           where tenant_id=%s and id!=%s and source_path is not null
             and replace(source_path, '\\', '/') like %s
           order by updated_at desc limit %s""",
        (tenant_id, src_id, pattern, _EDGE_CAP_FOLDER),
    ).fetchall()
    return [(r[0], 0.5, f"folder:{parent}") for r in rows]


def _tag_edges(conn, tenant_id, src_id, tags):
    """Edges to notes that share at least one #tag.

    Implementation: joins chunks whose text contains the tag token (cheapest
    approximation without a dedicated tags table).  Capped at _EDGE_CAP_TAG per
    tag; total unique destinations capped at _EDGE_CAP_TOTAL.

    Returns list of (dst_id, weight, evidence) tuples.
    """
    seen, edges = set(), []
    for tag in tags:
        if len(edges) >= _EDGE_CAP_TOTAL:
            break
        rows = conn.execute(
            """select distinct n.id from notes n
               join chunks c on c.note_id = n.id
               where n.tenant_id=%s and n.id!=%s and c.text like %s
               limit %s""",
            (tenant_id, src_id, f"%#{tag}%", _EDGE_CAP_TAG),
        ).fetchall()
        for (nid,) in rows:
            if nid not in seen and len(edges) < _EDGE_CAP_TOTAL:
                seen.add(nid)
                edges.append((nid, 0.3, f"tag:#{tag}"))
    return edges


def _upsert_edges(conn, tenant_id, src_id, kind, targets, origin="index"):
    """Replace this note's outgoing edges of `kind` and `origin` with `targets`.

    Deletes the existing set of the SAME origin first (clean slate per kind+origin),
    then inserts.  The origin scoping means an index recompute ('index') never wipes
    edges captured from a since-deleted session note ('capture').
    """
    conn.execute(
        "delete from edges where tenant_id=%s and src_note_id=%s and kind=%s and origin=%s",
        (tenant_id, src_id, kind, origin),
    )
    for dst_id, weight, evidence in targets:
        conn.execute(
            """insert into edges(tenant_id, src_note_id, dst_note_id, kind, weight, evidence, origin)
               values(%s,%s,%s,%s,%s,%s,%s)
               on conflict (tenant_id, src_note_id, dst_note_id, kind)
               do update set weight=excluded.weight, evidence=excluded.evidence,
                             -- 'capture' is sticky: an edge extracted from a since-deleted
                             -- session note must never be reclaimed (and later dropped) by index.
                             origin=case when edges.origin='capture' then 'capture' else excluded.origin end,
                             updated_at=now()""",
            (tenant_id, src_id, dst_id, kind, weight, evidence, origin),
        )


# ---------------------------------------------------------------------------
# Indexing spine
# ---------------------------------------------------------------------------

# The User/Session/Agent memory-type axis (M2): WHAT KIND of memory a note is,
# orthogonal to the scope ACL (who can see it). Retrieval weights durable
# knowledge above session scratch; 'agent' is reserved for agent-written
# memories (M3 memory bus).
_SESSION_SOURCE_TYPES = frozenset(("claude-session", "codex-session", "claude-history"))


def memory_type_of(source_type: str) -> str:
    st = source_type or ""
    if st in _SESSION_SOURCE_TYPES:
        return "session"
    if st == "agent-memory":
        return "agent"
    return "durable"


def index_document(*, source_id, title, text, scope_id, owner_id, tenant_id,
                   embedder, conn, sparse_embedder=None, path=None,
                   source_type="note", content_hash=None, mtime=None):
    """Index a document (note or external source) into Postgres + Qdrant.

    This is the shared indexing spine.  index_note() reads a file then delegates
    here.  Callers with pre-normalized text (e.g. POST /ingest) call this directly.

    Args:
        source_id: Stable unique ID for the document (SHA1 of path, or caller-provided).
        title: Human-readable title.
        text: Raw markdown (or plain text) content to be chunked and embedded.
        scope_id: ACL scope for this document.
        owner_id: Owner identifier.
        tenant_id: Tenant namespace.
        embedder: Dense embedding model instance.
        conn: Postgres connection (autocommit mode).
        sparse_embedder: Optional BM25 sparse embedder; enables hybrid search when set.
        path: Filesystem path (used for folder-edge extraction; None for remote ingest).
        source_type: Provenance label ('note' or custom).
        content_hash: Optional content hash for dedup (logged but not persisted in M1).
        mtime: Optional source-file mtime (epoch seconds) — used for created_at when
            the text has no frontmatter created:/date: key.

    Returns:
        Number of indexed chunks (0 if the document produced no chunks).
    """
    # Compute and store the original body (lossless round-trip; chunk text is NOT lossless).
    body_sha256 = hashlib.sha256(text.encode()).hexdigest()

    # The note's REAL creation time (frontmatter → mtime → first-seen). Stored as an
    # ISO string (both sqlite's `timestamp` converter and PG's timestamptz parse it).
    created_dt = derive_created_at(text, mtime) \
        or datetime.datetime.now(datetime.timezone.utc)
    created_at = created_dt.isoformat(sep=" ")

    # Persist the note row unconditionally so body is always accessible via GET /notes/{id}
    # even when chunking yields 0 indexable tokens (e.g. heading-only or empty docs).
    # created_at is write-once: COALESCE keeps the existing value on every re-ingest.
    conn.execute(
        """insert into notes(id, tenant_id, owner_id, scope_id, source_path, title,
                             source_type, memory_type, body, body_sha256, content_hash,
                             created_at, updated_at)
           values(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now())
           on conflict (id) do update
           set title=excluded.title, scope_id=excluded.scope_id,
               owner_id=excluded.owner_id, source_path=excluded.source_path,
               tenant_id=excluded.tenant_id, source_type=excluded.source_type,
               memory_type=excluded.memory_type,
               body=excluded.body, body_sha256=excluded.body_sha256,
               content_hash=excluded.content_hash,
               created_at=coalesce(notes.created_at, excluded.created_at),
               updated_at=now()""",
        (source_id, tenant_id, owner_id, scope_id, path, title, source_type,
         memory_type_of(source_type),
         text, body_sha256, content_hash, created_at),
    )

    chunks = apply_context(chunk_markdown(source_id, text), title, llm=None)
    if not chunks:
        # Clear any stale chunks/vectors from a prior ingest of this note.
        conn.execute("delete from chunks where note_id=%s", (source_id,))
        qdrant_store.delete_note(source_id)
        return 0

    texts = [c.has_context_text() for c in chunks]
    vectors = embedder.embed(texts)
    qdrant_store.ensure_collection(len(vectors[0]), with_sparse=sparse_embedder is not None)
    qdrant_store.delete_note(source_id)

    # Compute sparse vectors up-front (one batch call is cheaper than per-chunk).
    sparse_vecs = None
    if sparse_embedder is not None:
        sparse_vecs = sparse_embedder.embed_sparse(texts)

    points = []
    with conn.transaction():
        conn.execute("delete from chunks where note_id=%s", (source_id,))
        for i, (c, vec, t) in enumerate(zip(chunks, vectors, texts)):
            cid = _chunk_id(source_id, c.heading_path, c.chunk_index)
            conn.execute(
                "insert into chunks(id,note_id,heading_path,text,has_context,chunk_index)"
                " values(%s,%s,%s,%s,%s,%s)",
                (cid, source_id, c.heading_path, c.text, c.has_context, c.chunk_index),
            )
            qdrant_id = str(uuid.uuid5(uuid.NAMESPACE_URL, cid))
            named_vec = {"dense": vec}
            if sparse_vecs is not None:
                named_vec["bm25"] = sparse_vecs[i]
            points.append({"id": qdrant_id, "vector": named_vec, "payload": {
                "tenant_id": tenant_id, "owner_id": owner_id, "scope_ids": [scope_id],
                "note_id": source_id, "heading_path": c.heading_path, "text": t,
                "chunk_id": cid,
                # Provenance for recall weighting: raw captured-session chunks get
                # down-weighted vs distilled knowledge (see recall.SESSION_WEIGHT).
                "source_type": source_type}})

    qdrant_store.upsert(points)

    # --- Incremental edge extraction (runs after PG transaction commits) ---
    # link: wikilinks [[Target]] resolved to note_ids within the same tenant.
    wikilink_targets = _parse_wikilinks(text)
    link_edges = _resolve_wikilink_edges(conn, tenant_id, source_id, wikilink_targets)
    _upsert_edges(conn, tenant_id, source_id, "link", link_edges)

    # folder: sibling notes sharing the same immediate parent directory.
    folder_edges = _folder_edges(conn, tenant_id, source_id, path)
    _upsert_edges(conn, tenant_id, source_id, "folder", folder_edges)

    # tag: notes sharing a #tag token (chunk-text scan).
    tag_list = _parse_tags(text)
    tag_edges = _tag_edges(conn, tenant_id, source_id, tag_list)
    _upsert_edges(conn, tenant_id, source_id, "tag", tag_edges)

    # semantic relations: typed, confidence-scored edges from the cue lexicon (reasoned graph).
    # weight column carries the confidence; evidence carries the justifying sentence.
    def _resolve_title(title):
        row = conn.execute(
            "select id from notes where lower(title)=%s and tenant_id=%s limit 1",
            (title.lower(), tenant_id),
        ).fetchone()
        return row[0] if row and row[0] != source_id else None

    title_index = relations.build_title_index(conn, tenant_id, exclude_id=source_id)
    rels = relations.extract_relations(text, _resolve_title, title_index)
    by_kind = {}
    for dst, kind, conf, evidence in rels:
        by_kind.setdefault(kind, []).append((dst, conf, evidence))
    # Upsert every relation kind (empty included) so edges the text no longer asserts are cleared.
    for kind in relations.RELATION_KINDS:
        _upsert_edges(conn, tenant_id, source_id, kind, by_kind.get(kind, []))

    return len(points)


def index_note(path, embedder, conn, owner_id, scope_id, tenant_id, sparse_embedder=None):
    """Index a markdown file into Postgres + Qdrant.

    Reads the file via distill_md, then delegates to index_document.

    Args:
        sparse_embedder: Optional SparseEmbedder instance.  When provided, BM25
            sparse vectors are computed and stored alongside the dense vectors,
            enabling hybrid search in the recall layer.  When None (default) only
            dense vectors are stored (existing behaviour, all tests green).
    """
    note_id, title, md = distill_md(path)
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        mtime = None
    return index_document(
        source_id=note_id, title=title, text=md,
        scope_id=scope_id, owner_id=owner_id, tenant_id=tenant_id,
        embedder=embedder, conn=conn, sparse_embedder=sparse_embedder,
        path=path, mtime=mtime,
    )


def backfill_created_at(conn, tenant_id):
    """Backfill created_at for notes indexed before the column existed.

    For each note with created_at IS NULL: re-derive from the source file's
    frontmatter created:/date: (via source_path, when readable) → file mtime →
    the stored body's frontmatter → the row's updated_at as a last resort.
    Never overwrites a non-NULL created_at.  Returns the number of rows updated.
    """
    rows = conn.execute(
        """select id, source_path, body, updated_at from notes
           where tenant_id=%s and created_at is null""",
        (tenant_id,),
    ).fetchall()
    updated = 0
    for nid, source_path, body, updated_at in rows:
        text, mtime = body, None
        if source_path:
            try:
                mtime = os.path.getmtime(source_path)
                with open(source_path, encoding="utf-8", errors="ignore") as f:
                    text = f.read(4000)   # frontmatter lives in the text head
            except OSError:
                pass  # source moved/unreadable → fall back to stored body / updated_at
        dt = derive_created_at(text, mtime) or updated_at \
            or datetime.datetime.now(datetime.timezone.utc)
        conn.execute(
            "update notes set created_at=%s where id=%s and created_at is null",
            (dt.isoformat(sep=" "), nid),
        )
        updated += 1
    return updated
