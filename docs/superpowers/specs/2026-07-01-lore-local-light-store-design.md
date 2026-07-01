# Lore Local Light Store — Design Spec

**Date:** 2026-07-01
**Status:** Approved design (pre-implementation)
**Slice:** #1 of the multi-tenant vision — the serverless, Obsidian-light local store
**Branch:** `feat/google-oauth`

## 1. Context

Lore is a local-first knowledge OS (Electron desktop + Python FastAPI `:8099` + Qdrant + Postgres,
hybrid dense(BGE)+BM25+rerank recall). The product vision is scope-based knowledge sharing: `private`
stays 100% on the user's device; `team`/`enterprise` notes sync to a shared server so members can query
each other's notes in real time.

The user end must be **Obsidian-light: no server process**. Today `db.py` is Postgres-only (`psycopg`),
and the `feat/google-oauth` branch even bundles *embedded Postgres* — which still spawns a real PG server
process, so it is not Obsidian-light. This slice re-platforms the **local** store to be serverless while
preserving Postgres for the **deployed team server** (slice #2, the sync spine).

**This slice is a prerequisite for the sync spine:** local must be a light store before we can push team
notes up from it.

## 2. Goal

Run Lore's existing index/recall spine on a zero-external-server local store — **SQLite** (truth) +
**embedded Qdrant** (vectors) — with the *same code* selecting Postgres + Qdrant-server when run as the
shared server. No Docker, no Postgres, no Qdrant server on the user end.

## 3. Locked decisions

| Decision | Choice |
|---|---|
| Local truth store | **SQLite** (single file, stdlib `sqlite3`, no server) |
| Local vectors | **Qdrant embedded** (`QDRANT_PATH`, in-process — already supported by `qdrant_store.py`) |
| Store abstraction | **Approach A** — one dialect-adaptive `db` module, backend chosen by config |
| Server store | **Postgres + Qdrant server** unchanged (used only by the deployed team server) |
| Data migration | Deferred (start fresh locally) — YAGNI now |

`ruvector.db` / `agentdb.rvf` in the tree are stray artifacts — nothing in source reads them; ignore/gitignore.

## 4. Architecture

```
┌──────────────── User end (Obsidian-light, NO external servers) ───────────────┐
│ Lore Desktop (Electron)                                                       │
│   • app-spawned local backend (:8099, dies with the app)                      │
│   • Truth:   SQLite file   <userData>/lore.db                                  │
│   • Vectors: embedded Qdrant  <userData>/lore-qdrant                           │
│   • scope = private · tenant = per-library                                     │
└───────────────────────────────────────────────────────────────────────────────┘

┌──────────────── Shared team server (slice #2, deployed) ──────────────────────┐
│ Same core/ code, DATABASE_URL=postgresql://… + QDRANT_URL=http://…:6333       │
└───────────────────────────────────────────────────────────────────────────────┘
```

"No server on the user end" means **no database servers** (no Docker Postgres, no embedded-Postgres
process, no Qdrant `:6333`). The app's own `:8099` backend is auto-spawned by Electron and dies with it
— app-internal, like Obsidian's own services — and is acceptable.

## 5. Components & interfaces

### 5.1 Dialect-adaptive `core/lore/db.py`
- `connect()` selects backend from config: a `sqlite:///<path>` URL → SQLite; a `postgresql://…` URL →
  Postgres (unchanged psycopg path). Selection via the existing `DATABASE_URL`/settings, scheme-detected.
- **`_SqliteConn` wrapper** around `sqlite3.connect(path, isolation_level=None)` (autocommit) that exposes
  the same surface the call sites already use: `.execute(sql, params=()) -> cursor` with
  `.fetchone()/.fetchall()`. On open: `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`.
- **Placeholder translation** `%s` → `?` inside the wrapper's `execute` (the codebase uses only `%s`
  positional params; literal `%` is not used in SQL strings — verified at implementation time).
