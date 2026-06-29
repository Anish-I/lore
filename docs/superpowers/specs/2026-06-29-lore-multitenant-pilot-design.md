# Lore Multi-Tenant Pilot — Design Spec

**Date:** 2026-06-29
**Status:** Approved design (pre-implementation)
**Roadmap item:** #4 — Team/enterprise cross-vault scopes + auth (the solo → product pivot)
**Debate partners:** Claude (author) + Codex (adversarial review)

## 1. Context

Lore is a working **local-first** knowledge OS (Electron desktop + Python FastAPI `:8099` + Qdrant +
Postgres). Recall = hybrid dense (BGE) + BM25 + cross-encoder rerank, with the ACL filter applied
**inside** the query. Scopes `private / team / enterprise` exist in the schema, but there is no auth,
no server, and no multi-user story — everything runs on one machine.

We chose the **product-first** path: build cross-vault permissioned recall before packaging polish or
the edge agent, because the defensible moat is permissioned cross-org recall (a self-hostable Glean
alternative). This spec designs the **smallest shippable multi-tenant slice** that proves the thesis.

## 2. The pilot thesis (what we are proving)

> Two people on one team can each keep their own vault, push their **team**-scoped notes to a shared
> server, and either of them can Ask a question whose answer draws on **both members'** team notes —
> while each person's **private** notes never leave their own laptop and are never visible to the other.

If that works, leak-proof, the product hypothesis is validated. Everything else is scale-up.

## 3. Locked decisions (from the design debate)

| Decision | Choice | Rationale |
|---|---|---|
| **Deployment** | **Hybrid** — server URL is config; same code self-hosted by the team *or* we-hosted | Build the client/server boundary once; defer the hosting business decision per-customer. |
| **Threat model** | **Server-readable** team chunks (plaintext, encrypted at rest/transit, ACL, audit log). `private` is zero-knowledge (never sent). | If the server runs BM25 + rerank over chunk *text*, it already sees plaintext; E2EE would kill server-side recall (a research project). Self-host is the answer for teams who won't accept we-host. |
| **Embeddings** | **Server-side** (one BGE version, one chunker, one reranker) | Client-side vectors buy ~nothing once the server reads text for rerank; server-side avoids "my laptop made weird vectors" drift and eases backfills. |
| **Auth** | **Invite-based email OTP → access JWT + refresh token** (refresh in OS keychain). Membership resolved **server-side**, never trusted from client claims. | Minimum that is not a toy. OAuth/SSO add Electron redirect edge cases + enterprise account ambiguity before the ACL model is proven — deferred. |
| **Sync** | **Push-on-write** + a client **outbox** that retries until acked; periodic scan is reconciliation only | Simple, durable, offline-tolerant. No collaborative merge in the pilot. |
| **ACL recall** | Filter **before** scoring, inside **both** dense and BM25 prefetch; reranker sees only authorized chunks | Retrieve-globally-then-filter leaks via counts, timing, and ranking artifacts. |

## 4. Architecture

```
┌────────────────────── User A laptop ──────────────────────┐
│ Lore Desktop (Electron)                                   │
│  • local core backend (:8099)  → private scope ONLY       │
│  • Outbox (team/enterprise notes) ──push──┐               │
│  • Ask: private → local | team → server   │               │
└───────────────────────────────────────────┼──────────────┘
                                             │ HTTPS + JWT
┌──────────────── Lore Server (configurable URL) ───────────┐
│ FastAPI (reuses core/ recall+index+db in "server mode")   │
│  • Auth: OTP → JWT, membership tables                     │
│  • Sync: PUT/DELETE /sync/notes  → chunk → embed → index  │
│  • Recall: ACL-filtered hybrid + rerank across members    │
│  • Postgres (truth + tenancy + ACL) · Qdrant (vectors)    │
│  • Audit log                                              │
└────────────────────────────────────────────▲─────────────┘
                                             │ HTTPS + JWT
┌────────────────────── User B laptop ───────┼──────────────┐
│ Lore Desktop … team notes push ────────────┘              │
│ Ask "…" (team) → server → answer spans A+B team notes     │
└───────────────────────────────────────────────────────────┘
```

