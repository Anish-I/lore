# Lore Backlog

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
