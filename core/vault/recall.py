from .models import RetrievedChunk
from . import qdrant_store
from .fusion import rrf

def _lexical_rank(query, candidates):
    q = set(query.lower().split())
    scored = sorted(candidates, key=lambda c: len(q & set(c["text"].lower().split())), reverse=True)
    return [c["chunk_id"] for c in scored]

def retrieve(query, embedder, reranker, allowed_scope_ids, tenant_id, limit=8):
    qvec = embedder.embed([query])[0]
    candidates = qdrant_store.search(qvec, allowed_scope_ids, tenant_id, limit=40)
    if not candidates:
        return []
    by_id = {c["chunk_id"]: c for c in candidates}
    dense_rank = [c["chunk_id"] for c in candidates]
    lexical_rank = _lexical_rank(query, candidates)
    fused = rrf([dense_rank, lexical_rank])
    top_ids = sorted(fused, key=fused.get, reverse=True)[:20]
    docs = [by_id[i]["text"] for i in top_ids]
    rr = reranker.rerank(query, docs)
    ranked = sorted(zip(top_ids, rr), key=lambda x: x[1], reverse=True)[:limit]
    out = []
    for cid, score in ranked:
        c = by_id[cid]
        out.append(RetrievedChunk(cid, c["note_id"], c["text"], c["heading_path"], score,
                                  why=f"dense+lexical RRF then rerank={score:.3f}"))
    return out
