# Lore Local Light Store — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Lore's local/user end run with zero external database servers — SQLite (truth) + embedded Qdrant (vectors) — while the same code still runs Postgres + Qdrant-server when deployed as a shared team server.

**Architecture:** One dialect-adaptive `core/lore/db.py`. `connect()` returns either a psycopg connection (Postgres) or a thin `_SqliteConn` wrapper that exposes the same `.execute(sql, params).fetchone()/.fetchall()` surface, translating `%s`→`?`, running the schema via `executescript`, and returning timezone-aware datetimes for timestamp columns. Backend chosen by the `DATABASE_URL` scheme. Vectors already support a serverless embedded mode via `QDRANT_PATH` in `core/lore/qdrant_store.py` (no code change — Codex-confirmed hybrid dense+sparse `query_points` works embedded).

**Tech Stack:** Python 3.11, stdlib `sqlite3`, psycopg (server only), Qdrant (embedded local / server), pytest. Tests run with `VAULT_FAKE=1` (FakeEmbedder/FakeReranker).

## Global Constraints

- **No external DB server on the user end.** Local mode uses stdlib `sqlite3` + embedded Qdrant only. No Docker, no Postgres, no Qdrant `:6333`.
- **Same code both modes.** Do NOT fork the recall/index pipeline. The only backend split lives inside `db.py` (connection + schema) and a portable `IN` helper. Postgres behavior must be unchanged.
- **Backend selected by `DATABASE_URL` scheme:** `sqlite:///<abs-path>` → SQLite; `postgresql://…` → Postgres (current default in `config.py`).
- **SQLite pragmas:** every SQLite connection sets `journal_mode=WAL` and `foreign_keys=ON`, opens with `check_same_thread=False`, and serializes writes through a process-wide lock (the FastAPI app shares one connection across a threadpool).
- **SQLite schema is written in FINAL shape** (all migrated columns + the full edges-kind list) — the Postgres ALTER/`DO $$` migration sequence is NOT translated; it is skipped on SQLite.
- `ruvector.db` / `agentdb.rvf` are stray artifacts (nothing reads them) — add to `.gitignore`, do not wire in.

---

### Task 1: Backend-selecting `connect()` + `_SqliteConn` wrapper

**Files:**
- Modify: `core/lore/db.py:87-89` (`connect()`)
- Modify: `core/lore/db.py:1` (imports)
- Test: `core/tests/test_db_sqlite.py` (create)

**Interfaces:**
- Consumes: `settings.database_url` (`core/lore/config.py`).
- Produces:
  - `is_sqlite(url: str) -> bool`
  - `connect()` → a connection object supporting `.execute(sql, params=()) -> cursor` (cursor has `.fetchone()/.fetchall()`), `.executescript(sql) -> None`, `.close()`. For Postgres this is the psycopg connection; for SQLite it is `_SqliteConn`.
  - `_SqliteConn` (wrapper): `.execute`, `.executescript`, `.close`, and passthrough `.cursor()`.

- [ ] **Step 1: Write the failing test**

```python
# core/tests/test_db_sqlite.py
import datetime
from lore import db


def test_sqlite_connect_execute_and_placeholder_translation(tmp_path):
    url = f"sqlite:///{tmp_path/'lore.db'}"
    assert db.is_sqlite(url) is True
    conn = db._connect_url(url)  # test seam: connect to an explicit url
    # multi-statement DDL must go through executescript
    conn.executescript(
        "create table t(id text primary key, n int);"
        "create index t_n on t(n);"
    )
    # %s placeholders (psycopg style) must be accepted and translated to ?
    conn.execute("insert into t(id, n) values (%s, %s)", ("a", 1))
    row = conn.execute("select n from t where id = %s", ("a",)).fetchone()
    assert row[0] == 1
    conn.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && python -m pytest tests/test_db_sqlite.py::test_sqlite_connect_execute_and_placeholder_translation -v`
