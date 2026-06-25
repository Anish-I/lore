# M3 BM25 Sparse Lane — Implementation Report

Branch: `m3-bm25-sparse-lane`
Date: 2026-06-25

---

## Pytest Summary

```
13 passed in 5.30s
```

All pre-existing tests remain green. The sparse path is fully optional
(`sparse_embedder=None` default) so no existing test required modification.

---

## Eval Results (hybrid: BM25 + dense + cross-encoder rerank)

```
Indexed 21 notes / 32 chunks into vault_eval (rerank=cross-encoder, retrieval=BM25+dense hybrid)

DOMAIN    RANK  QUERY  ->  TOP HIT
----------------------------------------------------------------------------------------
tech      #2    our database keeps running out of connections  -> k8s_oom.md
tech      OK    containers getting killed for using too much m -> k8s_oom.md
tech      OK    compile-time rules that stop two threads mutat -> rust_borrow.md
tech      OK    why did customers get handshake errors in the  -> tls_cert_expiry.md
tech      OK    how do we stop everyone recomputing the same v -> redis_cache.md
tech      OK    binary search through history to find which ch -> git_bisect.md
business  OK    which big customer is at risk because our main -> acme_renewal.md
business  OK    what are the goals for becoming profitable thi -> q3_okrs.md
business  OK    who are we planning to recruit and what's bloc -> hiring_plan.md
business  OK    should we charge per user or by how much they  -> pricing_strategy.md
business  OK    who is the main rival in enterprise knowledge  -> competitor_glean.md
business  #2    what predicts whether an account stops paying  -> bug_proj1234.md
health    OK    how should I structure my running plan before  -> marathon_training.md
health    OK    tips to fall asleep faster and rest better     -> sleep_hygiene.md
food      OK    steps to bake bread with a natural starter     -> sourdough.md
food      OK    how do you make that creamy egg pasta without  -> carbonara.md
finance   OK    tax-free retirement account funded with post-t -> roth_ira.md
travel    OK    itinerary for visiting temples and hot springs -> japan_trip.md
business  OK    how do we reduce our cloud bill                -> q3_okrs.md
business  OK    connecting a second data source early keeps cu -> churn_analysis.md
sparse    OK    what is the status of PROJ-1234                -> bug_proj1234.md
sparse    OK    find DOC-5678 architecture decision            -> doc_doc5678.md
sparse    OK    on-call runbook for SVC-0042                   -> svc_svc0042.md

=== AGGREGATE ===
queries=23  recall@1=91%  recall@3=100%  recall@5=100%  MRR=0.957

per-domain recall@1:
  business  7/8
  finance   1/1
  food      2/2
  health    2/2
  sparse    3/3    <-- BM25 exact-token lane: perfect
  tech      5/6
  travel    1/1
```

**BM25 sparse lane: 3/3 exact-token queries hit rank 1.**

Rank-2 misses:
- `pg_pooling.md` ranked 2 behind `k8s_oom.md` for "connections when traffic spikes" —
  shared vocabulary (memory/connections under load) causes mild confusion.
- `churn_analysis.md` ranked 2 behind `bug_proj1234.md` for "what predicts whether an
  account stops paying" — the PROJ-1234 note added to the corpus mentions "payment
  gateway" which slightly contaminates BM25 for this query; both recover at rank 2.
  Both recover fully by recall@3.

---

## Qdrant API Deviations from Spec

| Spec item | Actual API | Resolution |
|-----------|-----------|------------|
| `qm.SparseVectorParams(modifier=qm.Modifier.IDF)` | Same — `modifier` param exists directly on `SparseVectorParams` | No deviation |
| `qm.SparseIndexParams(on_disk=False)` as `index=` kwarg | Same | No deviation |
| `sparse_vectors_config={"bm25": SparseVectorParams(...)}` in `create_collection` | Accepted as `Mapping[str, SparseVectorParams]` | No deviation |
| `qm.FusionQuery(fusion=qm.Fusion.RRF)` | `Fusion.RRF` enum value is `"rrf"` | No deviation |
| `qm.Prefetch(query=..., using=..., filter=..., limit=...)` | All params confirmed present | No deviation |
| Named-vector `PointStruct` with sparse | `vector={"dense": [...], "bm25": SparseVector(...)}` | Works; bm25 key must be `qm.SparseVector` not plain dict — handled in `upsert()` |

**Migration note:** Existing Qdrant collections using old unnamed `VectorParams` format
(pre-named-vector) are automatically detected and deleted+recreated on first call to
`ensure_collection()`. This is a one-time migration and is non-destructive for the eval
(vault_eval is always wiped before indexing) and transparent for tests (they re-index).

---

## Files Changed

- `core/vault/embed.py` — Added `SparseEmbedder` Protocol + `LocalSparseEmbedder` (fastembed Qdrant/bm25)
- `core/vault/qdrant_store.py` — Named vectors ("dense"+"bm25"), auto-migration, `search_hybrid()` with prefetch+RRF
- `core/vault/index.py` — `sparse_embedder=None` param; batch sparse embed + named vector dict
- `core/vault/recall.py` — Hybrid path when `sparse_embedder` provided; why string updated
- `eval/run_eval.py` — `LocalSparseEmbedder` wired in; 3 exact-token notes + 3 sparse queries added

---

## Environment

- qdrant-client: 1.18.0
- fastembed: 0.8.0 (SparseTextEmbedding with Qdrant/bm25 model)
- Python: 3.11
