# Scenario Stress Results — Insurance 5k / Town Clerk / Office (2026-07-20)

**Status:** Complete. Executes the "rigorous testing, different scenarios" directive
on top of the ceiling/clustering gap docs. All artifacts in
`eval/history/scenario-*-2026-07-20.json`; datasets regenerable via
`eval/scenarios/gen_scenario.py` (seed 7); harness `eval/scenarios/run_scenario_eval.py`.
**Authors:** Claude (Fable 5); Sol (Codex) authored the generators and reviewed this
doc (task `codex-1784582547-45bb` — approved with wording guards, applied).

## Decisions (read this first)

1. **Topic-merge v2 ACCEPTED** — mutual-NN gates hold at precision 1.000 / 0 false
   on all three domains (committed `e340b6e`).
2. **G2/G3 flags STAY OFF** — metric-neutral on synthetic corpora; their gate is
   G1 real-vault buckets + LoCoMo, not this suite.
3. **G9 experiment FILED** — intent-conditional superseded penalty (evidence in
   finding 3; leading mechanism, not proven root cause).
4. **Next production work** — title-index TTL cache in `index_document`, then the
   fresh-store delete path (the two measured ingest pathologies).

## What was run

Three synthetic single-tenant vaults — unique bodies/titles enforced, ID tokens
matching the exact-lane regex, gold topics with ~45% fragmented name variants:

| Scenario | Notes | Gold topics | Queries (per bucket) |
| --- | --- | --- | --- |
| insurance | **5,000** | 34 | 226 = exact 76 (incl. 16 lookalike-pair) · paraphrase 50 · temporal 40 · multihop 30 · noanswer 30 |
| townclerk | 1,200 | 22 | same shape |
| office | 1,200 | 22 | same shape |

Each scenario: 2 index variants (G2 contextual-all off/on) × 2 query variants
(G3 BGE prefix off/on), real local models (BGE-small, Qdrant/bm25, L6
cross-encoder), isolated SQLite + embedded Qdrant, real note-signals (ages +
supersedes edges formed by the relations extractor at index time).

## Retrieval results (ctx0-qp0 baseline; other variants within noise)

| Bucket | insurance 5k | townclerk 1.2k | office 1.2k |
| --- | --- | --- | --- |
| exact r@1 / r@5 | 0.974 / 1.0 | 0.974 / 1.0 | **1.0 / 1.0** |
| paraphrase r@1 / r@5 | 0.84 / 1.0 | 0.98 / 1.0 | **0.48 / 0.64** |
| temporal r@1 / r@5 | 1.0 / 1.0 | 1.0 / 1.0 | **0.50 / 1.0** |
| multihop r@1 / r@5 | 0.90 / 1.0 | 1.0 / 1.0 | 1.0 / 1.0 |
| overall r@1 / r@5 / MRR | 0.934 / 1.0 / 0.963 | 0.985 / 1.0 / 0.992 | 0.765 / 0.908 / 0.834 |
| p50 / p95 ms | 543 / 892 | 182 / 283 | 271 / 294 |
| boundary in20 / in40 | 1.0 / 1.0 | 1.0 / 1.0 | 1.0 / 1.0 |

### Findings

1. **Candidate generation never failed** — `rerank_input_contains_gold@20` = 1.0
   on every bucket of every scenario. This suite stresses RANKING; LoCoMo
   (r@5 0.715 at similar scale) stresses candidate RECALL. They are
   complementary; neither replaces the other.
2. **Office paraphrase is the genuine semantic-headroom bucket**: r@1 0.48 /
   r@5 0.64 with gold always in the rerank input — pure ranking loss among
   event-template clones sharing vendor+project context. Maps directly to G5
   (learned fusion) and G6-class tie-breaking, NOT to first-stage work.
3. **Office temporal r@1 = 0.50 with r@5 = 1.0** (both versions always
   retrieved, wrong one first half the time; all 20 supersedes edges verified
   present). Leading mechanism — not proven root cause — now G9 evidence: the
   `superseded ×0.80` penalty is applied UNCONDITIONALLY — a "what was X
   before…" query penalizes exactly the version it asks for. Residual
   confound (Sol): office's clone-heavy subject strings may blur version cues
   independent of the penalty. The experiment discriminates cleanly: skip the
   penalty when `temporal_intent=past`; the temporal bucket must move while
   latest-state behavior stays stable.