Expected: FAIL with `AttributeError: module 'lore.db' has no attribute 'is_sqlite'`

- [ ] **Step 3: Write minimal implementation**

Replace `import psycopg` at `core/lore/db.py:1` and the `connect()` function at `:87-89`:

```python
# core/lore/db.py  (top of file)
import re
import sqlite3
import threading
import datetime
from .config import settings

try:
    import psycopg  # server-only; absent is fine on a pure-local install
except Exception:  # pragma: no cover
    psycopg = None

# One process-wide write lock: the FastAPI app shares a single connection across
# a threadpool, and SQLite allows only one writer at a time.
_SQLITE_WRITE_LOCK = threading.Lock()
_PLACEHOLDER = re.compile(r"%s")


def is_sqlite(url: str) -> bool:
    return url.startswith("sqlite:")


def _sqlite_path(url: str) -> str:
    # sqlite:///abs/path  or  sqlite://relative -> strip the scheme
    return url[len("sqlite://"):] if url.startswith("sqlite://") else url


class _SqliteCursor:
    """Wraps a sqlite3 cursor so callers get psycopg-like fetchone/fetchall."""
    def __init__(self, cur):
        self._cur = cur

    def fetchone(self):
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()

    def __iter__(self):
        return iter(self._cur)


class _SqliteConn:
    """psycopg-compatible-enough wrapper over stdlib sqlite3.

    - autocommit (isolation_level=None)
    - %s -> ? placeholder translation
    - WAL + foreign_keys pragmas
    - serialized writes via a process-wide lock
    """
    def __init__(self, path: str):
        self._db = sqlite3.connect(
            path, check_same_thread=False, isolation_level=None,
            detect_types=sqlite3.PARSE_DECLTYPES | sqlite3.PARSE_COLNAMES,
        )
        self._db.execute("pragma journal_mode=WAL")
        self._db.execute("pragma foreign_keys=ON")
        self._db.execute("pragma busy_timeout=5000")

    def execute(self, sql, params=()):
        sql = _PLACEHOLDER.sub("?", sql)
        with _SQLITE_WRITE_LOCK:
            cur = self._db.execute(sql, tuple(params))
        return _SqliteCursor(cur)

    def executescript(self, sql):
        with _SQLITE_WRITE_LOCK:
            self._db.executescript(sql)

    def cursor(self):
        return self._db.cursor()

    def close(self):
        try:
            self._db.close()
        except Exception:
            pass


def _connect_url(url: str):
    if is_sqlite(url):
        return _SqliteConn(_sqlite_path(url))
    return psycopg.connect(url, autocommit=True)


def connect():
    return _connect_url(settings.database_url)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && python -m pytest tests/test_db_sqlite.py::test_sqlite_connect_execute_and_placeholder_translation -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add core/lore/db.py core/tests/test_db_sqlite.py
git commit -m "feat(db): sqlite connection wrapper + backend selection by DATABASE_URL scheme"
```

---

### Task 2: Dialect-branched schema (SQLite final-shape DDL)

**Files:**
- Modify: `core/lore/db.py` (`bootstrap_schema`, add `SCHEMA_SQLITE`)
- Test: `core/tests/test_db_sqlite.py`

**Interfaces:**
- Consumes: `connect()` / `_SqliteConn.executescript` (Task 1).
- Produces: `bootstrap_schema(conn)` that, on SQLite, creates `notes`, `chunks`, `edges` in their **final** shape (all M1/M2/M7 columns; edges-kind CHECK includes the reasoned-graph kinds) and is idempotent; on Postgres, runs the existing migration+SCHEMA path unchanged.

- [ ] **Step 1: Write the failing test**

