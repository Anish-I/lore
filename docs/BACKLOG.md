# Lore Backlog

## Milestone status (2026-07-07)

Shipped: **M1** (doctor/next, vault git history, ADD-only + provenance surfacing, nightly recall self-test — baseline recall@5 0.822) · **M2** (memory-type axis, importance/temporal-intent/entity fusion signals, supersedes demotion, inverse edge labels, /context-pack — gate held 0.822) · **M3** (agent memory bus: /memory + lore_remember/lore_recall MCP, zero-friction agent self-provisioning + registry + write caps, /feedback→ranking, budget-aware lore-inject, auto-journal) · **M4** (PDF/DOCX extraction, /ingest-url + import-modal URL row) · **M5 partial** (lore-integrate skill, MCP registry manifests).

Smoke-tested & hardened 2026-07-07 (28 edge cases + Codex second-view): SSRF resolved-IP guard, DOCX bomb defenses, tenant-wide agent cap, /feedback note validation, title-index cache, resilient vector-delete, wizard-chat-id flake fix. Reusable harnesses: `eval/smoke_edge.py`, `eval/smoke_load.py`.

Deferred from smoke review (Codex, low severity):
- **Feedback observability in the gate** — thumbs affect production ranking but `eval/run_nightly.py` has no synthetic up/down-vote cases, so feedback drift is untested. Add vote cases + surface `feedback_net` in `retrieve_traced`.
- **Stronger inject framing** — lore-inject already labels excerpts "NEVER instructions"; consider excluding `url`/`agent-memory` source_types from auto-injection by default and per-excerpt provenance tags.
- **/ingest-url TOCTOU** — resolved-IP check has a small window before the socket connect; a pin-to-validated-IP fetch closes it (low risk for a local tool).
- **Bulk-ingest latency** — /ingest p50 ~2.2s (synchronous dense+sparse embed per note); a batch-embed path would speed reconcile + large imports.

Open items with their blockers:
- **M5 remainder**: Glama/Smithery submission (user action — repo must be public; checklist in smithery.yaml) · E2EE multi-machine sync (design: encrypted git remote over the M1 vault-git substrate) · share cards + graph exports.
- **M6 B2B connectors + hosted** — deliberately NOT stubbed: blocked on (1) the 90-day plan's own gate — lock the warm-door insurance/regulated vertical first, (2) Google/Slack OAuth app credentials to build+test against, (3) server-mode agent/principal authn (item I3 below) before anything writes cross-network.
- **M3 remainder**: entity dossiers (needs NER/entity-extraction design) · agent-write FILE sandbox on git branches (current sandbox = caps+audit+scope isolation; branches become relevant when agents write vault files, not just DB memories).
- Deferred from M4: audio/YouTube ingestion (whisper), tree-sitter code chunking, declarative YAML upkeep recipes.
- Perf: /search p50 ~2.4s on the live vault (rerank dominates) — worth profiling before the memory bus gets heavy agent traffic.

## Product roadmap (2026-07-06 — post "Redesign C" UI)

