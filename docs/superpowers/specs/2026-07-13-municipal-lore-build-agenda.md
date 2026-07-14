# Municipal LORE — Build Agenda (Claude ⇄ Sol debate, converged 2026-07-13)

Two-round architecture debate between Claude (Opus, this repo) and Sol (Codex CLI) over the five
user-approved municipal workstreams. All positions below are **converged** — disagreements were
argued and resolved, not averaged.

## Repo corrections established during the debate (both agreed, verified)

- `relations.py` is **not** wikilink-only anymore: it has discounted co-mention + entity-pair
  extraction (`build_title_index()`, `extract_entity_pairs()`).
- `GET /digest` (api.py:737) is **tenant-wide with no scope ACL** — a live confidentiality gap,
  not just municipal prep. Fixing it is a security fix.
- `recall.py` has **no 1-hop graph expansion**; the live pipeline is exact-ID lane → dense/BM25
  RRF → rerank blend → session downweighting. README oversells this and needs correcting.

## Workstream decisions

### W1 — Governance schema: ownership + legal citations
- Ownership is administrative **fact**, never cue-lexicon inference. Four roles, all in schema from
  day one (intake requires only `record_owner` + `custodian`; others optional):
  `record_owner`, `custodian`, `reviewing_department`, `approving_body`, each with
  `valid_from` / `valid_to` (the clerk can be legal custodian while Planning owns the workflow).
- Legal-status edges `amends` / `repeals` join the `supersedes` family but at **near-deterministic
  confidence (0.95–1.0)** with effective dates — not the 0.65–0.70 semantic gates.
- Canonical citation IDs required (jurisdiction + year normalized): "Resolution No. 88" is
  ambiguous without them. Citation grammar is a regex lane (like the exact-ID lane), no LLM in v1.
- **Why P0:** ingesting a 46k-doc corpus before this schema exists creates instant migration debt.

### W2 — Upkeep/cull cadence: triggered, weekly backstop
Shipping defaults (pending sweep confirmation), whichever fires first:
- ≥ **75 unfolded session notes**, OR
- ≥ **8% chunk growth** since last fold, OR
- ≥ **1000 unfolded session chunks**, OR
- **contamination trigger:** raw session chunks > **15% of top-8** results on the sentinel eval set
  → fold immediately.
- Weekly scheduled fold remains as the floor/backstop.

Test protocol (one-time offline sweep to set the real numbers):
- `eval/session_bloat_eval.py` on a 12-scope municipal-like fixture, 240 gold queries
  (20/department: exact citations, ownership, policy lookup, meeting/action history).
- Add raw session notes in increments of 25 notes / 250 chunks, **no upkeep between increments**;
  re-run all queries per step; measure recall@5, MRR@10, nDCG@10, contamination rate.
- Threshold = smallest step where recall@5 drops >2 pts absolute OR MRR@10 drops >3 pts OR
  contamination >15%. Operational default = **80% of observed failure point**, capped at the
  shipping defaults above.
- Nightly CI runs a **60-query sentinel subset** (5/department, weighted to citation + ownership);
  the full 240 runs only on retrieval-code/corpus-transform changes or CI label
  `full-retrieval-eval`.

### W3 — Municipal system integration (permitting / work orders)
- **No vendor connectors in core.** Ingestion = boring sidecar workers (cursors, retries,
  idempotency keys, rate-limit handling, dead-letter queue). **MCP is for actions only**, not
  scheduled ingestion.
- Table ownership split: connector **sidecar** owns `source_systems`, `sync_runs`,
  `external_record_events`, vendor lifecycle. **Core** owns only governance invariants —
  `retention_schedule`, `legal_hold`, `record_series`, `disposition_log`, canonical note ID,
  action receipts where legally required — because deletion policy is enforced at the store and
  must survive a connector being uninstalled.
- Sync v1 read-only: vendor → worker → normalized record → `/ingest`. Scope derived **server-side**
  from source system + record classification, never from connector payload. External deletions
  tombstone (never hard-delete under retention/hold).