```python
# add to core/tests/test_db_sqlite.py
from lore import db


def test_bootstrap_schema_sqlite_final_shape(tmp_path):
    url = f"sqlite:///{tmp_path/'lore.db'}"
    conn = db._connect_url(url)
    db.bootstrap_schema(conn)
    db.bootstrap_schema(conn)  # idempotent: second call must not raise

    cols = {r[1] for r in conn.execute("pragma table_info(notes)").fetchall()}
    assert {"id", "tenant_id", "scope_id", "source_type",
            "body", "content_hash", "importance"} <= cols

    ecols = {r[1] for r in conn.execute("pragma table_info(edges)").fetchall()}
    assert {"origin", "weight", "evidence", "updated_at"} <= ecols

    # reasoned-graph kind must be accepted (base SCHEMA's check would reject it)
    conn.execute("insert into notes(id, tenant_id, scope_id) values (%s,%s,%s)",
                 ("n1", "t", "private"))
    conn.execute("insert into notes(id, tenant_id, scope_id) values (%s,%s,%s)",
                 ("n2", "t", "private"))
    conn.execute(
        "insert into edges(tenant_id, src_note_id, dst_note_id, kind) "
        "values (%s,%s,%s,%s)", ("t", "n1", "n2", "supersedes"))
    n = conn.execute("select count(*) from edges where kind=%s",
                     ("supersedes",)).fetchone()[0]
    assert n == 1
    conn.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && python -m pytest tests/test_db_sqlite.py::test_bootstrap_schema_sqlite_final_shape -v`
Expected: FAIL (`sqlite3.OperationalError: near "$": syntax error` from the PG `DO $$` blocks, or missing `importance`/`origin` columns).

- [ ] **Step 3: Write minimal implementation**

Add `SCHEMA_SQLITE` near `SCHEMA` in `core/lore/db.py`, and branch `bootstrap_schema`:

```python
# core/lore/db.py  — final-shape schema for SQLite (no ALTER/DO$$ migration path needed)
SCHEMA_SQLITE = """
create table if not exists notes(
  id text primary key, tenant_id text, owner_id text, scope_id text,
  source_path text, title text, source_type text,
  body text, body_sha256 text, content_hash text,
  importance real default 0,
  updated_at timestamp default current_timestamp);
create table if not exists chunks(
  id text primary key, note_id text references notes(id) on delete cascade,
  heading_path text, text text, has_context integer default 0,
  chunk_index int, updated_at timestamp default current_timestamp);
create table if not exists edges(
  tenant_id text not null,
  src_note_id text not null,
  dst_note_id text not null,
  kind text not null,
  weight real default 1.0,
  evidence text,
  origin text default 'index',
  updated_at timestamp default current_timestamp,
  constraint edges_unique unique (tenant_id, src_note_id, dst_note_id, kind),
  constraint edges_kind_check check (kind in (
    'link','folder','tag','topic',
    'supports','contradicts','causes','depends_on','supersedes','implements','relates_to')));
create index if not exists edges_src on edges(src_note_id);
create index if not exists edges_dst on edges(dst_note_id);
create index if not exists edges_tenant on edges(tenant_id);
"""


def bootstrap_schema(conn):
    """Create or migrate the Lore schema.  Idempotent: safe to call on every startup."""
    if isinstance(conn, _SqliteConn):
        # Fresh, final-shape schema — no Postgres ALTER/DO$$ migration path.
        conn.executescript(SCHEMA_SQLITE)
        return

    # --- Postgres path (unchanged) ---
    for stmt in _NOTES_MIGRATION:
        try: conn.execute(stmt)
        except Exception: pass
    for stmt in _EDGES_MIGRATION:
        try: conn.execute(stmt)
        except Exception: pass
    for stmt in _BODY_MIGRATION:
        try: conn.execute(stmt)
        except Exception: pass
    try: conn.execute(_EDGES_UNIQUE_CONSTRAINT)
    except Exception: pass
    try: conn.execute(_EDGES_TOPIC_KIND_MIGRATION)
    except Exception: pass
    conn.execute(SCHEMA)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && python -m pytest tests/test_db_sqlite.py::test_bootstrap_schema_sqlite_final_shape -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add core/lore/db.py core/tests/test_db_sqlite.py
git commit -m "feat(db): final-shape SQLite schema (all columns + full edge-kind check), branch bootstrap"
```

