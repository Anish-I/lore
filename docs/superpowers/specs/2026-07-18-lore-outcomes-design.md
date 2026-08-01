# Lore Outcomes Design

**Date:** 2026-07-18
**Status:** Implementation contract
**Builds on:** `2026-07-18-lore-learn-design.md`

## Product thesis

Lore is the durable, user-owned layer above replaceable AI execution engines. A
nontechnical user should be able to ask naturally, return much later, and have
Lore recover relevant history, apply explicit preferences, reuse proven work,
and explain or undo every durable change. Agent infrastructure remains an
implementation detail.

The user-facing model is deliberately small:

- **What Lore remembers:** durable knowledge and an editable personal model.
- **Past work:** first-class session discovery, browsing, and scrolling.
- **Things Lore can do:** approved learned skills, personal Wizards, curated
  knowledge packs, and connected tools in one capability catalog.
- **Connections:** channels and tools Lore can execute through, with explicit
  status and provenance.
- **Review:** pending learning, history, diffs, rollback, and deletion.

## Reuse before expansion

This phase extends existing systems rather than creating competitors to them:

- Notes, chunks, hybrid retrieval, temporal ranking, and supersession remain the
  durable knowledge spine.
- Captured `claude-session`, `codex-session`, and `claude-history` notes remain
  the session store.
- Lore Learn remains the only autonomous skill authoring path.
- Personal Wizards and the curated Wizards/tool catalog become the capability
  ecosystem; they are renamed in product language, not replaced in storage.
- Hooks and MCP remain execution gateways. New channel adapters must enter
  through the same token, tenant, scope, audit, and redaction boundaries.

## Phase 2 vertical slice

### Versioned personal memory

Each `(tenant, owner, scope)` has two bounded documents:

- `memory`: working context Lore should keep available, 2,200 characters.
- `user`: explicit user facts and preferences, 1,375 characters.

The current document is indexed as a `learn-memory` note so normal retrieval can
use it. Every replacement appends an immutable version with origin and optional
session provenance. Writes are redacted before persistence. Rollback creates a
new current version containing the exact selected body. Delete purges the note,
vectors, and version history.

Only user-controlled API, desktop, and CLI surfaces may replace, roll back, or
delete these documents. Agent-facing tools may read them but may not silently
approve their own user model.

The prompt hook injects both documents before task-specific recall. A session
cache freezes the injected pair for one agent session to preserve prompt-cache
stability; a new session receives the latest approved documents.

### First-class session recall

Add one API with three deterministic modes and no LLM call:

- `browse`: newest captured sessions with timestamp and bounded excerpt.
- `discovery`: hybrid retrieval restricted to session source types.
- `scroll`: a bounded character window within one authorized session body.

The matching MCP tool exposes all three modes. Results always include note/session
identity and offsets so a user or agent can continue reading without re-searching.

### Capability discovery and connected execution

The existing capability sources are presented as one catalog:

- active Lore-created skills;
- personal Wizards;
- curated knowledge packs;
- curated tool entries and detected connections.

The first implementation does not invent a second marketplace or connector
runtime. It adds an aggregation contract and outcome tests around the existing
catalog. New channel adapters must later implement a gateway contract with:
`id`, `status`, `capabilities`, `principal`, `scopes`, `last_used`, and an audited
execution result. Secrets never enter notes or learned skills.

## Hermes outcome benchmark

Lore and Hermes are scored from the same frozen fixtures without a judge LLM.
The suite is 100 points:

| Outcome | Weight | Primary evidence |
| --- | ---: | --- |
| Return weeks later | 15 | durable recall beats session echo |
| Natural session recall | 15 | paraphrase recall, browse, scroll |
| Personalization | 10 | exact preference use, zero cross-user leak |
| Workflow reuse | 15 | approved skill activation and patch vs create |
| False-learning resistance | 20 | failed/unverified work creates no durable behavior |
| Understandable undo | 10 | readable history and exact rollback |
| Connected execution | 10 | capture precedes learning; provenance survives |
| Capability discovery | 5 | relevant capabilities exposed without configuration jargon |

Each category is `weight * mean(normalized metrics)`. Any cross-user leak,
unsafe skill creation, or failed exact rollback caps the total at 59. Reports
include per-category score, gate failures, p50/p95 latency, and delta versus a
saved Hermes run.

The repository runner initially reports a **contract-regression score**: whether
the deterministic outcome lanes pass. A 100 in this lane means the implemented
contracts are green; it is not a claim that Lore has beaten Hermes on live-model
answer quality. That claim requires a Hermes artifact generated from the same
fixtures and, later, human-rated natural-language task runs.

## Acceptance criteria

1. Personal memory replacement enforces kind-specific server-side budgets,
   redacts input, indexes the current body, and records an immutable version.
2. History shows provenance without exposing hidden prompts or secrets.
3. Rollback restores the selected body exactly and is itself auditable.
4. Delete removes the current note, all chunks/vectors, and version history.
5. Personal memory is isolated by tenant, owner, and scope.
6. Session recall never returns non-session notes and enforces read scopes before
   browse, discovery, or scroll results are returned.
7. The MCP surface can read personal context and recall sessions but cannot
   mutate personal memory or approve learning.
8. Existing generic recall, skill learning, Wizards, and capture behavior remain
   backward compatible.
9. The deterministic Lore outcome benchmark runs locally and emits machine-
   readable scores. Hermes comparison accepts a saved result produced by the
   same metric schema; it never fabricates an opponent score.

## Deferred work

- Automatic USER profile synthesis remains approval-gated until the editable
  document and rollback UX have shipped and produced false-learning data.
- External channel adapters are implemented one at a time behind the gateway
  contract; this phase does not add credentials or third-party dependencies.
- A hosted Skills Hub requires signing, publisher identity, moderation, and
  update policy. The existing curated catalog is the local proving ground.
