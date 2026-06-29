import os
import re
import time
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
_ID_EXTRACT = re.compile(r"\b([A-Za-z]{2,}-(?:[A-Za-z]{2}-)?\d{2,})\b")  # CLM-77741, RF-PA-2026217

def extract_identifier(q: str):
    m = _ID_EXTRACT.search(q)
    return m.group(1) if m else None

def _exact_lane(query, by_id, allowed_scope_ids, tenant_id):
    """Return chunk_ids of notes literally containing the query's identifier, heading
    matches first. Adds any new candidates to by_id. Empty if no identifier in query."""
    ident = extract_identifier(query)
    if not ident:
        return []
    rows = qdrant_store.search_exact(ident, allowed_scope_ids, tenant_id, limit=10)
    rows.sort(key=lambda c: ident.lower() not in (c.get("heading_path", "") or "").lower())
    out = []
    for c in rows:
        by_id.setdefault(c["chunk_id"], c)
        out.append(c["chunk_id"])
    return out

def _prepend_unique(exact_ids, ranked):
    seen, ordered = set(), []
    for cid in list(exact_ids) + list(ranked):
        if cid not in seen:
            seen.add(cid); ordered.append(cid)
    return ordered

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

# Domain glossary: bridge plain-language queries to the jargon the notes use.
# Applied to the RETRIEVAL query only (dense+sparse); rerank still scores the
# original query. Toggle with EXPAND=0. Domain-pluggable.
_EXPAND = os.environ.get("EXPAND", "1") != "0"
# Empty by default (domain-pluggable). Populate per-deployment or let the M6
# recalibration job learn triggers from the user's real queries.
_GLOSSARY = {}

def expand_query(q: str) -> str:
    if not _EXPAND:
        return q
    ql = q.lower()
    extra = [terms for trigger, terms in _GLOSSARY.items() if trigger in ql]
    if not extra:
        return q
    have = set(ql.split())
    add = [t for t in " ".join(extra).split() if t.lower() not in have]
    return (q + " " + " ".join(dict.fromkeys(add))) if add else q

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
    eq = expand_query(query)
    qvec = embedder.embed([eq])[0]

    if sparse_embedder is not None:
        # ---- Hybrid path: Qdrant dense + BM25 RRF, then rerank blend ----
        sparse_vec = sparse_embedder.embed_sparse([eq])[0]
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
        ranked = sorted(top_ids, key=lambda c: final[c], reverse=True)
        exact_ids = _exact_lane(query, by_id, allowed_scope_ids, tenant_id)
        for cid in exact_ids:
            final.setdefault(cid, 1.0)
        ranked = _prepend_unique(exact_ids, ranked)[:limit]
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
    ranked = sorted(top_ids, key=lambda c: final[c], reverse=True)
    exact_ids = _exact_lane(query, by_id, allowed_scope_ids, tenant_id)
    for cid in exact_ids:
        final.setdefault(cid, 1.0)
    ranked = _prepend_unique(exact_ids, ranked)[:limit]
    out = []
    for cid in ranked:
        c = by_id[cid]
        out.append(RetrievedChunk(cid, c["note_id"], c["text"], c["heading_path"], final[cid],
                                  why=f"blend(rerank*{w:.2f}[{classify_query(query)}]+hybrid*{1 - w:.2f})={final[cid]:.3f}"))
    return out


def _scope_of(c):
    s = c.get("scope_ids") or ["?"]
    return s[0] if s else "?"

def retrieve_traced(query, embedder, reranker, sparse_embedder,
                    allowed_scope_ids, tenant_id, limit=8):
    """Like retrieve(), but runs the dense and sparse lanes SEPARATELY and returns
    (final_chunks, trace) where trace exposes every pipeline stage for visualization."""
    cls = classify_query(query)
    w = _weight_for(query)

    t0 = time.perf_counter()
    eq = expand_query(query)
    qvec = embedder.embed([eq])[0]
    svec = sparse_embedder.embed_sparse([eq])[0]
    t_embed = (time.perf_counter() - t0) * 1000

    t0 = time.perf_counter()
    dense = qdrant_store.search(qvec, allowed_scope_ids, tenant_id, limit=20)
    sparse = qdrant_store.search_sparse(svec, allowed_scope_ids, tenant_id, limit=20)
    t_ret = (time.perf_counter() - t0) * 1000

    by_id = {}
    for c in dense + sparse:
        by_id[c["chunk_id"]] = c
    fused = rrf([[c["chunk_id"] for c in dense], [c["chunk_id"] for c in sparse]])
    top_ids = sorted(fused, key=fused.get, reverse=True)[:20]
    docs = [by_id[i]["text"] for i in top_ids]

    t0 = time.perf_counter()
    rr = reranker.rerank(query, docs) if docs else []
    t_rr = (time.perf_counter() - t0) * 1000

    rr_norm = _minmax({cid: s for cid, s in zip(top_ids, rr)})
    fused_norm = _minmax({cid: fused[cid] for cid in top_ids})
    final_score = {cid: w * rr_norm.get(cid, 0.0) + (1 - w) * fused_norm.get(cid, 0.0)
                   for cid in top_ids}
    ranked = sorted(top_ids, key=lambda c: final_score[c], reverse=True)
    # Exact-identifier lane: literal-token matches jump to the front.
    exact_ids = _exact_lane(query, by_id, allowed_scope_ids, tenant_id)
    for cid in exact_ids:
        final_score.setdefault(cid, 1.0)
    ranked = _prepend_unique(exact_ids, ranked)[:limit]

    final = [RetrievedChunk(cid, by_id[cid]["note_id"], by_id[cid]["text"],
                            by_id[cid]["heading_path"], final_score[cid],
                            why=f"{cls} (rerank w={w:.2f})") for cid in ranked]

    def row(cid, score):
        c = by_id[cid]
        return {"title": c["heading_path"], "scope": _scope_of(c), "score": round(score, 4)}

    trace = {
        "query": query, "classification": cls, "rerank_weight": round(w, 2),
        "models": {"dense": "BGE-small-en-v1.5", "sparse": "Qdrant/bm25",
                   "rerank": "ms-marco-MiniLM-L-6-v2"},
        "timings_ms": {"embed": round(t_embed), "retrieve": round(t_ret), "rerank": round(t_rr)},
        "dense": [{"title": c["heading_path"], "scope": _scope_of(c), "score": round(c["score"], 4)} for c in dense[:6]],
        "sparse": [{"title": c["heading_path"], "scope": _scope_of(c), "score": round(c["score"], 4)} for c in sparse[:6]],
        "fused": [row(cid, fused[cid]) for cid in sorted(fused, key=fused.get, reverse=True)[:6]],
        "final": [{"title": by_id[cid]["heading_path"], "scope": _scope_of(by_id[cid]),
                   "rerank": round(rr_norm.get(cid, 0.0), 3), "final": round(final_score[cid], 3),
                   "text": by_id[cid]["text"][:240], "note_id": by_id[cid]["note_id"]} for cid in ranked],
    }
    return final, trace