---

### Task 3: Dialect-branched tenancy DDL (bigserial → autoincrement)

**Files:**
- Modify: `core/lore/tenancy.py` (`bootstrap_tenancy` + a SQLite schema constant)
- Test: `core/tests/test_db_sqlite.py`

**Interfaces:**
- Consumes: `db._SqliteConn` (Task 1).
- Produces: `tenancy.bootstrap_tenancy(conn)` idempotent on SQLite, creating `orgs, teams, memberships, users, audit_log` with SQLite-legal types (`bigserial`→`integer primary key autoincrement`, `timestamptz`→`timestamp`, `now()`→`current_timestamp`).

- [ ] **Step 1: Write the failing test**

```python
# add to core/tests/test_db_sqlite.py
from lore import tenancy


def test_bootstrap_tenancy_sqlite_idempotent(tmp_path):
    url = f"sqlite:///{tmp_path/'lore.db'}"
    conn = db._connect_url(url)
    tenancy.bootstrap_tenancy(conn)
    tenancy.bootstrap_tenancy(conn)  # must not raise
    for t in ("orgs", "teams", "memberships", "audit_log"):
        conn.execute(f"select count(*) from {t}").fetchone()
    # audit_log autoincrement id works without an explicit value
    conn.execute("insert into audit_log(actor_user_id, action) values (%s,%s)",
                 ("alice", "test"))
    rid = conn.execute("select id from audit_log").fetchone()[0]
    assert isinstance(rid, int)
    conn.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && python -m pytest tests/test_db_sqlite.py::test_bootstrap_tenancy_sqlite_idempotent -v`
Expected: FAIL (`sqlite3.OperationalError: near "bigserial": syntax error`).

- [ ] **Step 3: Write minimal implementation**

In `core/lore/tenancy.py`, add a SQLite schema list mirroring the existing `_SCHEMA` and branch `bootstrap_tenancy`. (Read the current `_SCHEMA` in the file; reproduce each `create table` with the substitutions below.)

```python
# core/lore/tenancy.py — SQLite variant of the tenancy DDL
_SCHEMA_SQLITE = [
    "create table if not exists orgs (id text primary key, name text, "
    "created_at timestamp default current_timestamp)",
    "create table if not exists teams (id text primary key, org_id text, name text)",
    """create table if not exists memberships (
         user_id text, org_id text, team_id text, role text,
         status text default 'active',
         primary key (user_id, team_id))""",
    "create table if not exists users (id text primary key, email text, name text)",
    """create table if not exists audit_log (
         id integer primary key autoincrement,
         ts timestamp default current_timestamp,
         actor_user_id text, action text, scope_ids text, detail text)""",
]


def bootstrap_tenancy(conn) -> None:
    """Create the tenancy tables. Idempotent — safe on every server start."""
    from . import db as _db
    stmts = _SCHEMA_SQLITE if isinstance(conn, _db._SqliteConn) else _SCHEMA
    for stmt in stmts:
        conn.execute(stmt)
```

