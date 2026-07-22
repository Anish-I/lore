import contextlib
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
# a threadpool, and SQLite allows only one writer at a time.  Re-entrant so
# execute() calls inside a held transaction() don't deadlock.
_SQLITE_WRITE_LOCK = threading.RLock()


def _translate_placeholders(sql):
    """Rewrite ``%s`` -> ``?`` only OUTSIDE single/double-quoted string literals,
    so a literal ``%s`` inside stored text (evidence, note bodies in seed SQL, …)
    is never mistaken for a bind parameter. Handles doubled-quote escapes
    (``''`` and ``""``). Returns ``(translated_sql, placeholder_count)`` so the
    caller can assert the bind-arg count up front instead of getting a confusing
    off-by-one from sqlite3 at execute time."""
    out = []
    i = 0
    n = len(sql)
    quote = None
    count = 0
    while i < n:
        ch = sql[i]
        if quote:
            out.append(ch)
            if ch == quote:
                if i + 1 < n and sql[i + 1] == quote:  # '' or "" escape
                    out.append(sql[i + 1])
                    i += 2
                    continue
                quote = None
            i += 1
            continue
        if ch in ("'", '"'):
            quote = ch
            out.append(ch)
            i += 1
            continue
        if ch == "%" and i + 1 < n and sql[i + 1] == "s":
            out.append("?")
            count += 1
            i += 2
            continue
        out.append(ch)
        i += 1
    return "".join(out), count


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
    p = url[len("sqlite://"):] if url.startswith("sqlite://") else url
    # sqlite:///C:\... on Windows leaves a leading slash before the drive letter,
    # which sqlite3.connect cannot open. POSIX paths keep their leading slash.
    if re.match(r"^/[A-Za-z]:", p):
        p = p[1:]
    return p


class _SqliteCursor:
    """Wraps a sqlite3 cursor so callers get psycopg-like fetchone/fetchall."""
    def __init__(self, cur):
        self._cur = cur

    @property
    def rowcount(self):
        # psycopg-parity: rows affected by the last INSERT/UPDATE/DELETE
        # (sqlite3 reports -1 for SELECTs, same as psycopg before a fetch).
        return self._cur.rowcount

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
        # Postgres-parity: now() in raw SQL. Returns UTC in a form the registered
        # `timestamp` converter (_parse_sqlite_ts) parses back to a tz-aware datetime.
        self._db.create_function(
            "now", 0,
            lambda: datetime.datetime.now(datetime.timezone.utc).isoformat(sep=" "),
        )

    def execute(self, sql, params=()):
        params = tuple(params)
        sql, expected = _translate_placeholders(sql)
        assert expected == len(params), (
            f"SQL has {expected} placeholder(s) but {len(params)} param(s) given: {sql!r}")
        with _SQLITE_WRITE_LOCK:
            cur = self._db.execute(sql, params)
        return _SqliteCursor(cur)

    def executescript(self, sql):
        with _SQLITE_WRITE_LOCK:
            self._db.executescript(sql)

    @contextlib.contextmanager
    def transaction(self):
        """psycopg-parity: `with conn.transaction():` block. The connection is
        autocommit (isolation_level=None), so an explicit BEGIN IMMEDIATE opens a
        real write transaction; COMMIT on success, ROLLBACK on exception. The lock
        is re-entrant, so execute() calls inside the block don't deadlock."""
        with _SQLITE_WRITE_LOCK:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                yield
            except Exception:
                self._db.execute("ROLLBACK")
                raise
            else:
                self._db.execute("COMMIT")

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
  memory_type text default 'durable',
  body text, body_sha256 text, content_hash text,
  importance real default 0,
  created_at timestamptz,
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
  origin text default 'index',
  updated_at timestamptz default now(),
  constraint edges_unique unique (tenant_id, src_note_id, dst_note_id, kind),
  constraint edges_kind_check check (kind in (
    'link','folder','tag','topic',
    'supports','contradicts','causes','depends_on','supersedes','implements','relates_to')));