- Phase 2 actions: Lore proposal → human confirm → vendor MCP action server → receipt indexed back.
  Writes need idempotency keys, vendor receipts, and **compensating actions** (an external action
  is not a file move; "undo" doesn't apply).
- Auth: per-tenant vendor service accounts/OAuth, credentials in KMS-style storage outside app
  tables; vendor MCP tools receive action payloads only, never broad Lore search access.
- **Vendor pick: Accela first** (permitting is the spec's wedge use case); Cityworks waits until
  the connector boundary is proven.

### W4 — Personalization in the quality-weighting stage
- Bounded deterministic multiplier **×0.94–1.06** (not 0.90–1.15 — municipal answers can't have
  "personalized truth"), role/department-weighted, learned from ask-history accepts.
- **Disabled entirely** for public-records, council, legal-status, and compliance workflows.
- Never widens results — re-ranks only within the ACL-authorized set.
- The personalization delta appears in the **per-answer scope trace** so it is auditable.

### W5 — Recurring reports: council-meeting digest as first Standardized Workflow
- Prerequisite zero: **scope-enforce `/digest`** (P0 security fix, see below).
- Then: Report Template registry — template = {scope filter, query set, section structure,
  schedule, output format} — with saved report artifacts, citations, **source hashes**, and
  **template versioning**. This registry is the seed of the Standardized Workflows catalog.

## Converged priority stack

| P | What | Rationale |
|---|---|---|
| **P0** | `/digest` scope fix · W1 governance schema · W2 eval gates | Live security gap; schema-before-ingest kills migration debt; eval gates make everything after measurable |
| **P1** | Scoped digest/report product (W5 v0) | Cheapest visible win once the P0 substrate exists; carries scope trace + personalization-delta placeholder |
| **P2** | Accela sidecar ingestion (W3 read-only) | Proves the connector boundary on one vendor |
| **P3** | Governance operations | Retention/disposition/legal-hold enforcement via jurisdiction profiles |
| **P4** | Graph expansion in recall · W4 personalization · second connector · W3 actions | Only after evals and scope boundaries are stable |

## 50/50 work split

- **Claude (this repo, implementation PRs):** `/digest` security fix; W1 core schema + migrations;
  W2 eval wiring/CI; README correction where recall is oversold.
- **Sol (Codex, architecture/eval/product contracts):** 240-query gold set + threshold sweep;
  jurisdiction profile spec with CA seed; Accela sidecar contract; W5 scoped-answer trace contract.
- Split is by workstream, not by file, to avoid merge collisions.

## P0 first-PR list

1. **Scoped `/digest`** — `core/lore/api.py`, `core/tests/test_digest.py`. Require caller-visible
   scope; deny tenant-wide digest without authorized scope; filter notes before digest assembly.
   Tests: unauthorized scope excluded; tenant param alone no longer leaks cross-scope content.
2. **Municipal governance schema** — DB migration + `core/lore/db.py` + `relations.py` + tests.
   Four ownership roles with validity windows; retention/legal-hold/series/disposition fields;
   deterministic `amends`/`repeals` with effective dates + canonical citation IDs.
   Tests: migration round-trip, legacy-note compat, effective-date ownership lookup.
3. **Jurisdiction profiles** — `config/jurisdictions/ca.json` +
   `schemas/jurisdiction_profile.schema.json` + loader. Versioned **data** (response clocks,
   retention classes, meeting-notice timing, holiday calendar, citations) — CA is the first
   profile, never hardcoded. Tests: no CA constants in policy code.
4. **Retrieval eval gates** — `eval/gold/municipal_240.jsonl`, `eval/gold/nightly_sentinel_60.jsonl`,
   runner + CI workflow. Sentinel is a strict subset; contamination@top8 regression; full run
   label-gated.

## Municipal reality both models flag (jurisdiction-profile content, CA example)

Public-records law (CPRA Gov. Code §7920.530, 10-day determination clock §7922.535), open-meeting
timing (Brown Act §§54954.2/54956 — 72h regular / 24h special agendas), records destruction limits
(§34090 — minutes/ordinances/resolutions protected), legal holds, disposition logs, clerk approval
states, ADA/alternate-format output, agenda-packet version history, public-comment capture,
vote/roll-call metadata, redaction/exemption review.

## Three questions for Allison before build lock

1. **Launch jurisdiction** — is CA the authoritative first profile? Need the retention schedule
   source, response clocks, meeting-notice rules, holiday calendar.
2. **Corpus architecture** — cloud-fed multi-tenant SaaS, local-first/customer-hosted, or hybrid?
   Decides storage, deletion, connector-uninstall behavior, tenant isolation. (Note: Lore's
   `/ingest` deliberately embeds locally to avoid data-leak paths — this collides with the spec's
   "cloud team vectorizes" assumption and must be negotiated.)
3. **Authorization model at launch** — departments only, or roles + project/case scopes +
   legal/compliance exclusions? Who may approve external actions and disposition?
