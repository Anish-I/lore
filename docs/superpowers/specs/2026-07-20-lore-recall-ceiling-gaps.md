# Lore Recall — Ceiling Gap Analysis (Claude ⇄ Sol, 2026-07-20)

**Status:** Analysis — no code changes. Every fill below follows the research-monitor
discipline: named bottleneck with file/eval evidence → smallest model-agnostic
mechanism → executable gate → reversible.
**Authors:** Claude (Fable 5) pipeline audit + literature sweep; Sol (Codex) independent
gap analysis (task `codex-1784571471-217e`); merged and code-verified by Claude;
Sol round-2 review incorporated (task `codex-1784571967-81aa`) — bound-metric placement,
gate tightening, G9 ADD-only semantics.

## Where we actually stand

| Fixture | Scale | Result | Source |
| --- | --- | --- | --- |
| Nightly gold (46 q, live vault) | ~46 queries | r@5 **0.848**; paraphrase (n=40) r@1 **0.675** / r@5 0.825 / MRR 0.746; exact (n=6) r@1 0.667 / r@5 1.0 | `eval/history/nightly.jsonl` 2026-07-17 |
| LoCoMo retrieval (10 conv) | **1,982 q / 5,882 notes** | r@1 **0.478**, r@5 **0.715**, r@10 0.778, MRR 0.581 | `eval/history/locomo.jsonl` |
| Trusted-recall (13 labeled cases) | 13 | hit@1/3/5 100%, MRR 1.0, P95 393ms | `2026-07-18-trusted-recall-evaluation-results.md` |
| Latency, live store | 46 q | p50 **2.7s** / p95 2.8s (nightly) vs 393ms fixture P95 | nightly.jsonl vs trusted-recall |

**The ceiling conversation must anchor on LoCoMo, not the nightly.** At real scale
28.5% of questions miss top-5 entirely and half miss rank 1. The 46-query nightly is
near its own noise floor (1 query = 2.2pp; exact bucket: 1 query = 16.7pp).
2026-07-20 nightly did not run (`backend: down` row).

Realistic ceiling targets: LoCoMo r@5 0.715 → **0.82+**, nightly r@5 0.848 → **0.90+**
with CI-backed buckets, live p95 **< 500ms**, zero forbidden-fact regressions.

## Sol's headline (independently reached, Claude concurs)

> The biggest likely headroom is not a bigger reranker. It is candidate-generation
> recall plus local vocabulary/alias learning, then learned fusion. The current eval
> is too small to prove most of the ceiling work.

Ceiling math on the nightly: paraphrase misses = 7 queries out of top-5 entirely +
13 more not at rank 1; exact = 2 of 6 not at rank 1 (lane ordering, not lane recall).

---

## Tier 0 — Measurement (blocks everything else)