- **`bootstrap_schema()`** branches DDL by dialect: `bigserial`→`INTEGER PRIMARY KEY AUTOINCREMENT`,
  `timestamptz`→ISO-8601 `TEXT`, `now()`→`CURRENT_TIMESTAMP`, keep `ON CONFLICT(cols) DO UPDATE`
  (SQLite ≥3.24 supports it; bundled Python sqlite3 is well past that).
- `core/lore/tenancy.py::bootstrap_tenancy()` gets the same dialect-branched DDL.

### 5.2 Vectors — embedded Qdrant
- Local mode sets `QDRANT_PATH=<userData>/lore-qdrant`; `qdrant_store.py` already routes `QDRANT_PATH` →
  embedded persistent client (no server). Server mode keeps `QDRANT_URL`. No code change beyond ensuring
  the env is set before first client use.

### 5.3 App wiring — `desktop/main.js`
- Local defaults: set `DATABASE_URL=sqlite:///<userData>/lore.db` and `QDRANT_PATH=<userData>/lore-qdrant`
  in the backend spawn env.
- **Remove the embedded-Postgres path for local** (the `app.isPackaged || cfg.embeddedPg` block that loads
  `lib/embedded-postgres.js`). Embedded-PG stays available only behind an explicit server-mode flag; the
  default desktop path never starts it.
- Still auto-spawn the `:8099` backend (unchanged) — app-internal.

### 5.4 Data model — unchanged
Notes / chunks / edges + tenancy tables identical; only the DDL becomes dialect-portable. Local `scope`
stays `private`; `tenant` is per-library (`lib-<slug>-<suffix>`).

## 6. Error handling
- SQLite `database is locked` → WAL mode + a short bounded retry in the wrapper (a couple of retries with
  small backoff); never spin forever.
- No third-party SQLite extensions required (pure stdlib `sqlite3`).
- Schema bootstrap failure at startup is fatal (fail-closed) with a clear message; a corrupt local store
  should not silently degrade recall.

## 7. Testing
- **Backend-parametrized `conftest.py`:** default lane = **SQLite** (fast, no Postgres); keep an opt-in
  Postgres lane for server parity. Reuse `VAULT_FAKE` FakeEmbedder/FakeReranker.
- **`core/tests/test_db_sqlite.py`** (new): schema bootstrap idempotency; note upsert; chunk insert; edge
  extraction (link/folder/tag); `%s`→`?` translation correctness; WAL/foreign-keys pragmas applied.
- **Port the ACL gate onto SQLite:** run `test_tenancy.py` + `test_multitenant_acl.py` against SQLite so
  the leak-proof invariants hold on the local store too.
- **Recall-parity smoke:** index a few notes locally, assert `/search` and `/graph` return the expected
  nodes/hits — proving SQLite + embedded-Qdrant matches the Postgres path.
- Full suite green with `VAULT_FAKE=1` and the SQLite backend by default.

## 8. Out of scope (later slices)
Sync spine (`/sync/notes`, outbox, server-authoritative team recall — slice #2); team/enterprise deployed
server; auth *enforcement* on data endpoints; agent-driven re-scoping (personal→team/wizard); wizard
real-time refresh; Postgres→SQLite data migration tooling.

## 9. Verification
- Desktop app launches with **no Docker and no Postgres/Qdrant server running**; `curl -s :8099/presets`
  returns JSON; `<userData>/lore.db` and `<userData>/lore-qdrant/` are created.
- A capture/ingest adds a node: `/capture/status?session_id=…` → `exists:true, chunks>0`; `GET /graph`
  node count increments; `/search` retrieves it.
- `cd core && VAULT_FAKE=1 python -m pytest -q` green on the SQLite backend, including the ported ACL tests.

## 10. Critical files
- **Modify:** `core/lore/db.py` (dialect layer), `core/lore/tenancy.py` (dialect DDL),
  `core/lore/config.py` (backend selection), `desktop/main.js` (local env + drop embedded-PG default),
  `core/tests/conftest.py` (backend parametrization).
- **Add:** `core/tests/test_db_sqlite.py`.
- **Reference (unchanged):** `core/lore/qdrant_store.py` (embedded mode already present),
  `core/lore/{index.py,recall.py,api.py}` (call sites should need no change if the wrapper matches psycopg).
