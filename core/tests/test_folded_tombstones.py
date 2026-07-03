"""Tombstones for upkeep-folded notes: the reconcile/scrape churn-loop guard."""
import os
import time

from fastapi.testclient import TestClient

from lore.api import app, _conn
from lore.upkeep import _delete_note

client = TestClient(app)


def test_delete_note_tombstones_file_backed(conn):
    conn.execute(
        "insert into notes(id, tenant_id, owner_id, scope_id, source_path, title,"
        " source_type, body) values(%s,%s,%s,%s,%s,%s,%s,%s)"
        " on conflict (id) do nothing",
        ("tomb-n1", "tomb-t", "u", "s", "/tmp/vault/2026-01-01.md", "2026-01-01",
         "claude-session", "x"))
    _delete_note(conn, "tomb-t", "tomb-n1")
    assert conn.execute(
        "select count(*) from notes where id=%s", ("tomb-n1",)).fetchone()[0] == 0
    row = conn.execute(
        "select folded_at from folded_paths where tenant_id=%s and path=%s",
        ("tomb-t", "/tmp/vault/2026-01-01.md")).fetchone()
    assert row and row[0] is not None


def test_delete_note_without_path_no_tombstone(conn):
    conn.execute(
        "insert into notes(id, tenant_id, owner_id, scope_id, title, source_type, body)"
        " values(%s,%s,%s,%s,%s,%s,%s) on conflict (id) do nothing",
        ("tomb-n2", "tomb-t2", "u", "s", "captured", "claude-session", "x"))
    _delete_note(conn, "tomb-t2", "tomb-n2")
    assert conn.execute(
        "select count(*) from folded_paths where tenant_id=%s",
        ("tomb-t2",)).fetchone()[0] == 0


def test_reindex_skips_tombstoned_path(tmp_path):
    p = tmp_path / "folded.md"
    p.write_text("# Folded\n\nsome real prose that would otherwise index fine here.")
    # Backdate the file well before the tombstone: sub-second clock/mtime
    # resolution differences (bit us on the Windows CI runner) must never make
    # a just-written file look "edited after folding".
    past = time.time() - 3600
    os.utime(p, (past, past))
    _conn.execute(
        "insert into folded_paths(tenant_id, path, folded_at) values(%s,%s,now())"
        " on conflict (tenant_id, path) do update set folded_at=excluded.folded_at",
        ("tomb-t3", str(p)))
    r = client.post("/reindex", json={
        "path": str(p), "owner_id": "u", "scope_id": "s", "tenant_id": "tomb-t3"})
    assert r.status_code == 200
    assert r.json() == {"indexed_chunks": 0, "skipped": "folded"}


def test_reindex_edited_after_fold_clears_tombstone(tmp_path):
    p = tmp_path / "revived.md"
    p.write_text("# Revived\n\nedited after the fold so it must index again normally.")
    _conn.execute(
        "insert into folded_paths(tenant_id, path, folded_at) values(%s,%s,now())"
        " on conflict (tenant_id, path) do update set folded_at=excluded.folded_at",
        ("tomb-t4", str(p)))
    # Make the file look newer than the tombstone.
    future = time.time() + 60
    os.utime(p, (future, future))
    r = client.post("/reindex", json={
        "path": str(p), "owner_id": "u", "scope_id": "s", "tenant_id": "tomb-t4"})
    assert r.status_code == 200
    assert r.json().get("indexed_chunks", 0) > 0
    assert _conn.execute(
        "select count(*) from folded_paths where tenant_id=%s and path=%s",
        ("tomb-t4", str(p))).fetchone()[0] == 0
