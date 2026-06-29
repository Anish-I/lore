"""Tests for POST /capture, GET /capture/status, DELETE /capture, and redact().

Pure-logic tests (redact) need no services.
Integration tests need Postgres + Qdrant (same as existing test_ingest_and_graph.py).
VAULT_FAKE=1 is set by conftest.py — FakeEmbedder is used for all indexing.
"""
import hashlib
from fastapi.testclient import TestClient
from lore.api import app, get_embedder, get_reranker
from lore.embed import FakeEmbedder
from lore.rerank import FakeReranker
from lore.redact import redact

app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
app.dependency_overrides[get_reranker] = lambda: FakeReranker()
client = TestClient(app)


# ---------------------------------------------------------------------------
# Pure-logic: redact()
# ---------------------------------------------------------------------------

def test_redact_aws_key():
    out = redact("Set AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE in your env.")
    assert "AKIAIOSFODNN7EXAMPLE" not in out
    assert "[REDACTED]" in out


def test_redact_github_token():
    out = redact("token: ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ12")
    assert "ghp_" not in out
    assert "[REDACTED]" in out


def test_redact_slack_token():
    out = redact("slack bot token: xoxb-123456789012-abcdefghijklmnopqrstuvwx")
    assert "xoxb-" not in out
    assert "[REDACTED]" in out


def test_redact_pem_block():
    pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----"
    out = redact(pem)
    assert "BEGIN RSA PRIVATE KEY" not in out
    assert "[REDACTED]" in out


def test_redact_generic_kv():
    out = redact("api_key=supersecretvalue123")
    assert "supersecretvalue123" not in out
    assert "[REDACTED]" in out


def test_redact_preserves_normal_text():
    text = "This is a normal sentence about the Q3 renewal risk."
    assert redact(text) == text


# ---------------------------------------------------------------------------
# Integration: POST /capture
# ---------------------------------------------------------------------------

def test_capture_returns_ok():
    r = client.post("/capture", json={
        "session_id": "cap-test-001",
        "title": "Test Capture",
        "text": "# Test Capture\n\nSome useful notes from a session.\n",
        "scope": "private",
        "owner": "me",
        "tenant": "solo",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["chunks"] >= 1
    expected_id = hashlib.sha1(b"cap-test-001").hexdigest()[:16]
    assert body["note_id"] == expected_id


def test_capture_upserts_single_note():
    """Re-POSTing the same session_id must produce exactly one notes row."""
    base = {
        "session_id": "cap-upsert-001",
        "title": "Upsert Session",
        "text": "# Upsert\n\nFirst version.\n",
        "scope": "private",
        "owner": "me",
        "tenant": "solo",
    }
    client.post("/capture", json=base)
    client.post("/capture", json={**base, "text": "# Upsert\n\nSecond version.\n"})

    from lore import db
    conn = db.connect()
    note_id = hashlib.sha1(b"cap-upsert-001").hexdigest()[:16]
    count = conn.execute(
        "select count(*) from notes where id=%s", (note_id,)
    ).fetchone()[0]
    assert count == 1, f"Expected 1 note row after two captures, got {count}"


def test_capture_redacts_aws_key_before_storage():
    """AKIA… key in session text must not appear in any stored chunk."""
    r = client.post("/capture", json={
        "session_id": "cap-secret-aws",
        "title": "AWS Secret Session",
        "text": "# Config\n\naws_key = AKIAIOSFODNN7EXAMPLE\nsome other notes follow.\n",
        "scope": "private",
        "owner": "me",
        "tenant": "solo",
    })
    assert r.status_code == 200

    from lore import db
    conn = db.connect()
    note_id = hashlib.sha1(b"cap-secret-aws").hexdigest()[:16]
    chunks = conn.execute(
        "select text from chunks where note_id=%s", (note_id,)
    ).fetchall()
    for (chunk_text,) in chunks:
        assert "AKIAIOSFODNN7EXAMPLE" not in chunk_text, \
            "AWS key must be redacted before storage"


def test_capture_redacts_github_token_before_storage():
    """ghp_ token in session text must not appear in any stored chunk."""
    r = client.post("/capture", json={
        "session_id": "cap-secret-gh",
        "title": "GH Token Session",
        "text": "# Auth\n\ntoken: ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ12\nrest of notes.\n",
        "scope": "private",
        "owner": "me",
        "tenant": "solo",
    })
    assert r.status_code == 200

    from lore import db
    conn = db.connect()
    note_id = hashlib.sha1(b"cap-secret-gh").hexdigest()[:16]
    chunks = conn.execute(
        "select text from chunks where note_id=%s", (note_id,)
    ).fetchall()
    for (chunk_text,) in chunks:
        assert "ghp_" not in chunk_text, "GitHub token must be redacted before storage"


def test_source_type_persisted_as_claude_session():
    """/capture must store source_type='claude-session' on the notes row."""
    client.post("/capture", json={
        "session_id": "cap-srctype-001",
        "title": "Source Type Check",
        "text": "# Check\n\nVerifying source_type is stored correctly.\n",
        "scope": "private",
        "owner": "me",
        "tenant": "solo",
    })
    from lore import db
    conn = db.connect()
    note_id = hashlib.sha1(b"cap-srctype-001").hexdigest()[:16]
    row = conn.execute(
        "select source_type from notes where id=%s", (note_id,)
    ).fetchone()
    assert row is not None
    assert row[0] == "claude-session"


# ---------------------------------------------------------------------------
# Integration: GET /capture/status
# ---------------------------------------------------------------------------

def test_capture_status_exists():
    session_id = "cap-status-001"
    client.post("/capture", json={
        "session_id": session_id,
        "title": "Status Test",
        "text": "# Status\n\nContent to verify status endpoint.\n",
        "scope": "private",
        "owner": "me",
        "tenant": "solo",
    })
    r = client.get("/capture/status", params={"session_id": session_id})
    assert r.status_code == 200
    body = r.json()
    assert body["exists"] is True
    assert body["chunks"] >= 1
    assert body["updated"] is not None
    assert body["note_id"] == hashlib.sha1(session_id.encode()).hexdigest()[:16]


def test_capture_status_not_found():
    r = client.get("/capture/status", params={"session_id": "cap-never-indexed-xyz"})
    assert r.status_code == 200
    body = r.json()
    assert body["exists"] is False
    assert body["chunks"] == 0


# ---------------------------------------------------------------------------
# Integration: DELETE /capture
# ---------------------------------------------------------------------------

def test_delete_capture_purges_notes():
    """DELETE /capture must remove all claude-session notes for the tenant and
    return the count of deleted rows."""
    # Use a dedicated tenant so the count is deterministic.
    client.post("/capture", json={
        "session_id": "cap-del-001",
        "title": "Delete Me",
        "text": "# Delete\n\nThis should be purged.\n",
        "scope": "private",
        "owner": "me",
        "tenant": "purge-cap-tenant",
    })

    from lore import db
    conn = db.connect()
    before = conn.execute(
        "select count(*) from notes where tenant_id=%s and source_type=%s",
        ("purge-cap-tenant", "claude-session"),
    ).fetchone()[0]
    assert before >= 1

    r = client.delete(
        "/capture",
        params={"source_type": "claude-session", "tenant": "purge-cap-tenant"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["deleted"] >= 1

    after = conn.execute(
        "select count(*) from notes where tenant_id=%s and source_type=%s",
        ("purge-cap-tenant", "claude-session"),
    ).fetchone()[0]
    assert after == 0
