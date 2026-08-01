# API Service: Keys + Personal Defaults + Scopes + Teams — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** lore-arch serves as a dev-friendly API service: bearer API keys, zero-tenancy-param personal mode, opt-in named scopes with grants, minimal teams — per `docs/superpowers/specs/2026-07-28-api-service-design.md`.

**Architecture:** keys are an alternative bearer proof inside the EXISTING identity gate (`require_user`); a key resolves to a user_id and the whole server-mode ACL chain (private_scope_id, tenancy.authorize_scopes) works unchanged. Scope grants union into `tenancy.authorize_scopes` so recall/API inherit them everywhere. New surface mounted directly under `/api/v1/`.

**Tech stack:** existing engine (FastAPI, sqlite/PG dual dialect, pytest sqlite lane).

## Global Constraints
- Key plaintext `lore_sk_<43 urlsafe chars>` returned ONCE at creation; only sha256 hex stored.
- Service mode = `LORE_SERVER_MODE=1` OR `LORE_API_KEYS=1`. In service mode identity is required on data routes; key OR Google-JWT both satisfy it.
- Personal defaults (key-authed, params omitted): tenant = key.tenant_id, owner = key.user_id, write scope = `private:{user_id}`, read scopes = all authorized (private + teams + grants).
- A client can never widen access by naming scopes (intersection semantics preserved).
- No DDL migrations framework — new tables ride `bootstrap_tenancy` (both dialects).
- TDD per task; suite stays green; commit per task.

### Task 1: `apikeys.py` + tables
Files: Create `core/lore/apikeys.py`, `core/tests/test_apikeys.py`; Modify `core/lore/tenancy.py` (_SCHEMA/_SCHEMA_SQLITE: `api_keys`, `scopes`, `scope_grants` tables).
Produces: `create_key(conn, tenant, user_id, label, role='member') -> {id,key,label,role}` (key shown once); `verify_key(conn, raw) -> {user_id,tenant_id,role,id}|None` (updates last_used, rejects revoked); `revoke_key(conn, tenant, key_id)`; `list_keys(conn, tenant)` (no hashes).
Tables: `api_keys(id text pk, tenant_id, user_id, key_hash unique, label, role default 'member', created_at, last_used, revoked int default 0)`; `scopes(scope_id text pk, tenant_id, name, owner_user_id, scope_type default 'shared', created_at)`; `scope_grants(scope_id, user_id, role check in read|write, granted_by, created_at, pk(scope_id,user_id))`.
Tests: roundtrip create→verify; wrong key → None; revoke → None; storage has no plaintext; list hides hashes.

### Task 2: key identity in the API gate + /api/v1/keys
Files: Modify `core/lore/api.py`; Test `core/tests/test_api_keys_auth.py`.
- `require_user(authorization)`: before JWT decode, if bearer starts `lore_sk_` → `apikeys.verify_key`; hit → return user_id (stash principal in a contextvar `_PRINCIPAL` with tenant/role); miss → 401.
- `_service_mode()` = `_server_mode() or os.environ.get("LORE_API_KEYS")=="1"`; `_authorize_read/_authorize_write/_require_user_in_server_mode` switch from `_server_mode()` to `_service_mode()`.
- Personal defaults inside `_authorize_read/_authorize_write`: when principal came from a key and tenant is missing → principal tenant; write scope missing → `private:{user}`.
- Endpoints (declared at `/api/v1/keys`, tag v1): POST (admin-role key required) → create; GET → list; DELETE `/api/v1/keys/{key_id}` → revoke. CLI bootstrap: `keys-create` command in `cli.py` (first key made on-box).
- Root `/` banner: replace static app.html with JSON `{engine:"lore", docs:"/docs", api:"/api/v1/health"}`.
Tests: key-authed /ask 200 with zero tenant/scope params in service mode; bad/revoked key 401; POST /keys member-role 403 / admin 200; JWT path untouched (existing test_multitenant_acl stays green); / returns JSON.

### Task 3: zero-param ingest (personal mode)
Files: Modify `core/lore/api.py` (IngestReq: scope/owner/tenant → Optional; ingest + capture resolve via `_authorize_write`); Test `core/tests/test_api_personal_mode.py`.
Tests: key-authed POST /api/v1/ingest {source_id,title,text} only → note lands tenant=key tenant, scope=private:{user}, owner=user; unauthed in service mode → 401; local mode (no service) with explicit fields → unchanged legacy behavior (422 if fields missing stays for local callers? NO — local mode keeps required-field semantics via validation in handler, asserted).

### Task 4: scopes + grants engine (`scopes.py` + authorize union)
Files: Create `core/lore/scopes.py`, `core/tests/test_scopes.py`; Modify `core/lore/tenancy.py` (`authorize_scopes` unions granted scope_ids; `granted_scope_ids(conn, user_id)` helper).
Produces: `create_scope(conn, tenant, owner_user, name) -> {scope_id:"s:<slug>-<6hex>", name}`; `list_scopes(conn, tenant, user_id)` (owned + granted + team); `grant(conn, tenant, scope_id, user_id, role, granted_by)` (owner/write-granter only → PermissionError); `revoke_grant`.
Tests: created scope readable/writable by owner via authorize_scopes; grant read → appears in target's authorize_scopes, write ops still denied; non-owner grant attempt → PermissionError; no-widening (requesting a foreign ungranted scope yields ∅).

### Task 5: scopes/teams HTTP surface
Files: Modify `core/lore/api.py`; Test `core/tests/test_api_scopes_teams.py`.
Endpoints (all `/api/v1/*`, key/JWT authed): POST+GET `/scopes`; POST `/scopes/{scope_id}/grants` {user_id, role}; DELETE grant; POST `/teams` {name}; POST `/teams/{team_id}/invites` {email}; GET `/invites` (pending for caller email — key principal has no email → invite lookup by user (skip; team invites remain JWT/desktop flow — EXPOSE create+invite only, accept stays existing /teams route)); ingest/query accept optional `scope` (named or id) → resolved + access-checked.
Tests: create scope via API → ingest into it with write access → second key granted read sees it in /search results, outsider key does not; member-role key cannot grant on foreign scope (403).

### Task 6: bind guard + three-personas acceptance
Files: Modify `core/run_server.py` (`LORE_BIND` env, default 127.0.0.1; non-localhost bind without LORE_API_KEYS=1 → refuse to start); Test `core/tests/test_api_service_e2e.py` (TestClient, LORE_API_KEYS=1): personas alice(admin)/bob(member)/mallory — full flow: keys created, alice zero-param ingest+ask; alice creates scope "case-files", ingests into it, grants bob read; bob sees case-files hits, mallory 401/sees nothing; alice revokes bob → bob loses it.

### Task 7: README + docs + push
Files: Rewrite `README.md` (API-service identity: what it is, 60-second quickstart [run server, create key, curl ingest/ask], surface table, scopes/teams examples, personal-mode note, architecture links, test badge); update `docs/API_V1.md` (new endpoints + auth section); final commit + push.

Self-review: covered spec items B1-B5, C1-C4; types consistent (verify_key dict keys used by require_user; scope_id format opaque string); no placeholders — exact behaviors + test names above; remaining detail lives in TDD execution.