> Note: reconcile `_SCHEMA_SQLITE` with the real Postgres `_SCHEMA` in the file at implementation time — same tables/columns, only the types differ. If `_SCHEMA` includes a `users` table or extra columns not shown here, mirror them.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && python -m pytest tests/test_db_sqlite.py::test_bootstrap_tenancy_sqlite_idempotent -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add core/lore/tenancy.py core/tests/test_db_sqlite.py
git commit -m "feat(tenancy): SQLite-legal DDL (autoincrement/timestamp), branch bootstrap_tenancy"
```

---

### Task 4: Timestamp columns read back as tz-aware datetimes

**Files:**
- Modify: `core/lore/db.py` (register a `timestamp` converter)
- Test: `core/tests/test_db_sqlite.py`

**Interfaces:**
- Consumes: `_SqliteConn` with `detect_types=PARSE_DECLTYPES` (Task 1) and columns declared `timestamp` (Tasks 2–3).
- Produces: a `sqlite3` converter registered for type name `timestamp` returning **timezone-aware UTC** `datetime`, so `updated_at.isoformat()` (`api.py:270,338,444`) and `now - updated_at` (`relations.py:360`) work unchanged.

**Why:** Codex confirmed `detect_types` alone is insufficient and the default datetime converter is deprecated (3.12). A custom converter is required, and it must return **aware** datetimes or `relations.py` (which builds `now` as aware UTC) raises "can't subtract offset-naive and offset-aware".

- [ ] **Step 1: Write the failing test**

```python
# add to core/tests/test_db_sqlite.py
import datetime
from lore import db


def test_timestamp_columns_read_as_aware_datetime(tmp_path):
    url = f"sqlite:///{tmp_path/'lore.db'}"
    conn = db._connect_url(url)
    db.bootstrap_schema(conn)
    conn.execute("insert into notes(id, tenant_id, scope_id) values (%s,%s,%s)",
                 ("n1", "t", "private"))
    ts = conn.execute("select updated_at from notes where id=%s", ("n1",)).fetchone()[0]
    assert isinstance(ts, datetime.datetime)
    assert ts.tzinfo is not None                      # tz-aware
    _ = ts.isoformat()                                # api.py depends on this
    now = datetime.datetime.now(datetime.timezone.utc)
    _ = (now - ts).total_seconds()                    # relations.py depends on this
    conn.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && python -m pytest tests/test_db_sqlite.py::test_timestamp_columns_read_as_aware_datetime -v`
Expected: FAIL (`ts` is a `str`, so `.tzinfo` / `isinstance datetime` fails).

- [ ] **Step 3: Write minimal implementation**

Add to `core/lore/db.py` (module import time, before any connection is opened):

```python
# core/lore/db.py — parse SQLite `timestamp` columns to tz-aware UTC datetimes
def _parse_sqlite_ts(value: bytes):
    s = value.decode() if isinstance(value, (bytes, bytearray)) else str(value)
    s = s.strip()
    if not s:
        return None
    # CURRENT_TIMESTAMP yields "YYYY-MM-DD HH:MM:SS" (naive UTC); also accept ISO-8601.
    txt = s.replace("Z", "+00:00")
    try:
        dt = datetime.datetime.fromisoformat(txt)
    except ValueError:
        dt = datetime.datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt


sqlite3.register_converter("timestamp", _parse_sqlite_ts)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && python -m pytest tests/test_db_sqlite.py::test_timestamp_columns_read_as_aware_datetime -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add core/lore/db.py core/tests/test_db_sqlite.py
git commit -m "feat(db): tz-aware timestamp converter for SQLite timestamp columns"
```

---

### Task 5: Portable `IN (…)` helper replacing `= any(%s)`

**Files:**
- Create: `core/lore/sqlutil.py`
- Modify: `core/lore/api.py:220`, `core/lore/api.py:432`, `core/lore/api.py:476`, `core/lore/relations.py:330`
- Test: `core/tests/test_db_sqlite.py`

**Interfaces:**
- Produces: `sqlutil.in_clause(column: str, values: list) -> tuple[str, list]` returning `("col in (%s,%s,…)", values)`, or `("1=0", [])` for an empty list (a `col in ()` is a syntax error in both engines). The `%s` placeholders survive Task 1's `%s`→`?` translation on SQLite.

**Why:** `scope_id = any(%s)` is Postgres-array-only. `api.py:220,432,476` and `relations.py:330` use it for scope/id filtering; it fails on SQLite.

- [ ] **Step 1: Write the failing test**

```python
# add to core/tests/test_db_sqlite.py
from lore import db
from lore.sqlutil import in_clause


