"""One-time store scrub: remove capture pollution the 2026-07-02 audit found.

Targets (matching the new capture-side filters in lore-capture.js, so scrubbed
noise cannot come back):
  1. Session-note bodies: drop noise "## Prompt [...]" sections — harness spans
     (<task-notification>/<system-reminder>/<local-command-caveat>), injected
     memory-context blocks, bare acks, nested-summarizer template prompts,
     exact-duplicate sections.
  2. Reindex every touched note (rewrites its chunks + Qdrant points; the new
     chunker also drops frontmatter-only fragments on the way through).
  3. Purge orphan noise chunks in OTHER notes matching the same signatures.

Usage (from repo root, backend MAY be running — uses its own connection):
    DATABASE_URL="sqlite:///$HOME/Library/Application Support/lore-desktop/lore.db" \
    QDRANT_PATH="$HOME/Library/Application Support/lore-desktop/lore-qdrant" \
    .venv/bin/python core/scripts/scrub_store.py --tenant local --dry-run
    ... then re-run without --dry-run to apply.
"""
import argparse
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

STRIP_SPANS = [
    re.compile(r"<lore-memory-context>[\s\S]*?</lore-memory-context>"),
    re.compile(r"<obsidian-memory-context>[\s\S]*?</obsidian-memory-context>"),
    re.compile(r"<task-notification>[\s\S]*?</task-notification>"),
    re.compile(r"<system-reminder>[\s\S]*?</system-reminder>"),
    re.compile(r"<local-command-caveat>[\s\S]*?</local-command-caveat>"),
]
ACK_RE = re.compile(
    r"^(y|yes|no|ok|okay|sure|continue|keep going|do it|go|thanks|ty|yep|nope)[.! ]*$", re.I)
TEMPLATE_RES = [
    re.compile(r"You summarize one Claude Code conversation turn", re.I),
    re.compile(r"UNTRUSTED DATA to (be )?summariz", re.I),
]
# Chunk-level purge signatures (for chunks in notes we do NOT rewrite).
CHUNK_NOISE_RES = TEMPLATE_RES + [
    re.compile(r"<task-notification>|task-id>|tool-use-id>", re.I),
]

SESSION_TYPES = ("claude-session", "codex-session", "claude-history")


def clean_span_noise(text: str) -> str:
    for rx in STRIP_SPANS:
        text = rx.sub("", text)
    return text


