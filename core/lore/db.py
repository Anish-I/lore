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

# Fresh-install schema.  All CREATE statements use IF NOT EXISTS; indexes use
# CREATE INDEX IF NOT EXISTS so this is safe to call on every startup.
#
# edges shape (M1):
#   kind constrained to ('link','folder','tag','topic')
#   UNIQUE on (tenant_id, src_note_id, dst_note_id, kind)
SCHEMA = """
create table if not exists notes(
  id text primary key, tenant_id text, owner_id text, scope_id text,
  source_path text, title text, source_type text,
  body text, body_sha256 text, content_hash text,
  updated_at timestamptz default now());
create table if not exists chunks(
  id text primary key, note_id text references notes(id) on delete cascade,
  heading_path text, text text, has_context boolean default false,
  chunk_index int, updated_at timestamptz default now());
create table if not exists edges(
  tenant_id text not null,
  src_note_id text not null,
  dst_note_id text not null,
  kind text not null,
  weight real default 1.0,
  evidence text,
  updated_at timestamptz default now(),
  constraint edges_unique unique (tenant_id, src_note_id, dst_note_id, kind),
  constraint edges_kind_check check (kind in ('link','folder','tag','topic')));
create index if not exists edges_src on edges(src_note_id);
create index if not exists edges_dst on edges(dst_note_id);
create index if not exists edges_tenant on edges(tenant_id);
"""

# Columns added in M1 (Hooks milestone).  ADD COLUMN IF NOT EXISTS is idempotent
# on PostgreSQL 9.6+.  Run before the SCHEMA block so existing databases get the
# new columns even though CREATE TABLE IF NOT EXISTS won't re-create an existing table.
_NOTES_MIGRATION = [
    "alter table notes add column if not exists source_type text",
]

_EDGES_MIGRATION = [
    "alter table edges add column if not exists tenant_id text",
    "alter table edges add column if not exists weight real default 1.0",
    "alter table edges add column if not exists evidence text",
    "alter table edges add column if not exists updated_at timestamptz default now()",
    # Edge provenance: 'index' (recomputed each ingest) vs 'capture' (extracted from a
    # session note before upkeep deletes it — must NOT be wiped by index recompute).
    "alter table edges add column if not exists origin text default 'index'",
]

# Columns added in M2 (body storage + upkeep milestone).
_BODY_MIGRATION = [
    "alter table notes add column if not exists body text",
    "alter table notes add column if not exists body_sha256 text",
    "alter table notes add column if not exists content_hash text",
    # M7 reasoned-graph: per-note importance score (weighted typed in-degree).
    "alter table notes add column if not exists importance real default 0",
]

# Unique constraint added in M1; applied opportunistically (no-op if already present).
_EDGES_UNIQUE_CONSTRAINT = """
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'edges_unique') then
    alter table edges
      add constraint edges_unique unique (tenant_id, src_note_id, dst_note_id, kind);
  end if;
end $$
"""

# Kind constraint extended in M2 to allow 'topic' edges created by upkeep.
# Drop and recreate (idempotent: the new constraint name is the same, so a second run
# drops the already-correct constraint and re-adds it — harmless on PG 9.6+).
_EDGES_TOPIC_KIND_MIGRATION = """
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'edges_kind_check') then
    alter table edges drop constraint edges_kind_check;
  end if;
  alter table edges
    add constraint edges_kind_check check (kind in (
      'link','folder','tag','topic',
      'supports','contradicts','causes','depends_on','supersedes','implements','relates_to'));
end $$
"""


# Final-shape schema for SQLite (no ALTER/DO$$ migration path needed): includes
# all M1/M2/M7 columns and the full edges-kind CHECK (base kinds + reasoned-graph
# kinds) up front, since SQLite installs are always fresh (no legacy DBs to migrate).
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


def connect():
    return _connect_url(settings.database_url)


def bootstrap_schema(conn):
    """Create or migrate the Lore schema.  Idempotent: safe to call on every startup.

    Migration path for pre-M1/M2 databases: adds the new columns and constraints
    without dropping existing data.  The main SCHEMA block is then executed with
    IF NOT EXISTS guards so fresh installs and upgrades both work.
    """
    if isinstance(conn, _SqliteConn):
        # Fresh, final-shape schema — no Postgres ALTER/DO$$ migration path.
        conn.executescript(SCHEMA_SQLITE)
        return

    # Step 1a: add source_type to notes (M1 migration).
    for stmt in _NOTES_MIGRATION:
        try:
            conn.execute(stmt)
        except Exception:
            pass  # table may not exist yet on a truly fresh install

    # Step 1b: add missing columns to old edges table (no-op on fresh install where
    # the table doesn't exist yet; the try/except absorbs that failure).
    for stmt in _EDGES_MIGRATION:
        try:
            conn.execute(stmt)
        except Exception:
            pass  # table doesn't exist yet; CREATE TABLE below handles that

    # Step 1c: add body/body_sha256/content_hash to notes (M2 migration).
    for stmt in _BODY_MIGRATION:
        try:
            conn.execute(stmt)
        except Exception:
            pass  # table may not exist yet

    # Step 2: add unique constraint if missing.
    try:
        conn.execute(_EDGES_UNIQUE_CONSTRAINT)
    except Exception:
        pass  # already present, or table doesn't exist yet

    # Step 2b: extend edges kind constraint to include 'topic' (M2 migration).
    try:
        conn.execute(_EDGES_TOPIC_KIND_MIGRATION)
    except Exception:
        pass  # table doesn't exist yet; CREATE TABLE below handles that

    # Step 3: create all tables/indexes (IF NOT EXISTS guards make this a no-op on
    # databases that already have the tables from step 1/2 above).
    conn.execute(SCHEMA)
