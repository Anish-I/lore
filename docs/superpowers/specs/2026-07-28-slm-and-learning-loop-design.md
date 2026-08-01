# Design: SLM injection, data exhaust, and the learning loop

**Date:** 2026-07-28
**Status:** direction approved (brainstorm with owner; sequencing confirmed in session)
**Motivation:** Owner proposal: build an SLM while keeping the full loop, then
"inject" the SLM into the LLM — parked against three converging pressures:
(1) the recall ceiling is a frozen-model limit, not a tuning limit (LoCoMo full
run r@5 0.715; breadth ablation 2026-07-09 ruled out windowing); (2) the
box-and-cloud move means many users' hardware can't run even lightweight
rerankers locally; (3) the product thesis is "wrapper over best-of-breed
models + we keep/learn the data" — which requires a learning mechanism that
today does not exist: every model in the recall chain is frozen and the only
adaptive signal (`feedback` → `1 + 0.15·tanh(net/3)`) is per-note memorization
that cannot generalize.

## Decision summary

1. **SLM is a LATER task, and "injection" means the prompt layer, not
   weights.** The SLM's eventual seats are Lore's existing LLM-shaped jobs
   (classify, relations, contextualize) plus context-pack compression at ask
   time. Weight-level injection into the answer LLM is rejected (§2). The SLM
   is not started until the contextualization experiment (§3) proves richer
   chunk context moves the cat-1 miss slice — the SLM is the *cost-scaling
   step of a validated win*, never a speculative train.
2. **Data exhaust is a NOW task.** Every LLM call Lore already pays for
   (classify, relations, future contextualize) and every ask-path ranking
   event starts persisting as consented, provenance-stamped training pairs
   (§4). Data accumulation is the long-lead item; it cannot be backfilled.
3. **The learning loop that ships FIRST is feature-level, not neural:** a
   gradient-boosted LTR ranker (LambdaMART class) over the note-level signals
   `recall.py` already computes, trained on the exhaust's ranking tuples,
   gated by the existing nightly harness (§5). Microsecond inference on any
   hardware — the learning loop works even for users who can't run a
   reranker. A bandit over provider configurations follows once ≥2 providers
   are wired per seat.
4. **Placement ladder for the box/cloud move:** a benchmark-based capability
   probe (measured latency, not spec sheet) places each model seat on a
   per-component ladder — full local → light local → cloud API → degraded
   (fusion-only) — surfaced in `/api/v1/health` (§6). Ollama is dropped as a
   managed lane; extractive fallback remains the keyless-local floor.
5. **Privacy posture changes are explicit, never incidental.** Cloud
   processing shifts the promise from "nothing leaves the machine" to
   "nothing is *stored* remotely" — an opt-in per-tenant tier. `private:`
   scope is structurally barred from cloud routing, same enforcement pattern
   as the never-syncable invariant (`tenancy.py`). Training-data capture is a
   separate opt-in flag from cloud processing; `query_log` stays hash-only.
6. **No-retention training posture (business direction, not yet committed):**
   train on transient consented exhaust, retain model weights, discard raw
   data. Viable only if the consent flag and training-rights terms exist from
   day one — weights trained on consented exhaust are a different asset from
   weights trained on customer data retroactively claimed.

## 2. Why weight-level SLM→LLM injection is rejected

Baking tenant knowledge into parameters breaks every storage-side guarantee
the engine is built on:

- **ACL** — scope is enforced *inside the query* (Qdrant payload filter + SQL
  back-stop). Weights have no scope filter; a model trained on `private:`
  notes answers from them under any caller scope. The zero-knowledge
  invariant has no weight-space equivalent.
- **Supersession** — ADD-only `supersedes` edges demote stale claims ×0.80 at
  rank time. A trained model asserts last month's mill rate; there is no
  ×0.80 inside weights.
- **Provenance** — LoCoMo measures recall of the *cited gold turn*. Parametric
  recall cites nothing; the drill-down guarantee (answer → chunk → note →
  source) dies.
- **Deletion/export** — tombstones and `/export` promise data is never
  captive. A trained model is captive data by construction.
- **Provider reality** — two of three answer lanes (`claude`, `codex`) are
  subscription CLIs whose weights are untouchable. Weight injection could
  only ever apply to a local lane that decision 4 is deprecating.

**Escape hatch if ever revisited:** a per-tenant LoRA on a local model only,
treated exactly like the Qdrant index — derived, rebuildable, retrained after
deletions, never trained across scope boundaries. Expected win is smaller
than the pipeline seats below for much higher operational cost.

## 3. Where the SLM earns its seat (and the gate in front of it)

Three existing jobs are ideal SLM shapes — small, closed-domain, offline,
already evaluated:

| Seat | Today | SLM case |
|---|---|---|
| `classify.py` tags/topic/role | batched cloud LLM, strict JSON | local + free; training pairs already generated per run; eval exists (Ellington 494: spam recall 1.000, correspondence 0.965) |
| `llm_relations.py` typed edges | cloud LLM, body-hash cached | bounded output space (existing titles only) |
| `contextualize.py` chunk prefixes | deterministic; LLM path exists but unwired | the reason to wire it — cloud-LLM-per-chunk at ingest is cost-prohibitive; SLM makes a proven win affordable |

At ask time the SLM's job is context-pack compression: retrieved chunks →
tighter, token-budgeted, still-cited context for whatever big model the user
brought. That IS the "inject SLM into LLM" step — at the prompt layer, where
provenance and ACL survive. The big LLM stays a stateless renderer; memory
stays in the store.