create index if not exists edges_src on edges(src_note_id);
create index if not exists edges_dst on edges(dst_note_id);
create index if not exists edges_tenant on edges(tenant_id);
create table if not exists note_tags(
  note_id text not null,
  tenant_id text not null,
  tag text not null,
  kind text not null default 'tag',
  source text default 'heuristic',
  created_at timestamptz default now(),
  constraint note_tags_unique unique (tenant_id, note_id, tag, kind));
create index if not exists note_tags_note on note_tags(note_id);
create index if not exists note_tags_tenant on note_tags(tenant_id, kind, tag);
create table if not exists agents(
  tenant_id text not null,
  name text not null,
  first_seen timestamptz default now(),
  last_write timestamptz,
  writes integer default 0,
  claimed_by text,
  primary key (tenant_id, name));
create table if not exists feedback(
  tenant_id text not null,
  note_id text not null,
  vote integer not null,
  query_hash text,
  ts timestamptz default now());
create index if not exists feedback_note on feedback(tenant_id, note_id);
create table if not exists section_proposals(
  id text primary key,
  tenant_id text not null,
  name text not null,
  topic text not null,
  note_ids text,
  original_paths text,
  status text not null default 'proposed',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint section_status_check check (status in ('proposed','applied','dismissed')));
create index if not exists sections_tenant on section_proposals(tenant_id);
create table if not exists personal_wizards(
  id text primary key,
  tenant_id text not null,
  section_id text not null,
  name text not null,
  topic text not null,
  note_count int default 0,
  share_scope text not null default 'private',
  created_at timestamptz default now(),
  constraint pw_share_scope_check check (share_scope in ('private','team','public')));
create index if not exists personal_wizards_tenant on personal_wizards(tenant_id);
create table if not exists personal_wizard_chats(
  id text primary key,
  wizard_id text not null,
  tenant_id text not null,
  role text not null,
  text text,
  sources text,
  created_at timestamptz default now(),
  constraint pw_chat_role_check check (role in ('user','assistant')));
create index if not exists pw_chats_wizard on personal_wizard_chats(wizard_id, tenant_id);
create table if not exists ask_history(
  id text primary key,
  tenant_id text not null,
  thread_id text not null,
  role text not null,
  text text,
  sources text,
  source text,
  created_at timestamptz default now(),
  constraint ask_history_role_check check (role in ('user','assistant')));
create index if not exists ask_history_thread on ask_history(tenant_id, thread_id);
create table if not exists folded_paths(
  tenant_id text not null,
  path text not null,
  folded_at timestamptz default now(),
  primary key (tenant_id, path));
create table if not exists query_log(
  id bigserial primary key,
  tenant_id text,
  ts timestamptz default now(),
  endpoint text,
  principal text,
  scopes text,
  query_hash text,
  hits integer);
create index if not exists query_log_ts on query_log(tenant_id, ts desc);
create table if not exists todos(
  id text primary key,
  tenant_id text not null,
  scope_id text,
  owner_id text,
  assignee text,
  task text not null,
  due text,
  due_text text,
  source text,
  source_note_id text,
  status text not null default 'pending',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint todos_status_check check (status in ('pending','confirmed','dismissed')));
create index if not exists todos_tenant on todos(tenant_id, status);
create table if not exists connector_seen(
  tenant_id text not null,
  source text not null,
  external_id text not null,
  scope_id text not null default '',
  todo_count integer default 0,
  seen_at timestamptz default now(),
  primary key (tenant_id, source, scope_id, external_id));
