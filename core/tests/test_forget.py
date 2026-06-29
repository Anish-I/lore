"""Tests for POST /forget: path-prefix-scoped graph purge.

Inserts notes directly (bypassing /ingest which does not set source_path) so that
source_path can be controlled, then verifies /forget removes only the intended rows.
"""
import hashlib
from fastapi.testclient import TestClient
from lore.api import app, get_embedder, get_reranker
from lore.embed import FakeEmbedder
from lore.rerank import FakeReranker
from lore import db

app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
app.dependency_overrides[get_reranker] = lambda: FakeReranker()
client = TestClient(app)


def _insert_note(source_id: str, title: str, source_path: str, tenant: str) -> None:
    """Insert a note row directly so we can control source_path."""
    conn = db.connect()
    body = f"# {title}\n\nTest content."
    sha = hashlib.sha256(body.encode()).hexdigest()
    conn.execute(
        """insert into notes(id, tenant_id, owner_id, scope_id, source_path, title,
                             source_type, body, body_sha256, updated_at)
           values(%s,%s,%s,%s,%s,%s,%s,%s,%s,now())
           on conflict (id) do update
             set source_path=excluded.source_path, title=excluded.title,
                 updated_at=now()""",
        (source_id, tenant, "owner", "private", source_path, title, "wizard", body, sha),
    )


def test_forget_removes_notes_under_prefix():
    """POST /forget must delete notes whose source_path starts with path_prefix."""
    tenant = "forget-test-prefix"
    _insert_note("fgt-note-1", "Alpha", "/Wizards/Test Wiz/alpha.md", tenant)
    _insert_note("fgt-note-2", "Beta", "/Wizards/Test Wiz/beta.md", tenant)
    _insert_note("fgt-note-3", "Keeper", "/Wizards/Other/keeper.md", tenant)

    r = client.post("/forget", json={"tenant": tenant, "path_prefix": "/Wizards/Test Wiz"})
    assert r.status_code == 200
    body = r.json()
    assert body["forgotten"] == 2

    conn = db.connect()
    remaining_ids = {row[0] for row in conn.execute(
        "select id from notes where tenant_id=%s", (tenant,)
    ).fetchall()}
    assert "fgt-note-1" not in remaining_ids, "Alpha should be forgotten"
    assert "fgt-note-2" not in remaining_ids, "Beta should be forgotten"
    assert "fgt-note-3" in remaining_ids, "Note outside prefix must survive"


def test_forget_leaves_other_tenant_untouched():
    """/forget must be strictly scoped to the requested tenant."""
    _insert_note("fgt-cross-1", "Cross A", "/Wizards/Wiz/note.md", "forget-tenant-a")
    _insert_note("fgt-cross-2", "Cross B", "/Wizards/Wiz/note.md", "forget-tenant-b")

    r = client.post("/forget", json={"tenant": "forget-tenant-a", "path_prefix": "/Wizards/Wiz"})
    assert r.status_code == 200
    assert r.json()["forgotten"] >= 1

    conn = db.connect()
    row = conn.execute(
        "select id from notes where id=%s and tenant_id=%s",
        ("fgt-cross-2", "forget-tenant-b"),
    ).fetchone()
    assert row is not None, "Other tenant's note must not be deleted"


def test_forget_normalizes_backslashes():
    """Path prefix with backslashes must match source_path stored with forward slashes."""
    tenant = "forget-test-bs"
    _insert_note("fgt-bs-1", "Backslash", "/Wizards/Win Wiz/note.md", tenant)

    # Send prefix with backslashes as main.js would on Windows
    r = client.post("/forget", json={
        "tenant": tenant,
        "path_prefix": "\\Wizards\\Win Wiz",
    })
    assert r.status_code == 200
    assert r.json()["forgotten"] == 1


def test_forget_missing_tenant_returns_422():
    r = client.post("/forget", json={"tenant": "", "path_prefix": "/Wizards/Foo"})
    assert r.status_code == 422


def test_forget_missing_prefix_returns_422():
    r = client.post("/forget", json={"tenant": "t1", "path_prefix": ""})
    assert r.status_code == 422