def test_in_clause_and_scope_filter_on_sqlite(tmp_path):
    frag, params = in_clause("scope_id", ["private", "team"])
    assert frag == "scope_id in (%s,%s)"
    assert params == ["private", "team"]
    assert in_clause("scope_id", []) == ("1=0", [])

    url = f"sqlite:///{tmp_path/'lore.db'}"
    conn = db._connect_url(url)
    db.bootstrap_schema(conn)
    for i, sc in enumerate(["private", "team", "enterprise"]):
        conn.execute("insert into notes(id, tenant_id, scope_id) values (%s,%s,%s)",
                     (f"n{i}", "t", sc))
    frag, params = in_clause("scope_id", ["private", "team"])
    rows = conn.execute(
        f"select id from notes where tenant_id=%s and {frag} order by id",
        ["t", *params]).fetchall()
    assert [r[0] for r in rows] == ["n0", "n1"]
    conn.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && python -m pytest tests/test_db_sqlite.py::test_in_clause_and_scope_filter_on_sqlite -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'lore.sqlutil'`).

- [ ] **Step 3: Write minimal implementation**

```python
# core/lore/sqlutil.py
def in_clause(column: str, values):
    """Portable membership predicate. Returns (sql_fragment, params).
    Works on Postgres and SQLite (the %s placeholders are translated to ? by
    the SQLite connection wrapper). Empty list -> a never-true predicate."""
    values = list(values or [])
    if not values:
        return "1=0", []
    placeholders = ",".join(["%s"] * len(values))
    return f"{column} in ({placeholders})", values
```

Then rewrite the four call sites. Each currently reads like `... scope_id = any(%s) ...` with the scope list passed as a single param. Replace with the fragment + spread params. Example for `api.py:220` (adapt the exact surrounding SQL/params in each site):

```python
# BEFORE (api.py ~218-221):
#   """select ... where tenant_id=%s and scope_id = any(%s)""",
#   (tenant, scopes),
# AFTER:
from .sqlutil import in_clause
frag, sparams = in_clause("scope_id", scopes)
rows = _conn.execute(
    f"""select id, title, scope_id, owner_id, updated_at, source_path, importance
        ... where tenant_id=%s and {frag}""",
    [tenant, *sparams],
).fetchall()
```

Apply the same transformation at `api.py:432` (`q += " and scope_id = any(%s)"` → append `f" and {frag}"` and extend the params list), `api.py:476` (`where id = any(%s)` → `where {frag}` with `in_clause("id", ids)`), and `relations.py:330` (`where tenant_id=%s and kind = any(%s)` → `in_clause("kind", kinds)`).

- [ ] **Step 4: Run test + full API import to verify**

Run: `cd core && python -m pytest tests/test_db_sqlite.py::test_in_clause_and_scope_filter_on_sqlite -v && python -c "import lore.api, lore.relations"`
Expected: PASS and clean import (no syntax errors at the edited sites).

- [ ] **Step 5: Commit**

```bash
git add core/lore/sqlutil.py core/lore/api.py core/lore/relations.py core/tests/test_db_sqlite.py
git commit -m "feat(db): portable IN() helper; replace Postgres = any(%s) at 4 call sites"
```

---

### Task 6: Config default + desktop wiring (SQLite + embedded Qdrant, drop embedded-PG)

**Files:**
- Modify: `desktop/main.js` (backend spawn env; remove embedded-Postgres default block)
- Test: `core/tests/test_db_sqlite.py` (config-selection unit) + manual smoke

**Interfaces:**
- Consumes: `db.is_sqlite`, `db.connect` (Tasks 1–4); `qdrant_store` embedded mode via `QDRANT_PATH` (already present, no change).
- Produces: the desktop app launches the backend with `DATABASE_URL=sqlite:///<userData>/lore.db` and `QDRANT_PATH=<userData>/lore-qdrant`, and never starts embedded Postgres in the default local path.