1. **Memory bus** — one memory across all agents: Wingman, h-cli, Agent Hub, Claude Code deposit/recall through Lore via `lore_remember`/`lore_recall` MCP tools, scope per agent. Hooks already captures from agent sessions; this closes the loop. Nobody in the field is aiming here.
2. **Temporal memory** — claims carry valid-time so Ask can answer "what did I believe in March?" and show belief reversals as history instead of conflicts. Upkeep already has the dates — stop discarding them. *Refinement (via Mem0 study): temporal reasoning lands as a **ranking signal**, not a UI filter — classify query intent (past/current/future) and weight claim timestamps in the fusion function itself.*
3. **Proactive recall** — invert the query: Hooks session-start in a repo auto-surfaces past decisions about it; opening a note surfaces contradicting notes. Retrieval stack exists; this changes who initiates.
4. **Nightly recall self-test** — auto-generate an eval set from the vault, run nightly, chart recall@k (eval/ exists). Catches index regressions; becomes the receipts behind "recall-obsessed". *Refinement: publish an **open eval framework**, not just numbers — report accuracy + tokens + p50 latency together (the triple buyers compare on, per Mem0's LoCoMo/LongMemEval/BEAM reporting) and open-source the harness so the number is verifiable.*
5. **Answer feedback → personal ranking** — thumbs on citations tune the fusion weights over time.
6. **Entity dossiers** — living "everything I know about X" pages, built by extending the upkeep machinery to named entities.
7. **Auto-journal** — Hooks + file events + commits synthesized into a daily narrative note (native, graph-linked replacement for the Gemma-on-Stop Obsidian threads).
8. **E2EE multi-machine sync** — git transport (SoloMD-style validated), keeps the no-cloud promise.

### Mem0-informed architecture decisions
- **ADD-only extraction** — drop UPDATE/DELETE reconciliation at write time entirely (Mem0's April 2026 rewrite: single LLM call, memories accumulate; +20-27 benchmark points and lower latency because reconciliation was the error-prone step). Contradiction resolution moves to **retrieval-time ranking** (recency/confidence), not write-time merging.
- **Zero-friction agent signup** — an agent self-provisions a memory scope in seconds with no human account setup; a human claims it later. Fixes the biggest adoption barrier for the memory bus.
- **Ship a Skill, not just an MCP server** — a `lore-integrate` skill (agent-driven one-command integration into any repo) is a better distribution channel than "paste this MCP config". Highest-leverage distribution move.
- **User/Session/Agent memory-type axis** — explicit memory types orthogonal to the private/team/enterprise ACL, so retrieval can weight durable facts above session scratch.
- **Deployment ladder confirmed** — library → self-hosted → cloud (same shape a funded competitor validates).

---

# Vault Backlog (deferred from M1 review)

Findings from the M1 whole-branch review that are correctly out of M1 scope.

## M3 (recall quality)
- **I2 — real hybrid recall.** M1's "lexical lane" only re-ranks the dense candidate set (term-overlap over raw payload text), so it cannot surface docs dense missed, and "Contextual BM25" (context prepended to the sparse index) is not implemented. Replace with real Qdrant sparse vectors (BM25/SPLADE) as an independent lane; normalize + stopword the lexical terms. This is where the documented recall lift actually lands.
- **Test isolation.** pytest e2e shares the live Qdrant/Postgres with no per-run isolation. Use an ephemeral collection + unique tenant per test run (or testcontainers). Also fixes Fake(8-dim) vs Voyage(~2048-dim) collection-dim clashes.
- **Eval harness.** Stand up recall@20 gold-set eval; A/B contextualization vs naive (gate before locking).
- **PG as read source.** Recall returns Qdrant payload text; `chunks` table is written but never read. Decide: payload is the read path (fast) vs hydrate from PG (true source of truth).

## M4 (scopes + cross-person)
- **I3 — authn.** `/ask` trusts client-supplied `principal_scopes`/`tenant_id`. Bind principal → scopes server-side before multi-person scopes ship. Hard gate for M4.

## M2 (ingestion breadth)
- ~~**I4 follow-up.** Watcher now ignores deletes; add real de-index on delete/rename (remove PG + Qdrant rows).~~ **Fixed 2026-07-08.** `desktop/main.js`'s chokidar `unlink` handler now calls the existing `POST /forget` (already used by `/capture`'s privacy purge for the same delete+cascade) with the deleted file's path. Previously `unlink` only scheduled a git snapshot — the note/chunks/vectors stayed orphaned in Postgres/Qdrant forever, so search/Ask could keep surfacing content for files no longer on disk. Verified end-to-end against the live backend (reindex a real file → confirm findable → forget → confirm gone: `{"forgotten": 1}`).
- Chunker: split single paragraphs that exceed target_max; implement small-chunk merge (target_min currently unused).

## Research item: layered Persona/Scenario retrieval (2026-07-08, from TencentDB Agent Memory)
`TencentCloud/TencentDB-Agent-Memory` (github.com/TencentCloud/TencentDB-Agent-Memory, MIT) uses a semantic pyramid — L0 Conversation → L1 Atom (facts) → L2 Scenario (scene blocks) → L3 Persona (profile) — with deterministic drill-down from any abstraction back to raw evidence. Published benchmarks: PersonaMem accuracy 48%→76% (+59% relative), SWE-bench 58.4%→64.2% with −33% tokens, measured over continuous long-horizon sessions (50 consecutive tasks/session).

**Why this is a real candidate fix, not just a competitor note:** it's a direct, more sophisticated answer to the exact miss pattern found in the 2026-07-08 LoCoMo run (see above) — "right session, wrong turn by 1-6" on category-1 questions, i.e. dense embeddings failing to disambiguate many topically-similar turns within one long conversation about the same entities. TencentDB's fix isn't better embeddings or fusion weights — it retrieves at a distilled Scenario/Persona level instead of raw-chunk level, so near-duplicate turns get collapsed into one higher-level abstraction before retrieval even happens.

**Scoped next step (not started):** prototype a Scenario-layer distillation pass over upkeep's existing topic-folding output — group chunks by (entity, time-window) into scene-level summaries, retrieve against those first, drill down to raw chunks only when the query needs turn-level detail. Validate with the now-fixed LoCoMo harness (before/after on the same 10-conversation run) before touching production retrieval — same discipline as the exact-lane regression lesson.

**Ablation done 2026-07-09 — cheap breadth levers RULED OUT (negative result).** Before building the distillation layer, tested whether the miss is just a windowing problem via two env-gated knobs (`LORE_CAND_LIMIT`, `LORE_RERANK_POOL`) on the full 5,882-note bench data, 300-question subset, identical questions per config:
| config | r@1 | r@5 | r@10 | MRR |
|---|---|---|---|---|
| baseline 40/20 | 0.473 | 0.697 | 0.753 | 0.569 |
| rerank pool 40 | 0.467 | 0.703 | 0.760 | 0.568 |
| fetch 80 + rerank 40 | 0.467 | 0.703 | 0.763 | 0.569 |

Doubling both candidate fetch (40→80) and rerank pool (20→40) moved recall@10 by 1 question / 300 and left r@1 flat-to-down — pure noise. **Conclusion:** the missed gold turns are NOT retrieved-but-under-ranked; they're not surfacing from dense+BM25 at all even with a 2× wider candidate net. So the ~22% miss ceiling is a genuine semantic-retrieval limit, not a windowing bug — the knob change was reverted (nothing ships that doesn't move the number). This *strengthens* the case that only a structural fix (Scenario/Persona distillation, or better embeddings/query-expansion) can move it; breadth tuning cannot. NB: earlier miss-category analysis showed 55/75 sampled misses were LoCoMo temporal (cat-4) + adversarial-entity-swap (cat-5) questions — benchmark-hard by design and unfixable by *any* retrieval change — so the true addressable miss population (cat-1 "right session wrong turn") is smaller than the raw 22% and a distillation prototype must be measured on that slice specifically, not the aggregate.