4. **G2/G3 moved nothing on synthetic data** — all four ablation variants are
   metric-identical (townclerk qp1: −0.5pp = one query). Read: (a) neither fill
   regresses anything (required before any default-flip), (b) with corpus-unique
   entity binding, BM25+rerank saturate these corpora; the fills' real test is
   LoCoMo + the G1 real-vault buckets. Flags stay OFF.
5. **No-answer separation replicates across all three domains**: mean raw
   fused top-1 score ~0.69–0.78 for answerable vs ~0.50–0.51 for no-answer.
   A G10 sufficiency signal is buildable from the raw fusion score alone
   (threshold band ~0.55–0.65); this is the empirical green light for the
   abstention lane.
6. **Latency scales with store size** (G12): p50 182–271ms at 1.2k notes →
   543ms (p95 892) at 5k on embedded Qdrant. Consistent with the live vault's
   2.7s nightly p50 once API-layer overheads stack on top.
7. Exact-lane lookalikes: 2/76 misses at r@1 in two scenarios (0.974) — G6
   deterministic in-lane ordering remains worth doing, but the lane is
   fundamentally sound under adversarial near-ID pairs.

## Clustering: fragmentation → merge recovery

Fragmentation ×3.8–4.0 across scenarios (135/85/84 variant topics over
34/22/22 gold). Sol's gates: merge precision ≥80%, false merges ≤5%.

| Algorithm | insurance | townclerk | office |
| --- | --- | --- | --- |
| v1 naive centroids (no centering) | — | — | 934 proposals, 6.5% precision (smoke) |
| v1.5 mean-centered | **91 proposals, 38.5% precision, F1 0.542→0.411 (worse)** | 21 / 0 false / 1.000 | 16 / 0 false / 1.000 |
| **v2 mutual-NN + margin + distinctive tokens** | **21 / 0 false / 1.000, F1 0.542→0.633** | 21 / 0 false / 1.000, F1→0.674 | 16 / 0 false / 1.000, F1→0.615 |

The insurance failure was structural, not parametric: adjacent desks
(Claims-Property / Subrogation / Litigation) occupy the same 0.90–0.94
centered-cosine band as true name-variants, and common domain tokens
("claims", "auto") endorsed 21 false merges as name evidence. What separates
true fragments is topology — mutual nearest-neighborhood with a margin over
each side's runner-up — plus token-rarity for name evidence. Sweep fixed
`floor_distinct` 0.94 / margin 0.02 (0.03 loses true merges). Committed as
`e340b6e`; uniform v2 numbers patched into each result JSON as `clustering_v2`.

Under auto-apply sections (now default-ON), merge precision is the difference
between duplicate *proposals* and wrongly merged *folders* — 1.000/≤5% gate
holds on all three domains, but C2 (canonical vocabulary) remains the
root-cause fix; v2 is the repair loop.

Known v2 failure modes to monitor (Sol, review): a tiny true fragment whose
centroid is dominated by one large note can NN to a big adjacent hub, and in
3+-way families two satellites can contend for the same anchor while the
anchor reciprocates only one. No min-size guard yet — it would discard
legitimate tiny fragments; if observed in practice, the fallback is
reciprocal top-k with stricter unique-evidence requirements.

## Systems findings (the stress suite's biggest wins)

Two REAL production ingest pathologies, found and confirmed by elimination
(flat 21–22 notes/s through 5,000 notes after both bypasses; was 21→5
degrading):

1. `qdrant_store.delete_note` — unindexed payload scan per note on embedded
   Qdrant; O(collection) per ingest.
2. `index.py:350` — `relations.build_title_index` rebuilt PER INGESTED NOTE:
   one compiled regex per existing title, all run over each body (~25M compiles
   at 5k notes). The api.py-style TTL cache shared into `index_document` is the
   obvious core fix.

The live vault pays both on every bulk reconcile. Filed as the top G12
candidates ahead of any retrieval-quality work on latency.

## Token economics (progressive-disclosure #5, measured with tiktoken)

