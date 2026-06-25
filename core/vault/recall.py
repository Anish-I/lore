import os
from .models import RetrievedChunk
from . import qdrant_store
from .fusion import rrf

# Final score blends the cross-encoder rerank with the hybrid (RRF) score so a
# confident-but-wrong reranker can't fully override strong dense+lexical agreement.
# RERANK_WEIGHT=1.0 => pure rerank (old behaviour); 0.0 => pure hybrid.
RERANK_WEIGHT = float(os.environ.get("RERANK_WEIGHT", "0.7"))

def _lexical_rank(query, candidates):
    q = set(query.lower().split())
    scored = sorted(candidates, key=lambda c: len(q & set(c["text"].lower().split())), reverse=True)
    return [c["chunk_id"] for c in scored]

def _minmax(d):
    """Min-max normalize a {key: score} dict to [0,1]; flat -> all 0.5."""
    if not d:
        return {}
    lo, hi = min(d.values()), max(d.values())
    if hi - lo < 1e-9:
        return {k: 0.5 for k in d}
    return {k: (v - lo) / (hi - lo) for k, v in d.items()}

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

    # Blend normalized rerank + normalized hybrid score.
    rr_norm = _minmax({cid: s for cid, s in zip(top_ids, rr)})
    fused_norm = _minmax({cid: fused[cid] for cid in top_ids})
    final = {cid: RERANK_WEIGHT * rr_norm[cid] + (1 - RERANK_WEIGHT) * fused_norm[cid]
             for cid in top_ids}
    ranked = sorted(top_ids, key=lambda c: final[c], reverse=True)[:limit]
    out = []
    for cid in ranked:
        c = by_id[cid]
        out.append(RetrievedChunk(cid, c["note_id"], c["text"], c["heading_path"], final[cid],
                                  why=f"blend(rerank*{RERANK_WEIGHT}+hybrid*{1 - RERANK_WEIGHT:.1f})={final[cid]:.3f}"))
    return out