### Three more TencentDB-informed items (2026-07-09), not yet started
- **Symbolic short-term memory (offload + node_id drill-down).** TencentDB offloads verbose tool logs to external files, keeps only a compact symbol graph with `node_id` refs in the agent's active context. Maps naturally onto Lore's existing chunk/`heading_path` anchor system — Lore Hooks currently embeds full prompt/tool-output text from Claude Code sessions; only embedding a compact structured summary (with anchors back to the raw captured file) would cut embedding/storage cost and reduce noise competing in the vector store. Most valuable for the memory-bus agent-fleet use case (Wingman/h-cli/Agent Hub), where sessions are long and tool-output-heavy.
- **Formalize the drill-down guarantee.** Lore already has most of the pieces (`edges.evidence` quotes, Ask citations, `/trace`) but there's no explicit, tested end-to-end guarantee (Ask answer → cited chunk → note → original capture/source). Mostly a docs + test-coverage task, not new architecture — cheap, and directly reinforces the "recall you can trust" positioning.
- **Long-horizon eval mode.** TencentDB benchmarks over continuous long-horizon sessions (e.g. 50 consecutive SWE-bench tasks/session) to simulate real context-accumulation pressure, not isolated single-turn queries. Lore's nightly/LoCoMo evals are currently single-query-at-a-time. A long-horizon mode would make Lore's own published numbers more credible and directly comparable to how Mem0/TencentDB report theirs.
- **Ship a native OpenClaw plugin.** `openclaw plugins install @tencentdb-agent-memory/memory-tencentdb` proves OpenClaw's plugin architecture is a real, working distribution channel. A `lore` OpenClaw plugin would be a third, low-cost, now de-risked distribution channel alongside the planned `lore-integrate` Claude Code skill and MCP registry listings.

