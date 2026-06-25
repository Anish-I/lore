import os
import re
from .models import RetrievedChunk
from . import qdrant_store
from .fusion import rrf

# Final score blends the cross-encoder rerank with the hybrid (RRF) score so a
# confident-but-wrong reranker can't fully override strong dense+lexical agreement.
# weight=1.0 => pure rerank; 0.0 => pure hybrid/fusion.
#
# QUERY-ADAPTIVE FUSION (eval-justified): the cross-encoder rerank HELPS natural-language
# semantic queries (+25pp) but HURTS exact-identifier near-duplicate queries (-32pp) because
# it can't tell lookalikes apart and overrides BM25's exact-token hit. So pick the weight by
# query type instead of using one static value. Set RERANK_WEIGHT env to force a fixed value
# (used by ablation sweeps); otherwise weight is chosen per query.
_FORCED = os.environ.get("RERANK_WEIGHT")
RERANK_WEIGHT = float(_FORCED) if _FORCED is not None else 0.7  # fallback / forced value
RERANK_WEIGHT_SEMANTIC = 0.8   # trust the cross-encoder for natural-language queries
RERANK_WEIGHT_LEXICAL = 0.15   # trust BM25/fusion for identifier / exact-token queries

_ID_TOKEN = re.compile(r"^[A-Za-z]{2,}-\d{2,}$")  # PROJ-1037, ACME-2009, SKU-3005

def classify_query(q: str) -> str:
    """'lexical' if the query carries an exact identifier/code token, else 'semantic'."""
    if '"' in q:
        return "lexical"
    for tok in q.replace("?", " ").split():
        t = tok.strip(".,!:;()'").upper()
        if _ID_TOKEN.match(t):
            return "lexical"
        if len(t) >= 5 and any(c.isdigit() for c in t) and any(c.isalpha() for c in t):
            return "lexical"  # alnum codes like TS509, BUILD2A
    return "semantic"

def _weight_for(query: str) -> float:
    if _FORCED is not None:
        return float(_FORCED)
    return RERANK_WEIGHT_LEXICAL if classify_query(query) == "lexical" else RERANK_WEIGHT_SEMANTIC

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

def retrieve(query, embedder, reranker, allowed_scope_ids, tenant_id, limit=8,
             sparse_embedder=None):
    """Retrieve relevant chunks for a query.

    When sparse_embedder is provided the hybrid path is used: Qdrant performs a
    two-lane prefetch (dense ANN + BM25 sparse) and fuses the lanes via RRF
    server-side.  The resulting RRF scores are then blended with the local
    cross-encoder rerank score.

    When sparse_embedder is None (default) the original dense + lexical RRF +
    rerank path is used, keeping all existing tests green.
    """
    qvec = embedder.embed([query])[0]

    if sparse_embedder is not None:
        # ---- Hybrid path: Qdrant dense + BM25 RRF, then rerank blend ----
        sparse_vec = sparse_embedder.embed_sparse([query])[0]
        candidates = qdrant_store.search_hybrid(
            qvec, sparse_vec, allowed_scope_ids, tenant_id, limit=40
        )
        if not candidates:
            return []
        by_id = {c["chunk_id"]: c for c in candidates}
        # candidates are already RRF-fused and ranked by Qdrant; take top 20
        top_ids = [c["chunk_id"] for c in candidates[:20]]
        docs = [by_id[i]["text"] for i in top_ids]
        rr = reranker.rerank(query, docs)

        # Blend normalized cross-encoder score with normalized Qdrant fusion score.
        w = _weight_for(query)
        qdrant_scores = {c["chunk_id"]: c["score"] for c in candidates}
        rr_norm = _minmax({cid: s for cid, s in zip(top_ids, rr)})
        fused_norm = _minmax({cid: qdrant_scores.get(cid, 0.0) for cid in top_ids})
        final = {cid: w * rr_norm[cid] + (1 - w) * fused_norm[cid] for cid in top_ids}
        ranked = sorted(top_ids, key=lambda c: final[c], reverse=True)[:limit]
        out = []
        for cid in ranked:
            c = by_id[cid]
            out.append(RetrievedChunk(
                cid, c["note_id"], c["text"], c["heading_path"], final[cid],
                why=f"hybrid(dense+bm25 RRF)->rerank blend w={w:.2f}({classify_query(query)})={final[cid]:.3f}",
            ))
        return out

    # ---- Dense-only path: dense + lexical RRF + rerank (original behaviour) ----
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
    w = _weight_for(query)
    rr_norm = _minmax({cid: s for cid, s in zip(top_ids, rr)})
    fused_norm = _minmax({cid: fused[cid] for cid in top_ids})
    final = {cid: w * rr_norm[cid] + (1 - w) * fused_norm[cid] for cid in top_ids}
    ranked = sorted(top_ids, key=lambda c: final[c], reverse=True)[:limit]
    out = []
    for cid in ranked:
        c = by_id[cid]
        out.append(RetrievedChunk(cid, c["note_id"], c["text"], c["heading_path"], final[cid],
                                  why=f"blend(rerank*{w:.2f}[{classify_query(query)}]+hybrid*{1 - w:.2f})={final[cid]:.3f}"))
    return out
