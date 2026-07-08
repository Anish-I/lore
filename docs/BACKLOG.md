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
- **I4 follow-up.** Watcher now ignores deletes; add real de-index on delete/rename (remove PG + Qdrant rows).
- Chunker: split single paragraphs that exceed target_max; implement small-chunk merge (target_min currently unused).

## Later
- `synthesize()` is a deterministic template, not an LLM NL answer (spec §4.5) — swap in LLM generation behind the existing seam.
- Connection pool instead of one shared psycopg connection in api.py.
