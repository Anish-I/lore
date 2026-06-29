# Lore Multi-Tenant Spike (Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove — leak-proof — that team-scoped notes can be indexed server-side and recalled across team members, while a non-member cannot retrieve, count, or rerank them even by forging the request, and `private` notes can never sync.

**Architecture:** Reuse the existing recall spine (`index_document` → Qdrant `scope_ids`/`tenant_id` filter → `retrieve` hybrid+rerank). Add a new `tenancy` module that derives a caller's authorized scope IDs **from membership tables on the server** and intersects them with whatever the client requested, so client-supplied scopes can never escalate access. This is the gate before any auth/sync/client work in later phases.

**Tech Stack:** Python 3.11, Postgres (psycopg), Qdrant, pytest. Tests run with `VAULT_FAKE=1` (FakeEmbedder/FakeReranker, isolated `vault_test` collection — already wired in `core/tests/conftest.py`).

## Global Constraints

- `private` scope is **zero-knowledge to the server**: never synced, embedded server-side, or logged. (Spec §8)
- ACL filter is applied **inside candidate generation** for every lane (dense, sparse, exact) — never retrieve-globally-then-filter. (Spec §6, already true in `qdrant_store`.)
- A caller's authorized scopes are derived **server-side from membership**, never trusted from client claims or JWT. (Spec §3, §5.1)
- Tenancy schema is bootstrapped idempotently, mirroring `db.bootstrap_schema` style (try/except guarded `CREATE ... IF NOT EXISTS`). (Pattern: `core/lore/db.py`)
- Team scope IDs use the exact form `team:{team_id}`; the integer/string `team_id` comes from the `teams` table. (Spec §6)
- Reuse `core/lore/recall.retrieve(query, embedder, reranker, allowed_scope_ids, tenant_id, limit=8, sparse_embedder=None)` and `core/lore/index.index_document(...)` verbatim — do not fork the recall pipeline.

---

## File Structure

- **Create `core/lore/tenancy.py`** — the only new production module. Responsibilities: bootstrap tenancy tables; map membership → authorized team scope IDs; intersect requested vs authorized scopes (anti-escalation); scope-id formatting; the `syncable_scope` invariant. One focused file.
- **Create `core/tests/test_tenancy.py`** — unit tests for the tenancy helpers (schema, membership derivation, intersection, invariant).
- **Create `core/tests/test_multitenant_acl.py`** — the integration **gate**: index team notes, prove cross-member recall works and cross-team access is impossible (including a forged-scope escalation attempt) and private never appears.

No existing files are modified in Phase 0 — the spike is additive and proves the architecture before it touches `api.py`/`db.py`.

---

### Task 1: Tenancy schema + scope helpers

**Files:**
- Create: `core/lore/tenancy.py`
- Test: `core/tests/test_tenancy.py`

**Interfaces:**
- Consumes: `lore.db.connect()` (psycopg autocommit connection).
- Produces:
  - `bootstrap_tenancy(conn) -> None` — idempotent; creates `orgs, teams, memberships, audit_log`.
  - `team_scope_id(team_id) -> str` — returns `f"team:{team_id}"`.
  - `syncable_scope(scope_type: str) -> bool` — `True` for `team`/`enterprise`, `False` for `private` (and anything else).

- [ ] **Step 1: Write the failing test**

```python
# core/tests/test_tenancy.py
from lore import db
from lore.tenancy import bootstrap_tenancy, team_scope_id, syncable_scope


def test_scope_helpers():
    assert team_scope_id(7) == "team:7"
    assert syncable_scope("team") is True
    assert syncable_scope("enterprise") is True
    # private must never be syncable — the zero-knowledge invariant
    assert syncable_scope("private") is False
    assert syncable_scope("anything-else") is False


def test_bootstrap_tenancy_is_idempotent():
    conn = db.connect()
    bootstrap_tenancy(conn)
    bootstrap_tenancy(conn)  # second call must not raise
    # tables exist and are queryable
    conn.execute("select count(*) from orgs")
    conn.execute("select count(*) from teams")
    conn.execute("select count(*) from memberships")
    conn.execute("select count(*) from audit_log")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && python -m pytest tests/test_tenancy.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'lore.tenancy'`