The **Lore Server** is the existing `core/` recall/index/db reused in a multi-tenant "server mode",
plus four new concerns: auth, tenancy, sync endpoints, and member-spanning ACL recall. The desktop
client gains: login + token storage, an outbox/sync module, scope-aware Ask routing, and server-URL
config. `private` scope is structurally incapable of entering the outbox.

## 5. Components & interfaces

### 5.1 Lore Server
- **Auth module** — `POST /auth/invite` (admin creates an invite), `POST /auth/otp/request`
  (email → OTP), `POST /auth/otp/verify` (OTP → access JWT + refresh), `POST /auth/refresh`.
  JWT carries only `sub`, `iss`, `exp` (and at most coarse `org_id`); **authorization always hits
  membership tables**, never trusts JWT claims for team access.
- **Sync endpoints** —
  - `PUT /sync/notes/{vault_note_id}` body `{content_hash, updated_at, scope, acl_grants, title, body}`
    → upsert note, (re)chunk, embed server-side, index in Qdrant + BM25, assign monotonic
    `server_version`, write audit row. Idempotent on `content_hash`.
  - `DELETE /sync/notes/{vault_note_id}` → tombstone (`deleted_at`), remove/mark-excluded in index.
- **Recall endpoint** — `POST /ask` `{question}` (JWT) → resolve caller's authorized `team_id`s from
  membership → hybrid recall with `team_id IN authorized AND deleted_at IS NULL` applied in **both**
  prefetches → rerank authorized candidates → cited answer. Also `POST /search` (ranked chunks).
- **Audit log** — every sync write and every recall query (caller, authorized scopes, candidate count)
  for leak forensics.

### 5.2 Desktop client
- **Login UI + token storage** — OTP flow; refresh token in OS keychain (`keytar`/Electron safeStorage),
  access token in memory.
- **Outbox + sync** — on note write/delete, if `scope ∈ {team, enterprise}` enqueue an outbox row;
  a worker drains it to the server with retry/backoff; a periodic reconciler re-scans dirty team notes.
- **Scope-aware Ask** — `private` questions hit the local backend; `team/enterprise` questions hit the
  configured server. (Cross-scope answer-merge is deferred — see §9.)
- **Config** — `serverUrl`, current org/team, auth state. `private` notes are never enqueued.

## 6. Data model (server Postgres)

```
users(id, email, created_at)
orgs(id, name)
teams(id, org_id, name)
memberships(user_id, org_id, team_id NULL, role, status)        -- status: invited|active|revoked
vaults(id, owner_user_id, org_id)
notes(id, vault_id, owner_user_id, scope_type, scope_id,
      content_hash, server_version, title, body, deleted_at)
chunks(id, note_id, heading_path, text, vector_id, bm25_doc_id)
scope_grants(scope_type, scope_id, principal_type, principal_id, permission)
audit_log(id, ts, actor_user_id, action, scope_ids, detail)
```

**Pilot simplification:** `scope_type = 'team'` only; one org, one team; a grant is **implicit** from
active team membership (`scope_grants` table exists but is barely used until per-note sharing lands).

## 7. Sync protocol details

- **Idempotency key:** `client_id + vault_id + note_id + content_hash`. A repeat push of the same hash
  is a no-op (200).
- **Deletes:** tombstone (`deleted_at` set); index entry removed synchronously or marked excluded.
  Never hard-delete immediately (lets reconciliation detect divergence).
- **Conflict rule (pilot):** last-writer-wins per note by `updated_at`; if the server's current
  `content_hash` differs from the client's `base`, surface a local "sync conflict" — no auto-merge.
- **Ordering:** server assigns a monotonic `server_version`; clients store it to drive incremental pulls
  later (pull is out of pilot scope — pilot is push + server-side Ask only).

