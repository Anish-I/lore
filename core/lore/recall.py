import os
import re
import time
from .models import RetrievedChunk
from . import qdrant_store
from .fusion import rrf
from .profiles import RetrievalProfile

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

def _exact_lane(query, by_id, allowed_scope_ids, tenant_id, source_types=None):
    """Return chunk_ids of notes literally containing the query's identifier, heading
    matches first. Adds any new candidates to by_id. Empty if no identifier in query."""
    ident = extract_identifier(query)
    if not ident:
        return []
    rows = qdrant_store.search_exact(
        ident, allowed_scope_ids, tenant_id, limit=10, source_types=source_types)
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

def _default_profile() -> RetrievalProfile:
    """The tuning this process defaults to, assembled from the module globals.

    Rebuilt per call rather than frozen at import so the two things that have
    always driven those globals keep working: env at import, and the ablation
    harnesses (eval/scenarios/run_scenario_eval.py, tests) that assign them at
    runtime. Callers that want their OWN tuning pass an explicit profile instead.
    """
    return RetrievalProfile(
        rerank_weight_forced=float(_FORCED) if _FORCED is not None else None,
        rerank_weight_semantic=RERANK_WEIGHT_SEMANTIC,
        rerank_weight_lexical=RERANK_WEIGHT_LEXICAL,
        bge_query_prefix=_BGE_QUERY_PREFIX,
        expand=_EXPAND,
        session_weight=SESSION_WEIGHT,
        agent_weight=AGENT_WEIGHT,
        importance_weight=IMPORTANCE_WEIGHT,
        recency_weight=RECENCY_WEIGHT,
        recency_half_life_days=RECENCY_HALF_LIFE_DAYS,
        entity_boost=ENTITY_BOOST,
        superseded_weight=SUPERSEDED_WEIGHT,
        feedback_weight=FEEDBACK_WEIGHT,
        tag_boost=TAG_BOOST,
    )


def _resolve(profile):
    return profile if profile is not None else _default_profile()


def _weight_for(query: str, profile=None) -> float:
    p = _resolve(profile)
    if p.rerank_weight_forced is not None:
        return p.rerank_weight_forced
    return p.rerank_weight_lexical if classify_query(query) == "lexical" \
        else p.rerank_weight_semantic

# G3 (2026-07-20 ceiling-gaps doc): BGE-style embedders expect an instruction
# prefix on the QUERY side of asymmetric retrieval — fastembed never applies it
# (its query_embed falls through to plain embed), so we do. Dense lane only:
# BM25 must see the raw terms and the cross-encoder scores the original query.
# Env-gated for ablation; default OFF until the bucketed gate passes.
_BGE_QUERY_PREFIX = os.environ.get("LORE_BGE_QUERY_PREFIX", "0") == "1"
_BGE_QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: "


def dense_query_text(expanded_query: str, profile=None) -> str:
    """Text the DENSE query vector embeds — instruction-prefixed when enabled."""
    if _resolve(profile).bge_query_prefix:
        return _BGE_QUERY_INSTRUCTION + expanded_query
    return expanded_query


# Domain glossary: bridge plain-language queries to the jargon the notes use.
# Applied to the RETRIEVAL query only (dense+sparse); rerank still scores the
# original query. Toggle with EXPAND=0. Domain-pluggable.
_EXPAND = os.environ.get("EXPAND", "1") != "0"
# Empty by default (domain-pluggable). Populate per-deployment or let the M6
# recalibration job learn triggers from the user's real queries.
_GLOSSARY = {}

def expand_query(q: str, profile=None) -> str:
    if not _resolve(profile).expand:
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

# Raw captured-session chunks (claude/codex session transcripts) score high on
# lexical overlap with conversational queries — they're literally past prompts —
# but they're the least-distilled knowledge in the store. Down-weight them so
# topic/knowledge notes win contested slots; never exclude them (recent-session
# recall is still useful). Env-tunable for ablation runs.
SESSION_SOURCE_TYPES = frozenset(("claude-session", "codex-session", "claude-history"))
SESSION_WEIGHT = float(os.environ.get("LORE_SESSION_WEIGHT", "0.75"))


def _downweight_sessions(final, by_id, profile=None):
    """Multiply final scores of session-sourced chunks by the profile's
    session_weight (in place)."""
    w = _resolve(profile).session_weight
    if w >= 1.0:
        return
    for cid in final:
        c = by_id.get(cid) or {}
        if c.get("source_type") in SESSION_SOURCE_TYPES:
            final[cid] *= w


