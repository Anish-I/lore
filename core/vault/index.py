import hashlib, uuid
from . import qdrant_store
from .chunker import chunk_markdown
from .contextualize import apply_context
from .distill import distill_md

def _chunk_id(note_id, heading_path, idx):
    return hashlib.sha1(f"{note_id}|{heading_path}|{idx}".encode()).hexdigest()[:24]

def index_note(path, embedder, conn, owner_id, scope_id, tenant_id, sparse_embedder=None):
    """Index a markdown note into Postgres + Qdrant.

    Args:
        sparse_embedder: Optional SparseEmbedder instance.  When provided, BM25
            sparse vectors are computed and stored alongside the dense vectors,
            enabling hybrid search in the recall layer.  When None (default) only
            dense vectors are stored (existing behaviour, all tests green).
    """
    note_id, title, md = distill_md(path)
    chunks = apply_context(chunk_markdown(note_id, md), title, llm=None)
    if not chunks:
        return 0
    texts = [c.has_context_text() for c in chunks]
    vectors = embedder.embed(texts)
    qdrant_store.ensure_collection(len(vectors[0]), with_sparse=sparse_embedder is not None)
    qdrant_store.delete_note(note_id)

    # Compute sparse vectors up-front (one batch call is cheaper than per-chunk).
    sparse_vecs = None
    if sparse_embedder is not None:
        sparse_vecs = sparse_embedder.embed_sparse(texts)

    points = []
    with conn.transaction():
        conn.execute("insert into notes(id,tenant_id,owner_id,scope_id,source_path,title) values(%s,%s,%s,%s,%s,%s) on conflict (id) do update set title=excluded.title",
                     (note_id, tenant_id, owner_id, scope_id, path, title))
        conn.execute("delete from chunks where note_id=%s", (note_id,))
        for i, (c, vec, text) in enumerate(zip(chunks, vectors, texts)):
            cid = _chunk_id(note_id, c.heading_path, c.chunk_index)
            conn.execute("insert into chunks(id,note_id,heading_path,text,has_context,chunk_index) values(%s,%s,%s,%s,%s,%s)",
                         (cid, note_id, c.heading_path, c.text, c.has_context, c.chunk_index))
            # Use UUID derived from chunk_id as Qdrant point ID (Qdrant requires UUID or uint, not hex strings)
            qdrant_id = str(uuid.uuid5(uuid.NAMESPACE_URL, cid))
            named_vec: dict = {"dense": vec}
            if sparse_vecs is not None:
                named_vec["bm25"] = sparse_vecs[i]
            points.append({"id": qdrant_id, "vector": named_vec, "payload": {
                "tenant_id": tenant_id, "owner_id": owner_id, "scope_ids": [scope_id],
                "note_id": note_id, "heading_path": c.heading_path, "text": c.text, "chunk_id": cid}})
    qdrant_store.upsert(points)
    return len(points)