- [ ] **Step 3: Write minimal implementation**

```python
# core/lore/tenancy.py
"""Server-side multi-tenant authorization for Lore.

Derives a caller's authorized team scope IDs from MEMBERSHIP tables (never from
client claims), so cross-team recall is leak-proof at the candidate-generation
stage.  `private` scope is structurally non-syncable: the zero-knowledge invariant.
"""

_SYNCABLE_SCOPE_TYPES = frozenset(("team", "enterprise"))

_SCHEMA = [
    "create table if not exists orgs (id text primary key, name text)",
    "create table if not exists teams (id text primary key, org_id text, name text)",
    """create table if not exists memberships (
         user_id text, org_id text, team_id text, role text,
         status text default 'active',
         primary key (user_id, team_id))""",
    """create table if not exists audit_log (
         id bigserial primary key, ts timestamptz default now(),
         actor_user_id text, action text, scope_ids text, detail text)""",
]


def bootstrap_tenancy(conn) -> None:
    """Create the tenancy tables. Idempotent — safe on every server start."""
    for stmt in _SCHEMA:
        conn.execute(stmt)


def team_scope_id(team_id) -> str:
    """Canonical scope id for a team. Used as the Qdrant `scope_ids` payload value."""
    return f"team:{team_id}"


def syncable_scope(scope_type: str) -> bool:
    """True if a scope's notes may leave the device for the shared server.
    `private` is never syncable — enforced here and asserted by tests."""
    return scope_type in _SYNCABLE_SCOPE_TYPES
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && python -m pytest tests/test_tenancy.py -v`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add core/lore/tenancy.py core/tests/test_tenancy.py
git commit -m "feat(tenancy): schema bootstrap + scope helpers (private never syncable)"
```

---

### Task 2: Authorized scope derivation from membership

**Files:**
- Modify: `core/lore/tenancy.py`
- Test: `core/tests/test_tenancy.py`

**Interfaces:**
- Consumes: `bootstrap_tenancy`, `team_scope_id` (Task 1); a psycopg connection.
- Produces:
  - `authorized_team_scope_ids(conn, user_id: str) -> list[str]` — the `team:{id}` scopes a user may
    read, derived from `memberships` where `status='active'`. Returns `[]` for unknown/no-membership/
    revoked users. Order is deterministic (sorted).

- [ ] **Step 1: Write the failing test**

```python
# add to core/tests/test_tenancy.py
from lore.tenancy import authorized_team_scope_ids


def _seed(conn):
    bootstrap_tenancy(conn)
    conn.execute("insert into orgs(id,name) values('o1','Org1') on conflict do nothing")
    conn.execute("insert into teams(id,org_id,name) values('t1','o1','Team1') on conflict do nothing")
    conn.execute("insert into teams(id,org_id,name) values('t2','o1','Team2') on conflict do nothing")
    # alice in t1 (active), bob in t2 (active), carol in t1 but REVOKED
    conn.execute("insert into memberships(user_id,org_id,team_id,role,status) "
                 "values('alice','o1','t1','member','active') on conflict (user_id,team_id) do update set status='active'")
    conn.execute("insert into memberships(user_id,org_id,team_id,role,status) "
                 "values('bob','o1','t2','member','active') on conflict (user_id,team_id) do update set status='active'")
    conn.execute("insert into memberships(user_id,org_id,team_id,role,status) "
                 "values('carol','o1','t1','member','revoked') on conflict (user_id,team_id) do update set status='revoked'")