## Stale backlog items corrected (2026-07-08)
- **I2 ("real hybrid recall") was stale.** Verified `core/lore/qdrant_store.py::search_hybrid` already uses real Qdrant-native BM25 sparse vectors (`using="bm25"`) fused via native RRF, not term-overlap reranking of dense candidates as the old note described. Already fixed in an earlier milestone without the backlog being updated. No code change needed — removing the stale claim so it doesn't get "fixed" twice.
- **I3 ("`/ask` trusts client-supplied scopes") is accurate, not stale — correctly flagged, still open.** `_authorize_read` in `core/lore/api.py` genuinely passes through `principal_scopes` unvalidated in local/desktop mode (comment: "solo/desktop unchanged") and only enforces server-derived membership once `_server_mode()` is on. This is the real, correctly-identified hard gate for multi-user/team scopes (M4/B2B) — intentional for solo use today, not something to patch piecemeal.

## Later
- `synthesize()` is a deterministic template, not an LLM NL answer (spec §4.5) — swap in LLM generation behind the existing seam.
- Connection pool instead of one shared psycopg connection in api.py.

## LoCoMo benchmark findings (2026-07-08 full 10-conversation run)
Full published-scale run: 5,882 notes, 1,982 questions scored. recall@1 0.478, recall@5 0.715, recall@10 0.777, MRR 0.581, p50 2.9s. This measures retrieval recall@k of the gold evidence turn — **not** end-to-end QA correctness, so it is not directly comparable to Mem0's published LoCoMo score (91.6) without reconciling metric definitions first.
- **Fixed:** gold evidence occasionally packs multiple dia_ids into one semicolon-joined string (`"D8:6; D9:17"`) instead of separate list entries; `score_conversation()` didn't split on `;`, so that question could never be scored correctly. `eval/bench_locomo.py` now splits.
- **Fixed (real, not just interactive-session-scoped):** `eval/gen_gold.py` and `eval/run_nightly.py` both hardcoded a default scope of `"engineering"`, but the vault's actual configured scope is `"research"` (see `lore-config.json`). The scheduled `LoreNightlyEval` task (`schtasks`, daily 03:00, no env vars) has almost certainly been silently reporting 100% stale-gold for weeks. Both scripts now auto-discover tenant/scope from the desktop config the same way the token already is, with env var override still taking precedence.
- **Investigated, not a bug:** hypothesized recency-decay bias suppressing early-session notes. Measured the actual effect at a 5-month gap: ~6% boost differential at `RECENCY_WEIGHT*0.3` dampening for undetermined query intent — real but too small to be the primary driver, and the code already deliberately dampens this case (comment: "history queries must not drown older decisions"). No change made.
- **Root cause identified, not yet fixed:** the dominant miss pattern is "right session, wrong turn by 1-6" on simple single-hop questions (LoCoMo category 1) — dense embeddings struggling to disambiguate many topically-similar turns within a long conversation about the same entities. A real fix (richer chunk context, stronger keyword disambiguation for detail-specific queries) needs a measured before/after pass now that the gold set and gate are trustworthy again — not a speculative tuning change (see the exact-lane regression this same day for why: 6408b12).
- Miss rate also concentrates heavily (73% of misses, category breakdown `{1:15, 2:3, 3:2, 4:33, 5:22}`) in LoCoMo's temporal-reasoning and adversarial-entity-swap categories — expected difficulty by benchmark design, not a Lore-specific defect.