**The gate:** before any SLM work, run the contextualization A/B the
recall-ceiling analysis already calls for — wire LLM enrichment with existing
providers, measure before/after on the cat-1 ("right session, wrong turn")
miss slice specifically, per the 2026-07-09 discipline (aggregate movement is
not acceptance; the addressable population is the cat-1 slice). Moves the
number → SLM is justified as the scaling step. Doesn't → SLM falls back to
"cheaper classify," which waits indefinitely. Prerequisite quick win in the
same lane: the fastembed BGE query-prefix fix (2026-07-20 learnings #1).

## 4. Data exhaust (now)

Persist, under an explicit per-tenant opt-in flag (`LORE_TRAINING_CAPTURE`,
default off):

- **Classification pairs** — (note excerpt → tags, topic, role) from every
  `classify.py` batch. Today the labels land as `note_tags` rows and the
  supervision context is discarded.
- **Relation pairs** — (text → typed relations) from `llm_relations.py`,
  currently transient behind the body-hash cache.
- **Contextualization pairs** — (raw chunk + note context → enriched prefix)
  once §3's experiment wires the path.
- **Ranking tuples** — the irreplaceable one: (query text, candidate set,
  fusion + rerank scores, per-signal values from `recall.py` step 4, chunks
  cited in the answer, subsequent feedback vote). Exists only when real users
  ask real questions; cannot be synthesized later.

Every row carries provenance: labeling model + version, prompt version,
engine version, tenant, scope, timestamp — so future training can filter out
pairs from prompts since fixed. Constraints: `private:` scope excluded
structurally (code + test, like the sync invariant); `query_log` remains
hash-only and is NOT the capture mechanism; capture is a distinct consent
from cloud processing (§6 of decisions). This flag is also the legal
substrate for the no-retention training posture — without it there is no
"train on their data without keeping it," only liability.

## 5. The learning loop (first: LTR, then bandit)

**Today recall adapts but does not learn.** BGE, BM25, and the cross-encoder
are frozen; fusion weights (0.8/0.15) are hand-tuned constants; the feedback
multiplier memorizes per-note and generalizes nothing; `topic_registry` is
the only accumulating learned artifact and it is a lookup table.

**Rung 1 — learned ranker.** The multiplicative signals in `recall.py`
(memory-type, importance, recency, entity hit, superseded, feedback) plus
fused + rerank scores become features; citations and votes from the ranking
tuples become labels; a LambdaMART-class GBDT learns the blend per tenant.

- Inference is microseconds on any CPU — works on exactly the hardware that
  forces cloud reranking, so the *learning* layer never needs the cloud.
- Nightly retrain, gated by `run_nightly.py --gate` like any ranking change;
  falls back to the hand-tuned blend when a tenant lacks tuples (cold start
  = today's behavior, so ship risk is bounded).
- This converts feedback from per-note memorization into generalization —
  the mechanism that turns stored data into switching cost.

**Rung 2 — bandit over provider configs.** Once ≥2 providers exist per seat
(embedder swap noted in §6), route per-query-class through configurations
with feedback/citations as reward. Model selection itself becomes the
learning loop: Lore learns *which* best-of-breed component performs for this
tenant's corpus. The wrapper part of the thesis is table stakes — any
competitor can call the best reranker on the planet; the accumulated
per-tenant tuples, learned ranker, and routing posterior are the moat.

## 6. Placement ladder (box/cloud move)

**Probe by benchmark, not spec sheet.** First run: embed 10 chunks, rerank 20
candidates, wall-clock them. Place each component; report placement in
`GET /api/v1/health` beside `capabilities`. Re-probe on demand (`doctor`).

Per-component rungs:

1. **Full local** — BGE-small + MiniLM-L12 (today's stack).
2. **Light local** — int8 ONNX MiniLM-L6-class reranker; recovers most weak
   machines before any cloud spend.
3. **Cloud API** — Voyage (already pluggable) / Cohere-class rerank + embed;
   opt-in tier, promise becomes "nothing stored remotely," `private:` scope
   never routes here.
4. **Degraded** — skip rerank, ship RRF fusion order (`w=0` path already
   exists). Lower recall beats a hung query.

**Swap-cost hierarchy the wrapper must respect:** LLM and reranker are
stateless — free to swap per request. Embedder swap = full reindex (vectors
are model-specific). Stamp every Qdrant collection with embedding
model+version now so a mixed-model index is structurally impossible; the
index is already derived-and-rebuildable, which is the right substrate.

**Ollama:** dropped as a managed dependency (highest support burden, weakest
lane). Keyless-local floor = extractive fallback; synthesis routes to
`codex`/`claude`/`byok`/hosted. Search and recall are the product; NL
synthesis is garnish.

## 7. Sequencing

1. **Now:** fastembed BGE query-prefix fix → contextualization A/B on the
   cat-1 slice (existing providers, measured gate).
2. **Now, in parallel:** data-exhaust capture behind the consent flag +
   provenance stamping + embedding-version stamping on collections.
3. **Box/cloud workstream:** capability probe + placement ladder + Ollama
   removal + cloud-tier consent surface.
4. **When tuples accumulate:** LTR ranker, nightly-gated, per-tenant.
5. **When ≥2 providers per seat:** bandit routing.
6. **Later, gated on §3:** SLM for contextualize → classify → relations →
   context-pack compression. Parked until users heavily rely on Lore and the
   exhaust has depth.

## Non-goals

- Training any SLM now, or any weight-level injection into answer LLMs.
- Widening `query_log` beyond hashes.
- Cloud routing for `private:` scope, under any tier.
- Committing to the no-retention training business posture — this doc only
  ensures the consent substrate exists so the option stays open.
- Changing retrieval defaults ahead of measured gates (nothing ships that
  doesn't move the number).