def test_authorized_scopes_from_membership():
    conn = db.connect()
    _seed(conn)
    assert authorized_team_scope_ids(conn, "alice") == ["team:t1"]
    assert authorized_team_scope_ids(conn, "bob") == ["team:t2"]
    # revoked membership grants nothing
    assert authorized_team_scope_ids(conn, "carol") == []
    # unknown user grants nothing
    assert authorized_team_scope_ids(conn, "nobody") == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && python -m pytest tests/test_tenancy.py::test_authorized_scopes_from_membership -v`
Expected: FAIL with `ImportError: cannot import name 'authorized_team_scope_ids'`

- [ ] **Step 3: Write minimal implementation**

```python
# add to core/lore/tenancy.py
def authorized_team_scope_ids(conn, user_id: str) -> list:
    """The team scope ids a user may READ, derived from active memberships.
    SERVER-SIDE source of truth — never trust scopes supplied by the client."""
    rows = conn.execute(
        "select team_id from memberships where user_id=%s and status='active' order by team_id",
        (user_id,),
    ).fetchall()
    return [team_scope_id(r[0]) for r in rows]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && python -m pytest tests/test_tenancy.py::test_authorized_scopes_from_membership -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add core/lore/tenancy.py core/tests/test_tenancy.py
git commit -m "feat(tenancy): derive authorized team scopes from active membership"
```

---

### Task 3: Anti-escalation scope intersection

**Files:**
- Modify: `core/lore/tenancy.py`
- Test: `core/tests/test_tenancy.py`

**Interfaces:**
- Consumes: `authorized_team_scope_ids` (Task 2).
- Produces:
  - `authorize_scopes(conn, user_id: str, requested: list[str] | None) -> list[str]` — the scopes the
    server will actually query with. When `requested` is falsy, returns all the user's authorized
    scopes. Otherwise returns `requested ∩ authorized` (sorted). A client can therefore never widen
    access by asking for a scope it isn't a member of.

- [ ] **Step 1: Write the failing test**

```python
# add to core/tests/test_tenancy.py
from lore.tenancy import authorize_scopes