## 8. Security / leak model (the part that must be correct)

- `private` scope is **never** enqueued, pushed, embedded server-side, or logged. Enforced structurally
  in the outbox and asserted by test.
- Team recall **filters in the candidate-generation stage** for both dense and BM25; the reranker is fed
  only already-authorized chunks. No global retrieve + post-filter anywhere.
- Cross-team isolation must hold against **retrieval, counts, timing, and ranking** — an unauthorized
  caller must not be able to confirm a chunk exists by any observable.
- Transport TLS; team data encrypted at rest. Audit log on every write and query.
- Honest external framing: *private = zero-knowledge to the server; team = shared-by-definition and
  readable by the server you choose (self-host if you won't accept we-host).* Never marketed as
  server-blind.

## 9. Out of scope (explicitly deferred)

SSO/SCIM, Google OAuth; multiple orgs; nested teams; per-note custom sharing (`scope_grants` beyond
membership); E2EE / server-blind recall; client-side embedding mode; collaborative editing / CRDT
merge; incremental server→client pull; cross-scope answer-merge (private-local + team-server fused into
one answer). Each is a follow-up once the pilot slice is proven leak-proof.

## 10. The de-risking spike (Phase 0 — build FIRST)

Before auth UI, outbox polish, or any client work, prove the spine end-to-end:

1. One `team` note flows desktop → `PUT /sync/notes` → server chunks/embeds/indexes it.
2. A second user (same team) runs ACL-filtered hybrid + rerank and **gets that note back, cited**.
3. **A failing test** demonstrates that a user who is *not* in that team **cannot** retrieve, count, or
   rerank the chunk — across dense, BM25, and rerank paths.
4. Assert `private` notes never appear in the outbox, the sync payloads, the server index, or any log.

The spike's leak-proof test is the gate. If it can't be made green without weakening the ACL, the
architecture is wrong and we stop and rethink before building the rest.

## 11. Phasing (for the implementation plan)

0. **Spike** — vertical thread + leak-proof test (§10).
1. **Auth** — OTP → JWT + refresh, membership tables, server-side authorization middleware.
2. **Sync** — outbox + `PUT/DELETE /sync/notes` + tombstones + idempotency + reconciler.
3. **Recall** — member-spanning ACL hybrid + rerank on the server; `/ask` + `/search`.
4. **Client** — login UI, keychain token storage, scope-aware Ask routing, server-URL config.
5. **Pilot hardening** — audit log, conflict surfacing, self-host packaging of the server (one-command).

## 12. Verification

- **Spike:** the leak-proof test (§10) is green for authorized recall and red→green-impossible for the
  unauthorized caller; `private` exclusion asserted.
- **Auth:** OTP issues a JWT; expired/forged JWT rejected; team access derived from membership, not JWT.
- **Sync:** push a team note → appears in server recall; re-push same hash = no-op; delete → tombstoned
  and absent from results; outbox drains after transient server downtime.
- **Recall:** User B's Ask returns User A's team note, cited; an unauthorized user gets zero candidates
  and identical timing/counts whether or not the note exists.
- **Privacy:** automated assertion that no `private` note id/body/vector/text ever reaches the server or
  its logs.
- **Hybrid:** the server self-hosted by a "team" (separate Postgres/Qdrant) yields the same recall as
  we-hosted, proving the boundary is config-only.

## 13. Critical files (anticipated)

- **Server:** new `server/` (or `core/lore/server_*`) — `auth.py`, `tenancy.py`, `sync.py`,
  `recall_acl.py` (reuses `core/lore/recall.py`, `index.py`, `db.py`, `qdrant_store.py`), `audit.py`.
- **Client:** `desktop/main.js` (outbox worker, server-URL config, keychain), `desktop/preload.js`
  (auth + sync + remote-ask bridge), renderer login UI + Ask scope routing.
- **Shared contract:** the sync wire format and the ACL predicate, documented once and tested on both
  sides.