# --- M2: note-level ranking signals -----------------------------------------
# All bounded multiplicative adjustments applied AFTER the rerank/hybrid blend.
# Every knob is env-tunable for ablation; changes are gated by
# eval/run_nightly.py --gate (recall@5 must not drop >10pp under the median).
IMPORTANCE_WEIGHT = float(os.environ.get("LORE_IMPORTANCE_WEIGHT", "0.10"))
RECENCY_WEIGHT = float(os.environ.get("LORE_RECENCY_WEIGHT", "0.20"))
RECENCY_HALF_LIFE_DAYS = float(os.environ.get("LORE_RECENCY_HALF_LIFE", "30"))
ENTITY_BOOST = float(os.environ.get("LORE_ENTITY_BOOST", "0.15"))
# Per query-named tag matched on a note (tagscope.py), saturating at 3 tags.
# Boost, never filter — recall stays the safety net when tagging is imperfect.
TAG_BOOST = float(os.environ.get("LORE_TAG_BOOST", "0.20"))
SUPERSEDED_WEIGHT = float(os.environ.get("LORE_SUPERSEDED_WEIGHT", "0.80"))
AGENT_WEIGHT = float(os.environ.get("LORE_AGENT_WEIGHT", "0.90"))
FEEDBACK_WEIGHT = float(os.environ.get("LORE_FEEDBACK_WEIGHT", "0.15"))

# Memory-type axis (durable knowledge > agent memory > raw session scratch) now
# lives on the profile — RetrievalProfile.memory_type_weights derives it from
# agent_weight/session_weight, so a per-call profile can move it. A module-level
# dict would freeze at import and silently ignore both profiles and the ablation
# harnesses that reassign the weights at runtime.

# Temporal INTENT of the query, used as a ranking signal (Mem0 insight: temporal
# awareness belongs in the fusion function, not just an as-of filter).
#   'current' → boost recent notes;  'past' → no recency boost (history queries
#   must not drown older decisions);  'none' → mild default recency.
_INTENT_CURRENT_RE = re.compile(
    r"\b(current(ly)?|now|latest|newest|today|this week|these days|status|"
    r"what am i|what are we|in progress|right now)\b", re.I)
_INTENT_PAST_RE = re.compile(
    r"\b(did i|did we|originally|used to|back (then|in)|previously|history of|"
    r"at the time|in (january|february|march|april|may|june|july|august|"
    r"september|october|november|december|\d{4}))\b", re.I)


def temporal_intent(q: str) -> str:
    if _INTENT_PAST_RE.search(q or ""):
        return "past"
    if _INTENT_CURRENT_RE.search(q or ""):
        return "current"
    return "none"


def _apply_note_signals(final, by_id, query, signals, profile=None):
    """Blend note-level signals into chunk scores (in place).

    signals: {note_id: {"importance": float[0,1], "age_days": float|None,
                        "memory_type": str, "superseded": bool,
                        "entity_hit": bool, "tag_hits": int}}
    Replaces _downweight_sessions when provided (memory_type covers it —
    applying both would double-penalize sessions).
    """
    if not signals:
        return
    p = _resolve(profile)
    mem_w = p.memory_type_weights
    intent = temporal_intent(query)
    rec_w = 0.0 if intent == "past" else (p.recency_weight if intent == "current"
                                          else p.recency_weight * 0.3)
    for cid in list(final):
        c = by_id.get(cid) or {}
        s = signals.get(c.get("note_id"))
        if not s:
            continue
        f = final[cid]
        f *= mem_w.get(s.get("memory_type") or "durable", 1.0)
        f *= 1.0 + p.importance_weight * float(s.get("importance") or 0.0)
        age = s.get("age_days")
        if rec_w and age is not None:
            f *= 1.0 + rec_w * (0.5 ** (max(age, 0.0) / p.recency_half_life_days))
        if s.get("entity_hit"):
            f *= 1.0 + p.entity_boost
        hits = s.get("tag_hits")
        if hits:
            # Query-named tags on this note (already capped by tagscope):
            # "algebra dogs" concentrates ranking on notes carrying both.
            f *= 1.0 + p.tag_boost * int(hits)
        if s.get("superseded"):
            # ADD-only model: superseded notes stay in the store; ranking is
            # where the newer claim wins.
            f *= p.superseded_weight
        net = s.get("feedback_net")
        if net:
            # Personal ranking: thumbs on citations. tanh bounds runaway votes;
            # ±3 net votes ≈ full effect.
            import math
            f *= 1.0 + p.feedback_weight * math.tanh(net / 3.0)
        final[cid] = f