"""

# PG migration note: personal_wizards / personal_wizard_chats / ask_history are NEW tables, so the
# CREATE TABLE IF NOT EXISTS in SCHEMA above IS the migration (bootstrap step 3) —
# same pattern section_proposals used; no ALTER/DO$$ entry needed.
#
# share_scope migration note: pre-existing personal_wizards tables (both dialects)
# lack the column, so bootstrap adds it — PG via ADD COLUMN IF NOT EXISTS below,
# SQLite via probe-and-add in bootstrap_schema (same pattern as notes.created_at).
# Migrated columns don't get the CHECK constraint; sections.promote_section
# validates the value in code, so nothing invalid can be written either way.
_WIZARD_SCOPE_MIGRATION = [
    "alter table personal_wizards add column if not exists share_scope text not null default 'private'",
]

# Columns added in M1 (Hooks milestone).  ADD COLUMN IF NOT EXISTS is idempotent
# on PostgreSQL 9.6+.  Run before the SCHEMA block so existing databases get the
# new columns even though CREATE TABLE IF NOT EXISTS won't re-create an existing table.
_NOTES_MIGRATION = [
    "alter table notes add column if not exists source_type text",
    # M2: the User/Session/Agent memory-type axis (orthogonal to the scope ACL).
    "alter table notes add column if not exists memory_type text default 'durable'",
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

# Column added for the graph date-scrubber: the NOTE's real creation date
# (frontmatter created:/date: → file mtime → first-seen), never index time.
# updated_at keeps tracking (re)index time.  Nullable: backfilled lazily by
# index.backfill_created_at (wired into /upkeep/run and /backfill/created).
_CREATED_MIGRATION = [
    "alter table notes add column if not exists created_at timestamptz",
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


# connector_seen re-key: the watermark's dedup key gained `scope_id` so two scopes
# in one tenant syncing same-named folders no longer collide (the 2nd would else
# silently get zero to-dos). connector_seen is a pure regenerable dedup cache, so
# the migration just drops the stale table when its PK predates scope_id — the
# SCHEMA CREATE below rebuilds it and the next sync re-imports (idempotent) once.
# No shipped DB has this table yet (new in the connector work), so in practice this
# only resets local dev/test DBs; fresh installs get the correct PK from the start.
_CONNECTOR_SEEN_REKEY = """
do $$ begin
  if exists (select 1 from information_schema.tables where table_name='connector_seen')
     and not exists (
       select 1 from information_schema.table_constraints t
       join information_schema.key_column_usage k on k.constraint_name = t.constraint_name
       where t.table_name='connector_seen' and t.constraint_type='PRIMARY KEY'
         and k.column_name='scope_id')
  then
    drop table connector_seen;
  end if;