Compact ID-first index 503 tok/q · naive top-8 chunks 394 · naive top-8 FULL
notes 1,378 · search + hydrate-one 679. The new contract wins 2.7× vs
full-note injection (2.0× for the full loop); ~even vs chunk packs at
synthetic chunk sizes — competitor "10×" claims assume the naive baseline.
Real-vault chunks are 3–5× larger; re-measure there before building the
SessionStart digest (#2) on anyone's arithmetic.

## Honest limitations

- Corpus-unique query binding makes exact/paraphrase lexically easier than
  real usage (in40=1.0 everywhere); LoCoMo and the G1 real-vault buckets stay
  the headroom benchmarks. This suite's role: invariant validation, domain
  robustness (it caught the insurance clustering collapse), systems pathology
  discovery, and regression gating — which it did, four times in one day.
- Townclerk ran on the pre-fast-path harness build (orphaned process);
  metrics are valid, only its indexing wall-clock is not comparable.
- Single seed (7); bootstrap CIs arrive with G1.

## Real-data validation — Enron corpus (added same day)

Anish challenged the two 100% tiles as potentially inflated (in-sample threshold
tuning; authored corpora). Response: the public CMU Enron corpus (2015-05-07),
four benchmark mailboxes (Bekkerman et al. convention), converted by
`eval/scenarios/enron_adapter.py` (Sol-authored; two integration fixes: harness
query-schema reconcile + the Win32 trailing-dot filename bug — Enron files are
named `1.`, requiring the `\\?\` extended-length prefix on Windows).

Real mailboxes, owners' own folders as clustering gold, known-item queries from
corpus-unique verbatim body-phrase pairs, no-answer probes verified absent:

| Mailbox | Notes | Folders | known-item r@1 / r@5 | in20/in40 | p50/p95 ms | sep (ans vs none) | merges |
| --- | --- | --- | --- | --- | --- | --- | --- |
| beck-s | 1,193 | 60 | 0.900 / 1.00 | 1.0 / 1.0 | 352 / 378 | 0.66 vs 0.52 | 0 (0 false) |
| farmer-d | 1,500 | 18 | 0.975 / 1.00 | 1.0 / 1.0 | 381 / 460 | 0.74 vs 0.51 | 0 (0 false) |
| kaminski-v | 1,500 | 32 | 0.950 / 1.00 | 1.0 / 1.0 | 417 / 494 | 0.64 vs 0.54 | 0 (0 false) |
| lokay-m | 1,500 | 10 | 0.825 / 0.95 | 1.0 / 1.0 | 400 / 546 | 0.65 vs 0.50 | 0 (0 false) |
| **pooled (160 q)** | 5,693 | 120 | **0.913 / 0.988** | **1.0 / 1.0** | — | — | **0 / 0** |

Findings:
1. **The boundary claim survives real data**: the right email reached the rerank
   input on all 160 real known-item queries. Not a synthetic artifact.
2. **Ranking is honestly imperfect on real text**: pooled r@1 0.913; lokay-m
   (newsletter/discussion-heavy) is the weak case at 0.825 / 0.95.
3. **Clustering did no harm on 120 real human folders** — zero proposals across
   four mailboxes full of genuinely adjacent folders (beck-s: europe/london/uk).
   Flip side: zero healing attempted; on real data the v2 gates may be too
   conservative — a recall knob question (real fragment labels would be needed
   to tune it), explicitly NOT a safety question.
4. **No-answer separation replicates on real email but narrows**: gaps of
   0.10–0.23 vs 0.19–0.27 synthetic. kaminski-v (0.64 vs 0.54) says the G10
   threshold must be per-corpus calibrated, not a fixed constant.
5. Latency at 1.2–1.5k real emails: p50 352–417ms (real bodies are longer than
   synthetic notes; consistent with the store-size curve).

## Recommended next steps (priority order)

1. Production fixes for the two ingest pathologies (title-index cache first).
2. G9 experiment: intent-conditional superseded penalty (office temporal
   evidence above).
3. G10 sufficiency threshold on raw fusion score (separation replicated 3×).
4. G1 real-vault buckets + LoCoMo categories — the gate G2/G3 actually need.
5. C2 canonical topic vocabulary (root fix behind v2's repair loop).