def _seed_chunks(seed_note_ids, allowed_scope_ids, tenant_id, source_types):
    """Tag-seed lane (2026-07-29): chunks of query-tag-matched notes, fetched by
    id so they enter the rerank pool even when the vector lanes missed them.
    Unlike the exact-ID lane they get NO free ranking — they compete through
    the rerank blend + note signals (the tag boost is what argues for them)."""
    if not seed_note_ids:
        return []
    return qdrant_store.fetch_by_notes(
        seed_note_ids, allowed_scope_ids, tenant_id, source_types=source_types)


def _inject_seeds(seeds, by_id, top_ids):
    """Add seed chunks missing from the RERANK POOL. Membership is checked
    against top_ids, not by_id — a seed that was fetched as candidate #25 but
    missed the fused top-20 still needs injecting (that near-miss is the
    common case this lane exists for). Returns the extended top_ids."""
    have = set(top_ids)
    extra = []
    for c in seeds:
        cid = c.get("chunk_id")
        if not cid or cid in have:
            continue
        by_id.setdefault(cid, c)
        have.add(cid)
        extra.append(cid)
    return list(top_ids) + extra


def retrieve(query, embedder, reranker, allowed_scope_ids, tenant_id, limit=8,
             sparse_embedder=None, note_signals=None, source_types=None,
             profile=None, seed_note_ids=None):
    """Retrieve relevant chunks for a query.

    When sparse_embedder is provided the hybrid path is used: Qdrant performs a
    two-lane prefetch (dense ANN + BM25 sparse) and fuses the lanes via RRF
    server-side.  The resulting RRF scores are then blended with the local
    cross-encoder rerank score.

    When sparse_embedder is None (default) the original dense + lexical RRF +
    rerank path is used, keeping all existing tests green.

    note_signals: optional callable(note_ids) -> {note_id: signal dict} (see
    _apply_note_signals). Provided by the API layer, which has the DB; when
    given it REPLACES the payload-based session down-weighting.

    profile: optional RetrievalProfile — this caller's tuning. Resolved ONCE
    here and threaded down, so one request's knobs can never leak into another's.
    Defaults to _default_profile() (the process's env/global tuning).

    seed_note_ids: optional note ids the API layer matched from query-named
    tags (tagscope). Their chunks JOIN the rerank pool as candidates with zero
    fusion credit — the cross-encoder and the tag boost decide their rank.
    """
    p = _resolve(profile)
    eq = expand_query(query, p)
    qvec = embedder.embed([dense_query_text(eq, p)])[0]
    seeds = _seed_chunks(seed_note_ids, allowed_scope_ids, tenant_id, source_types)

    if sparse_embedder is not None:
        # ---- Hybrid path: Qdrant dense + BM25 RRF, then rerank blend ----
        sparse_vec = sparse_embedder.embed_sparse([eq])[0]
        candidates = qdrant_store.search_hybrid(
            qvec, sparse_vec, allowed_scope_ids, tenant_id, limit=40,
            source_types=source_types,
        )
        if not candidates and not seeds:
            return []
        by_id = {c["chunk_id"]: c for c in candidates}
        # candidates are already RRF-fused and ranked by Qdrant; take top 20,
        # then let tag-seeded chunks join and compete.
        top_ids = _inject_seeds(seeds, by_id, [c["chunk_id"] for c in candidates[:20]])
        docs = [by_id[i]["text"] for i in top_ids]
        rr = reranker.rerank(query, docs)

        # Blend normalized cross-encoder score with normalized Qdrant fusion score.
        w = _weight_for(query, p)
        # .get: seeded chunks join the pool with no fusion score at all.
        qdrant_scores = {c["chunk_id"]: c.get("score", 0.0) for c in candidates}
        rr_norm = _minmax({cid: s for cid, s in zip(top_ids, rr)})
        fused_norm = _minmax({cid: qdrant_scores.get(cid, 0.0) for cid in top_ids})
        final = {cid: w * rr_norm[cid] + (1 - w) * fused_norm[cid] for cid in top_ids}
        # Signals weight the BLEND. The exact-ID lane deliberately bypasses them
        # and leads verbatim — measured: signal-reordering exact matches costs
        # identifier r@1 (the exact lane's whole purpose is literal precision).
        if note_signals is not None:
            _apply_note_signals(final, by_id, query,
                                note_signals({by_id[c]["note_id"] for c in top_ids}), p)
        else:
            _downweight_sessions(final, by_id, p)
        ranked = sorted(top_ids, key=lambda c: final[c], reverse=True)
        exact_ids = _exact_lane(
            query, by_id, allowed_scope_ids, tenant_id, source_types=source_types)
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
    candidates = qdrant_store.search(
        qvec, allowed_scope_ids, tenant_id, limit=40, source_types=source_types)
    if not candidates and not seeds:
        return []
    by_id = {c["chunk_id"]: c for c in candidates}
    dense_rank = [c["chunk_id"] for c in candidates]
    lexical_rank = _lexical_rank(query, candidates)
    fused = rrf([dense_rank, lexical_rank])
    top_ids = sorted(fused, key=fused.get, reverse=True)[:20]
    top_ids = _inject_seeds(seeds, by_id, top_ids)
    for cid in top_ids:
        fused.setdefault(cid, 0.0)          # seeds carry no fusion credit
    docs = [by_id[i]["text"] for i in top_ids]
    rr = reranker.rerank(query, docs)

    # Blend normalized rerank + normalized hybrid score.
    w = _weight_for(query, p)
    rr_norm = _minmax({cid: s for cid, s in zip(top_ids, rr)})
    fused_norm = _minmax({cid: fused[cid] for cid in top_ids})
    final = {cid: w * rr_norm[cid] + (1 - w) * fused_norm[cid] for cid in top_ids}
    if note_signals is not None:
        _apply_note_signals(final, by_id, query,
                            note_signals({by_id[c]["note_id"] for c in top_ids}), p)
    else:
        _downweight_sessions(final, by_id, p)
    ranked = sorted(top_ids, key=lambda c: final[c], reverse=True)
    exact_ids = _exact_lane(
        query, by_id, allowed_scope_ids, tenant_id, source_types=source_types)
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
                    allowed_scope_ids, tenant_id, limit=8, note_signals=None,
                    profile=None, seed_note_ids=None):
    """Like retrieve(), but runs the dense and sparse lanes SEPARATELY and returns
    (final_chunks, trace) where trace exposes every pipeline stage for visualization.

    Carries the same seed_note_ids lane as retrieve() so a trace reflects what
    production actually retrieves; the trace names the injected chunks under
    "seeded"."""
    p = _resolve(profile)
    cls = classify_query(query)
    w = _weight_for(query, p)

    t0 = time.perf_counter()
    eq = expand_query(query, p)
    qvec = embedder.embed([dense_query_text(eq, p)])[0]
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
    seeds = _seed_chunks(seed_note_ids, allowed_scope_ids, tenant_id, None)
    seeded_ids = [c["chunk_id"] for c in seeds
                  if c.get("chunk_id") and c["chunk_id"] not in set(top_ids)]
    top_ids = _inject_seeds(seeds, by_id, top_ids)
    for cid in top_ids:
        fused.setdefault(cid, 0.0)          # seeds carry no fusion credit
    docs = [by_id[i]["text"] for i in top_ids]

    t0 = time.perf_counter()
    rr = reranker.rerank(query, docs) if docs else []
    t_rr = (time.perf_counter() - t0) * 1000

    rr_norm = _minmax({cid: s for cid, s in zip(top_ids, rr)})
    fused_norm = _minmax({cid: fused[cid] for cid in top_ids})
    final_score = {cid: w * rr_norm.get(cid, 0.0) + (1 - w) * fused_norm.get(cid, 0.0)
                   for cid in top_ids}
    if note_signals is not None:
        _apply_note_signals(final_score, by_id, query,
                            note_signals({by_id[c]["note_id"] for c in top_ids}), p)
    ranked = sorted(top_ids, key=lambda c: final_score[c], reverse=True)
    # Exact-identifier lane: literal-token matches jump to the front, verbatim.
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
        "temporal_intent": temporal_intent(query),
        "models": {"dense": "BGE-small-en-v1.5", "sparse": "Qdrant/bm25",
                   "rerank": getattr(reranker, "model_name", type(reranker).__name__)},
        "timings_ms": {"embed": round(t_embed), "retrieve": round(t_ret), "rerank": round(t_rr)},
        "dense": [{"title": c["heading_path"], "scope": _scope_of(c), "score": round(c["score"], 4)} for c in dense[:6]],
        "sparse": [{"title": c["heading_path"], "scope": _scope_of(c), "score": round(c["score"], 4)} for c in sparse[:6]],
        "fused": [row(cid, fused[cid]) for cid in sorted(fused, key=fused.get, reverse=True)[:6]],
        "seeded": [row(cid, final_score.get(cid, 0.0)) for cid in seeded_ids[:6]],
        "final": [{"title": by_id[cid]["heading_path"], "scope": _scope_of(by_id[cid]),
                   "rerank": round(rr_norm.get(cid, 0.0), 3), "final": round(final_score[cid], 3),
                   "text": by_id[cid]["text"][:240], "note_id": by_id[cid]["note_id"]} for cid in ranked],
    }
    return final, trace