- [ ] **Step 1: Write the failing test (config selection)**

```python
# add to core/tests/test_db_sqlite.py
import importlib, os
from lore import db


def test_connect_selects_sqlite_from_env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path/'x.db'}")
    import lore.config as cfg
    importlib.reload(cfg)
    import lore.db as dbmod
    importlib.reload(dbmod)
    conn = dbmod.connect()
    assert isinstance(conn, dbmod._SqliteConn)
    conn.close()
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `cd core && python -m pytest tests/test_db_sqlite.py::test_connect_selects_sqlite_from_env -v`
Expected: PASS if Tasks 1–4 landed (this locks the env-selection contract). If FAIL, fix `connect()`/`is_sqlite` before continuing.

- [ ] **Step 3: Wire the desktop app**

In `desktop/main.js`:
1. In the backend-spawn env setup (near `BACKEND_PORT`/`spawn`), set for the LOCAL (non-server) path:

```javascript
// Local Obsidian-light store: SQLite truth + embedded Qdrant (no servers).
const userData = app.getPath('userData');
env.DATABASE_URL = `sqlite:///${path.join(userData, 'lore.db')}`;
env.QDRANT_PATH  = path.join(userData, 'lore-qdrant');
delete env.QDRANT_URL; // ensure embedded mode, not a server client
```

2. Remove the default embedded-Postgres startup. Change the guard at the block that currently reads `if (app.isPackaged || (cfg && cfg.embeddedPg)) { ... embedded-postgres ... }` to run ONLY behind an explicit server flag, so the light local default never spawns PG:

```javascript
// Embedded Postgres is ONLY for an explicit server-mode build, never the light local default.
if (cfg && cfg.serverMode === true) {
  const embPg = require('./lib/embedded-postgres');
  // …unchanged body…
}
```

- [ ] **Step 4: Manual smoke (documented, run by the user)**

```bash
# From desktop/: launch the app in dev, then:
curl -s localhost:8099/presets            # → JSON (backend up on SQLite)
ls "$HOME/Library/Application Support/lore-desktop/lore.db"        # exists
ls "$HOME/Library/Application Support/lore-desktop/lore-qdrant/"   # exists
# No postgres/qdrant server processes and no Docker should be running.
```

- [ ] **Step 5: Commit**

```bash
git add desktop/main.js core/tests/test_db_sqlite.py
git commit -m "feat(desktop): default local store to SQLite + embedded Qdrant; gate embedded-PG behind serverMode"
```

---

### Task 7: Test parametrization, ACL port, recall-parity smoke, green suite

**Files:**
- Modify: `core/tests/conftest.py` (backend selection; default SQLite)
- Test: `core/tests/test_multitenant_acl.py`, `core/tests/test_tenancy.py` run on SQLite; add a recall-parity smoke.
- Modify: `.gitignore` (add `ruvector.db`, `*.rvf`, `*.rvf.lock`)

**Interfaces:**
- Consumes: everything above.
- Produces: `conftest.py` provides a `db_url` / connection fixture that defaults to a temp-file SQLite DB (WAL needs a real file, not `:memory:`), with an opt-in `LORE_TEST_PG=1` lane for Postgres parity.

- [ ] **Step 1: Write the recall-parity smoke test**

```python
# core/tests/test_local_recall_smoke.py
import os
from lore import db
from lore.embed import FakeEmbedder
from lore.rerank import FakeReranker
from lore.index import index_document
from lore.recall import retrieve