### G1. Gold set too small and unstratified to see the ceiling
- **Evidence:** 46 nightly queries, 2 kinds only; trusted set n=13; results doc risk #4
  already says it needs "temporal updates, conflicts, deletions, distractors".
  `eval/bench_locomo.py:130` skips adversarial and **has no per-category breakdown**
  (LoCoMo ships single-hop / multi-hop / temporal / open-domain labels — we drop them).
  LoCoMo bulk HTTP ingest stalls (>6 min for first note; risk #3).
- **Literature:** Cranfield/TREC practice — Voorhees 2000 (judgment variation),
  Voorhees & Harman 2005; LongMemEval (Wu et al., ICLR 2025, arxiv:2410.10813) tests
  five abilities incl. knowledge updates, temporal reasoning, **abstention**;
  LoCoMo (Maharana et al., ACL 2024, arxiv:2402.17753).
- **Fill (smallest):** Stratify gold into buckets: paraphrase, exact **+ lookalike
  distractors**, temporal/update-conflict, multi-hop/person, distractor/no-answer,
  deleted/superseded. ≥30 queries per bucket (gen_gold.py already frames kinds;
  extend generation + hand-review). Add bootstrap CIs and per-bucket gates to
  `run_nightly.py`. Emit LoCoMo per-category recall. Fix ingest stall (batch /ingest or
  direct index_document calls). Record per-stage timings in nightly rows —
  `recall.retrieve_traced` already produces them; the nightly just doesn't use them.
  **Plus two boundary metrics (Sol round-2):** `candidates_contain_gold@40`
  (first-stage headroom diagnostic) and `rerank_input_contains_gold@20` — the latter is
  the true upper bound of the current system (only 20 chunks reach the cross-encoder)
  and is the one to **gate** on. For multi-hop buckets track both `any_gold@N` and
  `all_required_gold@N`, or "got one evidence note, missed the bridge" failures stay
  invisible.
- **Gate:** nightly reports bucketed r@1/r@5/MRR + CI + both boundary metrics +
  stage timings; locomo10 full replay completes with category split; scheduled-task
  health alarm on `backend: down` rows.
- **Why user cares:** every later claim ("temporal recall improved") becomes provable.

## Tier 1 — Cheap, high-confidence recall fills

### G2. Contextual chunk enrichment is plumbed but effectively OFF
- **Evidence:** `index.py:275` calls `apply_context(chunk_markdown(...), title, llm=None)`;
  `contextualize.py:needs_context` only enriches chunks **< 120 tokens or pronoun-start**,
  and `llm=None` means the enrichment is just "From note '{title}', section '{path}'."
  Meanwhile the two-stage payload split (embed enriched / rerank raw, `index.py:306-323`)
  was **measured on LoCoMo: r@1 0.239 → 0.503**. The mechanism works; most chunks never
  get context.
- **Literature:** DAPR (Wang, Reimers, Gurevych, ACL 2024) — large share of passage-retrieval
  failures need document context; ConTEB (arxiv:2505.24782); Late Chunking
  (Günther et al., arxiv:2409.04701); CLAP coreference-linked chunks (arxiv:2508.06941);
  chunking taxonomy (arxiv:2602.16974); Anthropic contextual retrieval (engineering
  evidence). Sol independently ranked this #6, Claude #2 — merged Tier 1.
- **Fill:** enrich **every** chunk with a deterministic prefix at index time:
  `title > section path > note date > canonical entities` (all already in DB/payload);
  optional Ollama one-sentence situating context behind a flag (`LORE_CONTEXT_LLM=1`)
  for chunks flagged by `needs_context`. Re-index. Two-stage split already protects
  rerank precision.
- **Gate:** nightly paraphrase bucket +, LoCoMo r@5 +, exact bucket flat, index time
  bounded; **rollbackable index versioning** (old collection kept until gates pass) and
  **raw-vs-enriched payload parity tests** (rerank must still see raw text — the
  two-stage invariant). Reversible: re-index with flag off.
- **Expected:** paraphrase r@5 +3–6pp, r@1 +2–4pp (Sol's estimate; consistent with DAPR).

### G3. BGE query-side instruction prefix never applied (verified in fastembed source)
- **Evidence:** `recall.py:216` embeds the query via `embedder.embed([eq])`;
  installed fastembed's `TextEmbedding.query_embed` **falls through to plain `embed`**
  (`text_embedding_base.py:46-61` — no BGE instruction anywhere in the package).
  BGE-small-en-v1.5's card (C-Pack, Xiao et al. 2023) specifies
  "Represent this sentence for searching relevant passages: " for short query→passage
  retrieval — exactly our paraphrase bucket.
- **Fill:** one line — prepend the instruction to the **query-side dense embed only**
  (semantic-classified queries; document/passage embeds unchanged; BM25 lane unchanged).
  Env-toggle `LORE_BGE_QUERY_PREFIX` for ablation. No re-index needed.
- **Gate:** nightly paraphrase bucket + LoCoMo r@5, and **no category-level regression
  beyond CI in any bucket** (not just aggregate lift — Sol round-2).
- **Expected:** +1–3pp paraphrase; near-zero cost/risk — do it first as the pilot
  experiment for the new bucketed gate.

### G4. Query expansion glossary is empty; no learned aliases
- **Evidence:** `recall.py:74` `_GLOSSARY = {}` ("let the M6 recalibration job learn
  triggers" — job doesn't exist). Paraphrase r@5 0.825 vs exact 1.0 = vocabulary
  mismatch, not lookup failure (Sol's read, Claude concurs).
- **Literature:** relevance models RM3 (Lavrenko & Croft, SIGIR 2001); HyDE
  (Gao et al., ACL 2023); corpus-steered expansion CSQE (arxiv:2402.18031) and
  MuGI best-practices (arxiv:2401.06311) — expansion must be grounded in the corpus
  or it drifts; ADORE retrieval-grounded iterative expansion (arxiv:2606.13905);
  PhD lineage: Iain Mackie (Glasgow, generative relevance feedback), Xiao Wang
  (Glasgow, ColBERT-PRF / neural PRF).
- **Fill:** M6 job (offline, local): mine alias pairs from (a) entity graph titles +
  wikilink aliases already in Postgres, (b) heading vocabulary, (c) accepted-answer /
  thumbs-up query→note pairs from the feedback table. Write `_GLOSSARY` as a
  user-owned, inspectable table (ADD-only, exportable). Retrieval query variant only;
  rerank still scores the original (already the design). Exact-ID queries excluded.
- **Gate:** paraphrase bucket +4–8pp target, exact bucket zero regression,
  expansion table visible in **What Lore knows** (user-owned state principle).

## Tier 2 — Ranking quality

### G5. Hand-tuned fusion constants where the literature says learn
- **Evidence:** `recall.py` carries ~12 magic numbers (w=0.8/0.15, session 0.75,
  agent 0.9, importance 0.10, recency 0.20 + 0.3×"none" + 30d half-life, entity 1.15,
  superseded 0.80, feedback 0.15·tanh(net/3), prefetch 40, rerank 20, k=8).
  r@5 ≫ r@1 gap (0.825 vs 0.675) = gold reaches candidates but loses the blend.
- **Literature:** LTR — Liu 2009 FnTIR, Burges 2010 (LambdaMART); RRF (Cormack et al.,
  SIGIR 2009); query-dependent ranking (Jie Peng, Glasgow PhD 2010); calibrated fusion —
  percentile/PIT normalization beats raw minmax when mixing heterogeneous scores
  (PhaseGraph, arxiv:2603.28886). DART test-time reranking (arxiv:2606.01070) as a
  zero-training alternative.
- **Fill:** keep every signal as a **feature**; learn weights offline with a tiny
  transparent LTR (pairwise logistic or coordinate ascent) trained on the bucketed gold
  + LoCoMo, per query class. Env fallback to current constants (`LORE_LTR=0`).
  Swap minmax → percentile-rank normalization as a separate ablatable flag
  (PhaseGraph's minmax comparison is directional evidence, not statistically strong —
  a hypothesis to test, not a proven win).
- **Gate:** held-out-fold nightly MRR/r@1 +, no bucket −10pp, weights dumped to a
  readable JSON (inspectable state).
- **Expected:** paraphrase r@1 +4–8pp.

### G6. Exact-ID lane: in-lane ordering is arbitrary
- **Evidence:** exact r@5 = 1.0 but r@1 = 0.667 — the lane finds the note but sorts
  the wrong chunk first. `recall.py:_exact_lane` sorts only "heading contains ident"
  then preserves Qdrant scroll order (`qdrant_store.search_exact` scroll = arbitrary).
- **Fill:** deterministic in-lane ordering: heading exact > title exact > body exact;
  then ident token density/window; then non-superseded, durable-first, recency.
  No cross-encoder in this lane (the −32pp lesson stands).
- **Gate:** ≥30-query exact bucket **with lookalike, stale (superseded), and
  contradictory exact-match fixtures first** (n=6 says nothing); exact r@1 target
  +10pp in-bucket.

### G7. First-stage candidate recall bound
- **Evidence:** prefetch 40/lane, rerank top-20 — the cross-encoder cannot rescue gold
  absent from top-20. 7/40 paraphrase queries miss top-5 today; at LoCoMo scale the
  bound bites harder (r@10 0.778 means 22% aren't even in top-10 post-fusion).
- **Literature:** DPR (Karpukhin et al., EMNLP 2020), ANCE (Xiong et al., ICLR 2021),
  SPLADE (Formal et al. 2021/22; Formal PhD, Sorbonne/Naver); Mitra PhD 2020
  (vocabulary mismatch + rare-term exactness need both lanes).
- **Fill:** (a) make prefetch depth query-class-tunable (deep cheap retrieval, bounded
  rerank), (b) env-gated learned-sparse lane (fastembed ships SPLADE++ ONNX:
  `prithivida/Splade_PP_en_v1`) fused as third RRF lane.
- **Gate:** the G1 boundary metrics decide this one — `rerank_input_contains_gold@20`
  is the gating bound (what the system can possibly rank), `candidates_contain_gold@40`
  the first-stage diagnostic; then r@5; p95 rerank stage <500ms unchanged.

## Tier 3 — Structural lanes (need Tier 0 buckets to even detect)

### G8. Graph substrate exists; retrieval never traverses it
- **Evidence:** `index.py` builds wikilink/folder/tag edges + typed semantic relations
  with confidences into `edges`; `people.py` person graph; supersedes/contradicts edges
  power ranking/conflict surfacing — but `retrieve()`'s only graph touchpoint is the
  `entity_hit` ×1.15 boost. Multi-hop/person queries have no candidate path.
- **Literature:** HippoRAG (Gutiérrez et al., NeurIPS 2024, arxiv:2405.14831) and
  HippoRAG 2 (arxiv:2502.14802) — PPR over entity graph; **SPRIG (arxiv:2602.23372)
  CPU-only linear PPR, and honest about when strong lexical hybrids suffice**;
  GAAMA (arxiv:2603.27910) warns of conversational mega-hubs (our edge caps 8/8/24
  already mitigate); Baleen multi-hop (Khattab et al., NeurIPS 2021).
- **Fill:** graph lane as **candidate widener only**: query entities (title-index cache
  already matches them per request in `api.py:_note_signals_provider`) → 1–2-hop
  weighted walk / PPR over `edges` → inject note chunks into the candidate pool
  pre-rerank, tagged `why=graph`. No generation changes.
- **Gate:** multi-hop/person bucket + LoCoMo multi-hop category; **strict
  candidate-widener monotonicity — the graph lane may only ADD candidates, never
  demote or displace dense/sparse hits from the rerank input** (Sol round-2); overall
  r@5 must not drop; added latency <100ms.

### G9. Temporal model is regex intent + one fixed half-life
- **Evidence:** `recall.py` temporal_intent regexes ("as of", "before X", "last time",
  relative dates all fall through to 'none'); one 30-day half-life for all content
  classes; ADD-only supersedes ×0.80 is the only validity signal; results doc lists
  temporal updates/conflicts as an explicit gold gap.
- **Literature:** time-aware IR PhD lineage — Nattiya Kanhabua (NTNU 2012),
  Li & Croft time-based LMs (CIKM 2003), Kanhabua/Blanco/Nørvåg FnTIR 2015;
  Re3 relevance-recency balance (arxiv:2509.01306); TempRetriever (arxiv:2502.21024);
  T-GRAG temporal conflicts (arxiv:2508.01680); TSM — event time ≠ mention time,
  durative facts (arxiv:2601.07468); Chronos SVO events with resolved datetimes
  (arxiv:2603.16862); FRESCO — rerankers pick stale evidence under conflict
  (arxiv:2604.14227).
- **Fill:** add `event_at` (extracted, distinct from `created_at`) + a validity VIEW
  derived from existing supersedes chains (`valid_until` = superseded-by date);
  temporal query classes route to as-of filters/priors before generic recency;
  fit half-life per memory_type from the feedback/outcome data instead of 30d-for-all.
  **ADD-only constraint (Sol round-2):** validity must be derived at read/eval time or
  appended as new edge facts — never written onto old notes as a `valid_to` mutation.
  And split supersedes semantics before closing anything: *state-replacement* ("now
  using X") may close the prior state's validity window; *correction* and *late-added
  past event* must NOT — a generic supersedes-closes-validity rule would incorrectly
  expire historical facts.
- **Gate:** temporal/update-conflict bucket (new) +10–20pp target; FRESCO-style
  stale-vs-fresh probes; zero regression elsewhere.

### G10. No retrieval sufficiency / abstention signal
- **Evidence:** `/search` always returns k chunks; no margin/agreement/conflict score
  reaches the caller; trusted-recall's "no invented facts" probe is narrow; LongMemEval
  names abstention a core memory ability — we don't measure it.
- **Literature:** selective prediction (Geifman & El-Yaniv, NeurIPS 2017; Guo et al.,
  ICML 2017 calibration); SUGAR semantic-uncertainty-guided retrieval
  (arxiv:2501.04899); SURE-RAG sufficiency verification (arxiv:2605.03534);
  S2G-RAG gap judging (arxiv:2604.23783); EviMem evidence-gap iterative retrieval
  (arxiv:2604.27695); calibrated budget allocation (arxiv:2606.29959).
- **Fill:** compute a sufficiency score from signals already in hand (top-1 margin,
  dense/sparse lane agreement, exact-lane hit, conflict-edge count via `_conflicts_for`,
  entity coverage) and return it as metadata ("insufficient/conflicting memory") for
  the desktop + hook injection to act on. Optionally trigger ONE bounded second-pass
  retrieval (EviMem-style) when low.
- **Gate:** no-answer/adversarial bucket — refusal precision/recall **with a
  calibration check on those buckets** (score thresholds must actually separate
  answerable from unanswerable; metadata exposure alone doesn't pass); forbidden-fact
  probe stays 0.

### G11. Session/personal memory statements are stored, not key-indexed
- **Evidence:** `sessions.py` browse/scroll is deterministic; `personal_memory.py` docs
  index as 2 flat documents; `learn.py` extracts evidence but nothing turns distilled
  **facts into retrieval keys** (LongMemEval "key expansion": facts as keys, not values).
  Session chunks are down-weighted (×0.75) rather than distilled into first-class
  memory statements.
- **Literature:** MemGPT (Packer et al. 2023); LoCoMo; LongMemEval key expansion;
  Krasakis PhD (Amsterdam) conversational passage retrieval; Cognis versioned memory
  ingestion (arxiv:2604.19771); APEX-MEM append-only temporal events (arxiv:2604.14362).
- **Fill:** in the learn/distill loop, emit atomic memory statements
  (subject–relation–object + perspective: user-said / agent-inferred + event_at) as
  small indexed notes (memory_type=durable, provenance to session). Retrieval unchanged —
  the statements simply become findable keys. ADD-only, exportable, deletable.
- **Gate:** LoCoMo bulk replay + cross-session e2e suite (`test_learn_cross_session_e2e.py`
  already scaffolds this); memory-precision probe unchanged.

### G12. Latency: 2.7–2.9s live p50 vs 393ms fixture P95 — unattributed
- **Evidence:** nightly p50 2744ms (46 q, live store), LoCoMo p50 2902ms at 5,882 notes;
  trusted fixture 393ms. `retrieve_traced` measures embed/retrieve/rerank stages but the
  nightly doesn't record them; embedded-Qdrant payload indexes are a documented no-op
  (`qdrant_store.py:54-57`) so ACL filtering is unindexed at vault scale.
- **Fill:** measure first (G1 stage timings), then fix the top stage. Candidates:
  payload-index support in current embedded qdrant-client; rerank batch/session reuse;
  signals SQL batching. Buyer triple = accuracy + tokens + **latency**; 2.8s live vs
  the 500ms gate is a product hole regardless of recall.
- **Gate:** live p95 <500ms with recall gates green.

## Deliberately NOT proposed
- Bigger reranker by default (L12 already failed the 500ms gate; DART/test-time tricks
  before model growth).
- Embedder fine-tuning as a Tier-1 move: CustomIR (arxiv:2510.21729) / GPL
  (arxiv:2112.07577) / R-GPL (arxiv:2501.14434) fit our known-corpus setting and could
  lift paraphrase recall substantially, BUT listwise-distillation results
  (arxiv:2502.19712) show naive InfoNCE fine-tuning can **degrade** retrieval, it
  requires re-index + per-user training infra, and it weakens model-agnosticism.
  Keep as ONE bounded experiment behind the G1 harness, synthetic queries +
  LLM-verified hard negatives, revert = swap model id + re-index.
- Copying model-architecture mechanisms (MoE/MLA/KDA) — per the standing research-monitor
  gate: no measured Lore bottleneck maps to them.

## Recommended sequence (gain ÷ effort)
1. **G1** eval buckets + CIs + LoCoMo categories + stage timings + both boundary
   metrics (`rerank_input_contains_gold@20` gates; unlocks proof for all).
2. **G3** BGE query prefix (one line, pilot for the new gate) → **G2** full contextual
   re-index → **G4** learned glossary job.
3. **G7** prefetch/rerank depth tuning against the boundary metrics → **G5** learned
   fusion → **G6** exact-lane ordering (after lookalike/stale fixtures).
4. **G12** latency attribution in parallel (product-visible win).
5. **G8/G9/G10/G11** structural lanes once their buckets exist to detect them.

Projected: LoCoMo r@5 0.715 → ~0.82 (Tier 1+2), nightly r@5 0.848 → 0.90+ with CIs,
temporal/multi-hop buckets measurable for the first time, live p95 under the 500ms gate.