def scrub_session_body(body: str):
    """Rewrite a session note body, dropping noise sections. Returns (new_body, dropped)."""
    # Split into sections on '## ' headings, keeping any preamble.
    parts = re.split(r"(?m)^(?=## )", body)
    kept, seen, dropped = [], set(), 0
    for part in parts:
        cleaned = clean_span_noise(part).strip()
        # Content below the heading line:
        content = re.sub(r"(?m)^##[^\n]*\n?", "", cleaned).strip()
        is_section = part.lstrip().startswith("## ")
        if is_section:
            noisy = (
                len(content) < 15
                or ACK_RE.match(content)
                or any(rx.search(content) for rx in TEMPLATE_RES)
            )
            key = " ".join(content.lower().split())
            if noisy or (key and key in seen):
                dropped += 1
                continue
            if key:
                seen.add(key)
        if cleaned:
            kept.append(cleaned)
    return ("\n\n".join(kept).strip() + "\n"), dropped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tenant", default="local")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    from lore import db, qdrant_store
    from lore.index import index_document
    from lore.embed import LocalEmbedder, LocalSparseEmbedder

    conn = db.connect()
    db.bootstrap_schema(conn)

    # ---- 1. session notes: rewrite bodies ----
    rows = conn.execute(
        "select id, title, scope_id, owner_id, body from notes"
        " where tenant_id=%s and source_type in (%s,%s,%s)",
        (args.tenant, *SESSION_TYPES),
    ).fetchall()
    to_rewrite = []
    for nid, title, scope_id, owner_id, body in rows:
        new_body, dropped = scrub_session_body(body or "")
        if dropped or len(new_body) != len(body or ""):
            to_rewrite.append((nid, title, scope_id, owner_id, new_body, dropped,
                               len(body or ""), len(new_body)))
    print(f"session notes needing rewrite: {len(to_rewrite)}/{len(rows)}")
    for r in to_rewrite:
        print(f"  {r[1]!r}: dropped {r[5]} noise sections, {r[6]} -> {r[7]} chars")

    # ---- 2. non-session notes whose BODIES carry the noise (upkeep already
    # folded captured sessions into topic notes, so the pollution lives there
    # too). Chunk-purge alone would resurrect on the next reindex — rewrite the
    # body sections instead, with the same filters.
    rewrite_ids = {r[0] for r in to_rewrite}
    body_noise = []
    for nid, title, scope_id, owner_id, st, body in conn.execute(
            "select id, title, scope_id, owner_id, source_type, body from notes"
            " where tenant_id=%s and source_type not in (%s,%s,%s)",
            (args.tenant, *SESSION_TYPES)).fetchall():
        if nid in rewrite_ids or not body:
            continue
        if any(rx.search(body) for rx in TEMPLATE_RES) or any(rx.search(body) for rx in STRIP_SPANS):
            new_body, dropped = scrub_session_body(body)
            body_noise.append((nid, title, scope_id, owner_id, st, new_body, dropped,
                               len(body), len(new_body)))
    print(f"non-session notes with noise in body: {len(body_noise)}")
    for r in body_noise:
        print(f"  {r[1]!r} [{r[4]}]: dropped {r[6]} sections, {r[7]} -> {r[8]} chars")

    # ---- 3. stray noise chunks not covered by either rewrite set ----
    noise_chunks = []
    for cid, note_id, text in conn.execute(
            "select c.id, c.note_id, c.text from chunks c join notes n on n.id=c.note_id"
            " where n.tenant_id=%s", (args.tenant,)).fetchall():
        if any(rx.search(text or "") for rx in CHUNK_NOISE_RES):
            noise_chunks.append((cid, note_id))
    covered = rewrite_ids | {r[0] for r in body_noise}
    extra = [(cid, nid) for cid, nid in noise_chunks if nid not in covered]
    print(f"noise chunks: {len(noise_chunks)} total; {len(extra)} outside rewritten notes")

    if args.dry_run:
        print("\nDRY RUN — nothing changed.")
        return

    embedder = LocalEmbedder()
    try:
        sparse = LocalSparseEmbedder()
    except Exception:
        sparse = None

    # Rewrite + reindex session notes (index_document replaces chunks + points).
    for nid, title, scope_id, owner_id, new_body, dropped, _b, _a in to_rewrite:
        index_document(
            source_id=nid, title=title, text=new_body, scope_id=scope_id,
            owner_id=owner_id, tenant_id=args.tenant, embedder=embedder,
            conn=conn, source_type="claude-session", sparse_embedder=sparse,
        )
        print(f"reindexed {title!r} (-{dropped} sections)")

    # Rewrite + reindex non-session notes that carried folded noise.
    for nid, title, scope_id, owner_id, st, new_body, dropped, _b, _a in body_noise:
        index_document(
            source_id=nid, title=title, text=new_body, scope_id=scope_id,
            owner_id=owner_id, tenant_id=args.tenant, embedder=embedder,
            conn=conn, source_type=st, sparse_embedder=sparse,
        )
        print(f"reindexed {title!r} [{st}] (-{dropped} sections)")

    # Purge stray noise chunks outside those notes (chunk row + its Qdrant point).
    import uuid
    for cid, _nid in extra:
        conn.execute("delete from chunks where id=%s", (cid,))
        try:
            qid = str(uuid.uuid5(uuid.NAMESPACE_URL, cid))
            qdrant_store._client.delete(qdrant_store.COLLECTION, points_selector=[qid])
        except Exception as e:
            print(f"  (qdrant delete failed for {cid}: {e})")
    if extra:
        print(f"purged {len(extra)} stray noise chunks")

    print("\nDONE.")


if __name__ == "__main__":
    main()
