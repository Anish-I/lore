import psycopg
from .config import settings

SCHEMA = """
create table if not exists notes(
  id text primary key, tenant_id text, owner_id text, scope_id text,
  source_path text, title text, updated_at timestamptz default now());
create table if not exists chunks(
  id text primary key, note_id text references notes(id) on delete cascade,
  heading_path text, text text, has_context boolean default false,
  chunk_index int, updated_at timestamptz default now());
create table if not exists edges(
  src_note_id text, dst_note_id text, kind text);
"""

def connect():
    conn = psycopg.connect(settings.database_url, autocommit=True)
    return conn

def bootstrap_schema(conn):
    conn.execute(SCHEMA)