def test_authorize_scopes_cannot_escalate():
    conn = db.connect()
    _seed(conn)
    # default (no request) → all of the user's scopes
    assert authorize_scopes(conn, "alice", None) == ["team:t1"]
    # asking only for what you have → granted
    assert authorize_scopes(conn, "alice", ["team:t1"]) == ["team:t1"]
    # bob (member of t2) forging a request for t1 → intersection is empty
    assert authorize_scopes(conn, "bob", ["team:t1"]) == []
    # bob asking for t1 AND t2 → only t2 survives
    assert authorize_scopes(conn, "bob", ["team:t1", "team:t2"]) == ["team:t2"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && python -m pytest tests/test_tenancy.py::test_authorize_scopes_cannot_escalate -v`
Expected: FAIL with `ImportError: cannot import name 'authorize_scopes'`

- [ ] **Step 3: Write minimal implementation**

```python
# add to core/lore/tenancy.py
def authorize_scopes(conn, user_id: str, requested) -> list:
    """Scopes the server will query with. Without a request → all authorized scopes.
    With a request → requested ∩ authorized, so a client can never widen its access."""
    authorized = set(authorized_team_scope_ids(conn, user_id))
    if not requested:
        return sorted(authorized)
    return sorted(authorized.intersection(requested))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && python -m pytest tests/test_tenancy.py::test_authorize_scopes_cannot_escalate -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add core/lore/tenancy.py core/tests/test_tenancy.py
git commit -m "feat(tenancy): intersect requested vs authorized scopes (anti-escalation)"
```

---

### Task 4: The leak-proof recall gate (integration)

**Files:**
- Test: `core/tests/test_multitenant_acl.py`

**Interfaces:**
- Consumes: `index_document` (`core/lore/index.py`), `retrieve` (`core/lore/recall.py`),
  `FakeEmbedder`/`FakeReranker`, and `authorize_scopes`/`team_scope_id`/`bootstrap_tenancy` (Tasks 1-3).
- Produces: the gating test proving cross-member recall works and cross-team/forged access yields
  **zero** candidates across the whole pipeline.

- [ ] **Step 1: Write the failing test**

```python
# core/tests/test_multitenant_acl.py
"""The Phase-0 GATE: team-scoped recall is leak-proof across members.
If this cannot pass without weakening the ACL, the architecture is wrong (spec §10)."""
from lore import db
from lore.embed import FakeEmbedder
from lore.rerank import FakeReranker
from lore.index import index_document
from lore.recall import retrieve
from lore.tenancy import bootstrap_tenancy, team_scope_id, authorize_scopes

_TENANT = "mt-acl-tenant"


def _seed_membership(conn):
    bootstrap_tenancy(conn)
    conn.execute("insert into orgs(id,name) values('o1','Org1') on conflict do nothing")
    for t in ("t1", "t2"):
        conn.execute("insert into teams(id,org_id,name) values(%s,'o1',%s) on conflict do nothing", (t, t))
    conn.execute("insert into memberships(user_id,org_id,team_id,role,status) "
                 "values('alice','o1','t1','member','active') on conflict (user_id,team_id) do update set status='active'")
    conn.execute("insert into memberships(user_id,org_id,team_id,role,status) "
                 "values('bob','o1','t2','member','active') on conflict (user_id,team_id) do update set status='active'")


def test_cross_member_recall_is_leakproof():
    conn = db.connect()
    db.bootstrap_schema(conn)
    _seed_membership(conn)
    emb, rr = FakeEmbedder(), FakeReranker()

    # Alice indexes a TEAM note (server-side) under team t1.
    index_document(
        source_id="mt-note-falcon", title="Project Falcon",
        text="# Project Falcon\n\nThe Falcon launch checklist and rollout plan.\n",
        scope_id=team_scope_id("t1"), owner_id="alice", tenant_id=_TENANT,
        embedder=emb, conn=conn, source_type="note",
    )

    # Bob indexes his own team note under t2 (so t2 is non-empty too).
    index_document(
        source_id="mt-note-otter", title="Project Otter",
        text="# Project Otter\n\nOtter migration notes.\n",
        scope_id=team_scope_id("t2"), owner_id="bob", tenant_id=_TENANT,
        embedder=emb, conn=conn, source_type="note",
    )

    # Alice (member of t1) recalls Falcon — authorized scopes derived server-side.
    alice_scopes = authorize_scopes(conn, "alice", None)
    hits = retrieve("falcon launch checklist", emb, rr, alice_scopes, _TENANT, limit=8)
    assert any("falcon" in (h.get("text", "").lower()) for h in hits), "Alice must see her team's note"

    # Bob (member of t2 only) CANNOT retrieve Falcon, even forging a request for t1.
    bob_forged = authorize_scopes(conn, "bob", ["team:t1"])
    assert bob_forged == [], "Forged scope must not be authorized"
    bob_hits = retrieve("falcon launch checklist", emb, rr, bob_forged or ["team:__none__"], _TENANT, limit=8)
    assert bob_hits == [] or all("falcon" not in (h.get("text", "").lower()) for h in bob_hits), \
        "Bob must not retrieve, count, or rerank another team's chunk"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && python -m pytest tests/test_multitenant_acl.py -v`
Expected: FAIL (initially `mt-note-falcon` won't exist / scopes empty) — confirm it fails for a
*real* reason (assertion), not an import error. If it errors on import, fix the import before proceeding.

- [ ] **Step 3: Make it pass**

No production change should be required — Tasks 1-3 supply `authorize_scopes`, and `index_document` +
`retrieve` already enforce `scope_ids ∈ allowed` in-query. If the test fails, the failure IS the
finding: inspect whether `retrieve` leaked a cross-team chunk. Only then change code. Re-run until green.

Run: `cd core && python -m pytest tests/test_multitenant_acl.py -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add core/tests/test_multitenant_acl.py
git commit -m "test(acl): leak-proof cross-member recall gate (Phase 0)"
```

---

### Task 5: Private-never-leaves invariant (integration)

**Files:**
- Test: `core/tests/test_multitenant_acl.py`

**Interfaces:**
- Consumes: `syncable_scope` (Task 1), `index_document`, `retrieve`, `authorize_scopes`.
- Produces: a test proving (a) `private` is structurally non-syncable, and (b) a private note indexed
  in the same tenant never surfaces in a team-scope query.

- [ ] **Step 1: Write the failing test**

```python
# add to core/tests/test_multitenant_acl.py
from lore.tenancy import syncable_scope


def test_private_never_appears_in_team_recall():
    conn = db.connect()
    db.bootstrap_schema(conn)
    _seed_membership(conn)
    emb, rr = FakeEmbedder(), FakeReranker()

    # Invariant: private is never eligible to sync to the server at all.
    assert syncable_scope("private") is False

    # A private note in the same tenant (as if it had leaked into the store) ...
    index_document(
        source_id="mt-note-private", title="Alice Private",
        text="# Private\n\nAlice's confidential salary numbers — falcon.\n",
        scope_id="private", owner_id="alice", tenant_id=_TENANT,
        embedder=emb, conn=conn, source_type="note",
    )

    # ... must NOT appear when Alice queries her TEAM scope (private != team:t1).
    alice_scopes = authorize_scopes(conn, "alice", None)
    hits = retrieve("falcon confidential salary", emb, rr, alice_scopes, _TENANT, limit=8)
    assert all(h.get("scope_ids") != ["private"] for h in hits), "Private note leaked into team recall"
    assert all("salary" not in (h.get("text", "").lower()) for h in hits), "Private content leaked"
```

- [ ] **Step 2: Run test to verify it fails or passes for the right reason**

Run: `cd core && python -m pytest tests/test_multitenant_acl.py::test_private_never_appears_in_team_recall -v`
Expected: PASS if the ACL holds (private scope id is outside the authorized team scopes). If it FAILS,
that is a real leak — investigate `retrieve`/`qdrant_store` filtering before changing the test.

- [ ] **Step 3: Commit**

```bash
git add core/tests/test_multitenant_acl.py
git commit -m "test(acl): private notes never surface in team recall (Phase 0 invariant)"
```

---

### Task 6: Phase-0 gate summary + green suite

**Files:**
- Test: run the whole suite.

- [ ] **Step 1: Run the full test suite**

Run: `cd core && VAULT_FAKE=1 python -m pytest -q`
Expected: PASS — all prior tests plus `test_tenancy.py` and `test_multitenant_acl.py`.

- [ ] **Step 2: Record the gate outcome**

If green: the architecture is validated — proceed to Phase 1 (auth) in a follow-up plan.
If any ACL/private test is red and cannot go green without widening `allowed_scope_ids`: **STOP** — the
server-readable cross-vault design needs rethinking before further build (spec §10).

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "chore(acl): Phase-0 multi-tenant gate green"
```

---

## Follow-up plans (NOT in this plan)

Phase 0 deliberately stops at the leak-proof gate. Each later spec-phase (§11) gets its own plan once
the gate is green:
1. **Auth** — OTP → JWT + refresh, membership-backed authorization middleware, wire `authorize_scopes`
   into a new server `/ask` + `/sync` path.
2. **Sync** — desktop outbox + `PUT/DELETE /sync/notes` + tombstones + idempotency + reconciler.
3. **Recall service** — expose member-spanning ACL recall over HTTP with audit logging.
4. **Client** — login UI, keychain token storage, scope-aware Ask routing, server-URL config.
5. **Pilot hardening** — audit log surfacing, conflict UX, one-command self-host server packaging.

## Self-Review

- **Spec coverage:** Phase 0 covers spec §10 (de-risking spike) end-to-end and the §3/§6/§8 ACL +
  privacy invariants. Auth (§5.1), sync (§7), client (§5.2), and the HTTP recall service (§5.1) are
  explicitly deferred to follow-up plans above — matching spec §11 phasing.
- **Placeholder scan:** no TBD/TODO; every code step shows complete code; commands have expected output.
- **Type consistency:** `team_scope_id` returns `team:{id}`; `authorized_team_scope_ids`/`authorize_scopes`
  return `list[str]` of those ids; `retrieve(...)` and `index_document(...)` use their real signatures
  from `core/lore/recall.py` and `core/lore/index.py`; `syncable_scope` is `bool`. Consistent across tasks.