def test_local_sqlite_index_and_recall(tmp_path, monkeypatch):
    monkeypatch.setenv("VAULT_FAKE", "1")
    monkeypatch.setenv("QDRANT_PATH", str(tmp_path / "qdrant"))
    monkeypatch.delenv("QDRANT_URL", raising=False)
    url = f"sqlite:///{tmp_path/'lore.db'}"
    conn = db._connect_url(url)
    db.bootstrap_schema(conn)
    emb, rr = FakeEmbedder(), FakeReranker()
    index_document(
        source_id="n-falcon", title="Project Falcon",
        text="# Project Falcon\n\nThe Falcon launch checklist and rollout plan.\n",
        scope_id="private", owner_id="me", tenant_id="solo",
        embedder=emb, conn=conn, source_type="note",
    )
    hits = retrieve("falcon launch checklist", emb, rr, ["private"], "solo", limit=8)
    assert any("falcon" in (h.get("text", "").lower()) for h in hits)
    conn.close()
```

- [ ] **Step 2: Run it to verify it fails or passes**

Run: `cd core && VAULT_FAKE=1 python -m pytest tests/test_local_recall_smoke.py -v`
Expected: PASS (proves SQLite + embedded Qdrant match the recall path end-to-end). If it errors on embedded Qdrant vector config, fix before proceeding — this is the parity gate.

- [ ] **Step 3: Parametrize conftest + port ACL tests**

Update `core/tests/conftest.py` so the default backend is a temp-file SQLite DB and `bootstrap_schema` + `bootstrap_tenancy` run against it; keep a `LORE_TEST_PG=1` opt-in that uses the Postgres URL. Ensure `test_tenancy.py` and `test_multitenant_acl.py` obtain their connection from that fixture (not a hard-coded `db.connect()` to Postgres) so the leak-proof ACL invariants are proven on SQLite too. (Read the current conftest fixtures and adapt; do not duplicate the recall pipeline.)

- [ ] **Step 4: Run the full suite on SQLite**

Run: `cd core && VAULT_FAKE=1 python -m pytest -q`
Expected: PASS — `test_db_sqlite.py`, `test_local_recall_smoke.py`, the ported `test_tenancy.py` / `test_multitenant_acl.py`, and the rest of the suite, all green on the SQLite backend.

- [ ] **Step 5: Ignore stray store artifacts + commit**

```bash
printf '\nruvector.db\n*.rvf\n*.rvf.lock\n' >> .gitignore
git add core/tests/conftest.py core/tests/test_local_recall_smoke.py .gitignore
git commit -m "test(db): default test lane to SQLite; port ACL tests; local recall-parity smoke"
```

---

## Verification (end-to-end, user-run)
1. Launch the Lore desktop app in dev with **no Docker and no Postgres/Qdrant server running**.
2. `curl -s localhost:8099/presets` → JSON; `~/Library/Application Support/lore-desktop/lore.db` and `lore-qdrant/` exist.
3. Capture/ingest a note → `GET /capture/status?session_id=…` → `exists:true, chunks>0`; `GET /graph?tenant=<t>&scopes=private` node count increments; `POST /search` retrieves it.
4. `cd core && VAULT_FAKE=1 python -m pytest -q` green on SQLite, including the ported ACL tests.

## Out of scope (later slices)
Sync spine (`/sync/notes`, outbox, server-authoritative team recall); deployed team server; auth enforcement on data endpoints; agent-driven re-scoping; wizard real-time refresh; Postgres→SQLite data migration tooling.

## Self-Review notes
- **Spec coverage:** dialect db layer (T1), DDL both tables sets (T2–T3), timestamptz read hazard (T4), `= any()` (T5), embedded Qdrant + drop embedded-PG (T6), test parametrization + ACL port + parity smoke (T7). All spec §5–§9 items mapped.
- **Codex landmines mapped:** multi-statement→`executescript` (T2), `DO $$`/constraint migrations skipped on SQLite (T2), `bigserial` (T3), timestamp converter not just `detect_types` (T4), `= any()` (T5), embedded-Qdrant confirmed (T6/T7). `has_context` stored as `integer` (T2).
- **Type consistency:** `_SqliteConn`, `is_sqlite`, `_connect_url`, `in_clause` used with identical signatures across tasks.