end $$
"""

# Final-shape schema for SQLite (no ALTER/DO$$ migration path needed): includes
# all M1/M2/M7 columns and the full edges-kind CHECK (base kinds + reasoned-graph
# kinds) up front, since SQLite installs are always fresh (no legacy DBs to migrate).
SCHEMA_SQLITE = """
create table if not exists notes(
  id text primary key, tenant_id text, owner_id text, scope_id text,
  source_path text, title text, source_type text,
  memory_type text default 'durable',
  body text, body_sha256 text, content_hash text,
  importance real default 0,
  created_at timestamp,
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
create table if not exists note_tags(
  note_id text not null,
  tenant_id text not null,
  tag text not null,
  kind text not null default 'tag',
  source text default 'heuristic',
  created_at timestamp default current_timestamp,
  constraint note_tags_unique unique (tenant_id, note_id, tag, kind));
create index if not exists note_tags_note on note_tags(note_id);
create index if not exists note_tags_tenant on note_tags(tenant_id, kind, tag);
create table if not exists agents(
  tenant_id text not null,
  name text not null,
  first_seen timestamp default current_timestamp,
  last_write timestamp,
  writes integer default 0,
  claimed_by text,
  primary key (tenant_id, name));
create table if not exists feedback(
  tenant_id text not null,
  note_id text not null,
  vote integer not null,
  query_hash text,
  ts timestamp default current_timestamp);
create index if not exists feedback_note on feedback(tenant_id, note_id);
create table if not exists section_proposals(
  id text primary key,
  tenant_id text not null,
  name text not null,
  topic text not null,
  note_ids text,
  original_paths text,
  status text not null default 'proposed',
  created_at timestamp default current_timestamp,
  updated_at timestamp default current_timestamp,
  constraint section_status_check check (status in ('proposed','applied','dismissed')));
create index if not exists sections_tenant on section_proposals(tenant_id);
create table if not exists personal_wizards(
  id text primary key,
  tenant_id text not null,
  section_id text not null,
  name text not null,
  topic text not null,
  note_count int default 0,
  share_scope text not null default 'private',
  created_at timestamp default current_timestamp,
  constraint pw_share_scope_check check (share_scope in ('private','team','public')));
create index if not exists personal_wizards_tenant on personal_wizards(tenant_id);
create table if not exists personal_wizard_chats(
  id text primary key,
  wizard_id text not null,
  tenant_id text not null,
  role text not null,
  text text,
  sources text,
  created_at timestamp default current_timestamp,
  constraint pw_chat_role_check check (role in ('user','assistant')));
create index if not exists pw_chats_wizard on personal_wizard_chats(wizard_id, tenant_id);
create table if not exists ask_history(
  id text primary key,
  tenant_id text not null,
  thread_id text not null,
  role text not null,
  text text,
  sources text,
  source text,
  created_at timestamp default current_timestamp,
  constraint ask_history_role_check check (role in ('user','assistant')));
create index if not exists ask_history_thread on ask_history(tenant_id, thread_id);
create table if not exists folded_paths(
  tenant_id text not null,
  path text not null,
  folded_at timestamp default current_timestamp,
  primary key (tenant_id, path));
create table if not exists query_log(
  id integer primary key autoincrement,
  tenant_id text,
  ts timestamp default current_timestamp,
  endpoint text,
  principal text,
  scopes text,
  query_hash text,
  hits integer);
create index if not exists query_log_ts on query_log(tenant_id, ts desc);
create table if not exists todos(
  id text primary key,
  tenant_id text not null,
  scope_id text,
  owner_id text,
  assignee text,
  task text not null,
  due text,
  due_text text,
  source text,
  source_note_id text,
  status text not null default 'pending',
  created_at timestamp default current_timestamp,
  updated_at timestamp default current_timestamp,
  constraint todos_status_check check (status in ('pending','confirmed','dismissed')));
create index if not exists todos_tenant on todos(tenant_id, status);
create table if not exists connector_seen(
  tenant_id text not null,
  source text not null,
  external_id text not null,
  scope_id text not null default '',
  todo_count integer default 0,
  seen_at timestamp default current_timestamp,
  primary key (tenant_id, source, scope_id, external_id));
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
        # connector_seen re-key (see _CONNECTOR_SEEN_REKEY): if an existing table
        # predates scope_id in the PK, drop it (regenerable dedup cache) so the
        # CREATE below rebuilds it with the new key. Probe via PRAGMA: pk>0 means the
        # column is part of the primary key.
        try:
            cols = conn.execute("PRAGMA table_info(connector_seen)").fetchall()
            if cols and not any(c[1] == "scope_id" and c[5] for c in cols):
                conn.execute("drop table connector_seen")
        except Exception:
            pass  # table doesn't exist yet; CREATE below handles it
        # Fresh, final-shape schema — no Postgres ALTER/DO$$ migration path.
        conn.executescript(SCHEMA_SQLITE)
        # One exception: SQLite stores created before the created_at column shipped.
        # CREATE TABLE IF NOT EXISTS won't add it and SQLite has no
        # ADD COLUMN IF NOT EXISTS, so probe-and-add (idempotent).
        try:
            conn.execute("alter table notes add column created_at timestamp")
        except Exception:
            pass  # column already exists
        # Same probe-and-add for personal_wizards.share_scope (stores created
        # before the wizard share-scope shipped).
        try:
            conn.execute(
                "alter table personal_wizards add column share_scope text not null default 'private'")
        except Exception:
            pass  # column already exists
        # M2: memory-type axis for stores created before the column shipped.
        try:
            conn.execute("alter table notes add column memory_type text default 'durable'")
        except Exception:
            pass  # column already exists
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

    # Step 1d: add created_at to notes (graph date-scrubber).
    for stmt in _CREATED_MIGRATION:
        try:
            conn.execute(stmt)
        except Exception:
            pass  # table may not exist yet

    # Step 1e: add share_scope to personal_wizards (wizard sharing milestone).
    for stmt in _WIZARD_SCOPE_MIGRATION:
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

    # Step 2c: re-key connector_seen to include scope_id (drops the stale dedup
    # cache when its PK predates scope_id; SCHEMA below rebuilds it).
    try:
        conn.execute(_CONNECTOR_SEEN_REKEY)
    except Exception:
        pass  # table doesn't exist yet; CREATE TABLE below handles that

    # Step 3: create all tables/indexes (IF NOT EXISTS guards make this a no-op on
    # databases that already have the tables from step 1/2 above).
    conn.execute(SCHEMA)
