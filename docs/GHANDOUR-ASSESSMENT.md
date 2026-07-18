# Lore — Handover Assessment (Ghandour)

**Author:** Mahmoud Ghandour · **Date:** 2026-07-17 · **Branch:** `ghandour-branch`

Gap analysis on taking over the `lore` repo from the prior developer. Inputs reviewed:
the codebase, `README.md` / `docs/ARCHITECTURE.md` / `docs/BACKLOG.md`, the municipal
build-agenda (`docs/superpowers/specs/2026-07-13-municipal-lore-build-agenda.md`), the
handover whiteboard, the 4-test user-research plan, and the untracked `LORE.md` spec.

---

## 0. Headline: this repo is two products under one name

| | **Lore knowledge-OS** | **Municipal LORE** |
|---|---|---|
| What it is | Obsidian-replacement / AI memory: captures Claude Code & Codex sessions, knowledge graph, recall-obsessed RAG | Workflow/task engine for city governments: to-do-from-email, one-click Standardized Workflows (FOIA/budget), shared cloud VKG corpus, municipal RBAC |
| Where it lives | **The actual codebase** — `core/lore/`, `desktop/`, MCP server | `LORE.md` spec + whiteboard + the 4-test plan |
| Maturity | **Built & tested** — milestones M1–M5, eval gate (recall@5 0.848), CI | **~0% built** — no municipal / FOIA / workflow / to-do backend exists in code |

Everything the whiteboard, the `LORE.md` spec, and the 4 user-research tests describe is a
**different product** from what the codebase currently is. The build-agenda proposes building
Municipal LORE *on top of* the existing retrieval engine — a sound plan, but its P0→P4 stack
is **untouched**, and it's gated on a product decision that isn't mine to make (see §6).

---

## 1. What's built (and solid)

The knowledge-OS is real, mature, and tested:

- **Hybrid recall** — dense (BGE) + BM25 sparse → RRF fusion → cross-encoder rerank → exact-ID
  lane → session downweighting. Two-stage payloads live; nightly gate passing (recall@5 0.848
  vs 0.822 median).
- **Knowledge graph** — notes + typed edges, supersession/demotion, inverse edge labels.
- **Upkeep** — topic-folding, ADD-only extraction (Mem0-informed), retrieval-time contradiction resolution.
- **Surfaces** — Ask, People, Hooks (auto-capture from agent sessions), Wizards, `/digest` Home view, `/graph`, `/trace`.
- **Integrations** — MCP server (`lore_remember`/`lore_recall`), `lore-integrate` skill, ingestion (PDF/DOCX/URL).
- **Infra** — Electron desktop app + Python FastAPI core (port 8099), SQLite (local source of truth) / Postgres (team), embedded Qdrant, eval harness + CI.

## 2. What's not built (the municipal spec)

None of the spec's headline features exist in code:

- Standardized Workflows / the one-click "Tool list" (FOIA, budget, unsubscribe-from-spam, etc.)
- To-do generation from pasted/ingested email
- The "restricted document" result copy (Test 3's 3 message variants)
- Cloud-fed VKG shared corpus
- Municipal RBAC classification (Public / HR / Legal / CJIS-excluded) as a governance layer
- Governance schema / eval gates specific to municipal use

## 3. The 4 user-research tests vs. reality

| Test | What it was | Status in code |
|---|---|---|
| 1 | Baseline usability across Claude/ChatGPT/Gemini, **no LORE** | N/A — no build required |
| 2 | Clickable Tool-List button mockup, **no backend** | **Not built** |
| 3 | To-do confirm/dismiss from pasted emails + 3 "restricted document" copy variants | **Not built** |
| 4 | One real working Standardized Workflow (FOIA) against real sample docs | **Not built** |

The 4 tests validate a product that is ~0% implemented. They are research on Municipal LORE,
not acceptance tests for the knowledge-OS.

## 4. Bugs & security

| Item | Severity | Status |
|---|---|---|
| **`/digest` cross-scope leak** — endpoint ran `select … from notes where tenant_id=%s` with **no ACL** and ignored the auth header; any caller got every note title in the tenant, any scope. Municipal build-agenda P0 ("live confidentiality gap"). | High | **FIXED** on this branch (`2ceb7cc`). Mirrors `/graph` ACL across backend → IPC → preload → renderer; new `test_digest_enforces_scope_acl` proves tenant-alone leaks nothing. 4/4 digest tests pass. |
| **I3 — `/ask` local-mode scope trust** | Medium | **By design — do not patch.** `/ask` already fully enforces scopes in server mode (`LORE_SERVER_MODE=1` → membership-derived, client can't widen). Local passthrough is deliberate for the single-user, 127.0.0.1-bound desktop. Backlog: *"intentional for solo use today, not something to patch piecemeal."* The real fix is a **deployment** choice (run server mode for any hosted/multi-user install), not a code change. |
| **`/ingest-url` TOCTOU** — resolved-IP SSRF check, then urllib re-resolved during fetch (DNS-rebinding window) | Low (desktop) / High (hosted) | **FIXED** on this branch (`0afceee`). Fetch now pins to the validated IP via custom HTTP(S) connection classes — no second lookup; TLS still verified against the real hostname. +pin test proves the dial target and single-resolve. |

## 5. Needs refinement

- ~~README oversells recall~~ **— checked, false alarm.** Verified README line 73 against
  `recall.py`: the graph genuinely informs *ranking* (note `importance` = weighted typed
  in-degree per `relations.recompute_importance`, applied as a multiplier in
  `_apply_note_signals`; entity-title matches → `ENTITY_BOOST`) and the README already states
  it is *"not a candidate-expansion hop."* README is accurate — no change needed.
- **`synthesize()` is a deterministic template**, not an LLM NL answer (spec §4.5). The seam
  exists to swap in generation — deferred, but worth flagging for the municipal "answer" UX.
- **Single shared psycopg connection** in `api.py` — a pool is wanted before heavy agent traffic.
- **`LORE.md` is untracked** — the prior dev never committed the municipal spec; it's a loose
  working file in the tree. Decide whether it becomes the committed product-of-record or stays out.

## 6. The blocking decision (for Allison / Anish)

The municipal build cannot start until these are answered — each changes what we build, so
guessing wrong wastes weeks. Send **#1 and #2 at minimum**; the rest are downstream of those.

1. **Which product is this repo becoming?** Does `lore` stay the knowledge-OS with Municipal
   LORE built *on top*, or does the repo pivot to the municipal product with knowledge-OS
   features frozen? (Build-agenda assumes "on top of" — confirm before any schema lock.)

2. **Ingestion: local-embed or cloud-vectorize?** *(the hard architectural collision)* Today
   `/ingest` embeds **locally** by design (no data leaves the box). The spec assumes a **cloud
   team vectorizes** a shared VKG. These are mutually exclusive. For municipal customers — does
   document content leave the customer's environment to be vectorized centrally, yes or no?
   CJIS/HR data makes this a legal question, not just technical.

3. **Who owns RBAC classification?** Is there an existing source of truth for who-sees-what (AD/SSO
   groups, an existing muni system) to sync scopes from, or are we inventing the Public/HR/Legal/
   CJIS scheme?

4. **First deliverable — a real workflow or another mockup?** Build the FOIA workflow end-to-end
   against real docs (Test 4), or keep producing clickable mockups (Tests 2/3) for more research
   first? Completely different quarter of work.

5. **Do the real sample documents and a target municipality exist?** Test 4 needs real FOIA
   request/response samples + source docs, and a specific city/agency (their retention rules,
   their FOIA statute) — or is this still generic?

### 6a. Answers — locked 2026-07-17 (Anish)

1. **The repo becomes an enterprise work-tool built ON TOP of the knowledge-OS.** Not a
   municipal pivot; the knowledge-OS is not frozen. Core: **team scopes + wizards + plugins**
   that automate "people work" (email → to-dos/tasks) over a **shared memory base**.
   Municipal/FOIA is one *vertical*, not the product identity.
2. **Embedding is tier-dependent (the collision was a false dichotomy).** Personal use =
   **local embeds, always**. Team/enterprise **server = its own server-side embedding tool**.
   This is exactly the existing `LORE_SERVER_MODE` boundary — no global cloud-vectorize switch.
3. **We invent the scope scheme ourselves**, and tie identity/membership to **Okta SSO**
   (SSO-group → scope mapping is ours to build).
4. **Evolve the existing desktop UI toward simplicity — do NOT rebuild.** Reuse what's there,
   simplify it for the wizard/plugin people-work flows.
5. **No real docs exist.** Generate a **synthetic corpus** (fake email chains, documents,
   presentations, excel sheets) — Anish suggests multi-agent generation — to build and
   validate workflows against.

**Net:** the product-direction conflict is resolved. Build target = enterprise work-tool
(wizards/plugins over email + docs, team scopes, Okta SSO, memory base) on a simplified
existing UI, validated against a synthetic corpus. The build-agenda P0→P4 stack still applies,
reframed enterprise-general rather than municipal-only.

## 7. Recommendation

- **Shipped this pass (no decision needed):** `/digest` scope leak fixed; `/ingest-url` SSRF
  rebinding TOCTOU closed. (The suspected README recall-oversell was checked and is a non-issue
  — the copy already matches the code.) The knowledge-OS security surface is now clean of
  known live gaps in local mode.
- **Do not touch I3** — enforced in server mode, intentional locally. Note it becomes live work
  under the enterprise direction: server mode + Okta SSO is now the target, so `_authorize_read`'s
  server path (and the Okta → scope mapping) is where multi-user auth gets built.
- **Direction is now locked (§6a).** Deliverables, in dependency order:
  1. ~~**Synthetic corpus generator**~~ **— DONE** (`a7f07fe`). `synth/` generates two scenarios
     (enterprise + municipal slice) across email/docx/xlsx/pdf, with ground-truth to-dos; also
     added xlsx ingestion to the extractor (gap found while building it).
  2. ~~**First real people-work wizard** (thread → to-dos)~~ **— DONE** (`cb5cf43`). Extraction
     (LLM seam + deterministic fallback) + `todos` table + confirm/dismiss lifecycle, scope-
     filtered like `/digest`. Verified end-to-end over HTTP; 21/21 tests.
  3. ~~**Surface the to-dos wizard in the desktop UI**~~ **— DONE** (`c53d405`). Evolved the
     existing Wizards view (per §6a #4): a built-in "To-dos from a thread" card opens a drawer
     that pastes a thread → extracts → confirm/dismiss, with Pending/Confirmed/Dismissed tabs
     (full stateful lifecycle). IPC (`todos:*`) forwards scopes on the `digest:get` template;
     new to-dos file under the current place's scope, reads use the viewer's full scope set.
  4. ~~**Okta SSO → scope mapping**~~ **— DONE** (Anish provided the Okta app; client_id
     `0oa15cs51goDdEdok698`). `core/lore/okta.py` mirrors the Google login path: `POST /auth/okta`
     verifies an Okta ID token (RS256 via Okta JWKS + issuer + audience), upserts the user, and
     **reconciles team membership from the token's `groups` claim** through `OKTA_GROUP_SCOPE_MAP`
     (SSO owns exactly the mapped teams; invite-based joins are left untouched). Scopes are
     re-derived from membership — never trusted from the client. This is the real multi-user gate
     behind I3: run server mode (`LORE_SERVER_MODE=1`) with the `OKTA_*` env set and the data
     plane is Okta-authorized. 6 tests added (grant/revoke reconciliation, login, endpoint);
     19/19 auth tests pass. **Config is env-only — no secret in the repo.**
     *Ops note: the shared client secret must be rotated in Okta (it was sent over chat), and the
     desktop still needs its Okta OIDC loopback flow to obtain the ID token it POSTs to
     `/auth/okta` (the server-side gate is complete; the desktop sign-in button is the follow-on).*
