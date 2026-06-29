"""Test that ingest stores the original body and GET /notes/{id} returns it verbatim."""
import hashlib
from fastapi.testclient import TestClient
from lore.api import app, get_embedder, get_reranker
from lore.embed import FakeEmbedder
from lore.rerank import FakeReranker

app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
app.dependency_overrides[get_reranker] = lambda: FakeReranker()
client = TestClient(app)

_BODY = "# My Note\n\nSome content here.\n\n[[Related Topic]]\n\n#tag1 #tag2\n"
_SOURCE_ID = "body-roundtrip-test-001"


def test_body_stored_and_returned():
    """Ingest a note then GET /notes/{id} — body must be the original text verbatim."""
    r = client.post("/ingest", json={
        "source_id": _SOURCE_ID,
        "title": "Body Round-trip Test",
        "text": _BODY,
        "scope": "private",
        "owner": "me",
        "tenant": "body-rt-tenant",
    })
    assert r.status_code == 200, r.text

    # /notes/{id} ACL-filters by tenant (defaults to the active profile); pass the tenant we ingested under.
    r2 = client.get(f"/notes/{_SOURCE_ID}", params={"tenant": "body-rt-tenant"})
    assert r2.status_code == 200, r2.text
    data = r2.json()
    assert data["id"] == _SOURCE_ID
    assert data["body"] == _BODY, "body must match the original ingested text verbatim"
    assert data["title"] == "Body Round-trip Test"
    assert data["scope"] == "private"
    assert data["updated"] is not None


def test_body_sha256_matches():
    """body_sha256 stored in Postgres must equal sha256(original body)."""
    from lore import db
    conn = db.connect()
    row = conn.execute(
        "select body_sha256 from notes where id=%s", (_SOURCE_ID,)
    ).fetchone()
    assert row is not None, "Note row not found"
    expected = hashlib.sha256(_BODY.encode()).hexdigest()
    assert row[0] == expected, f"body_sha256 mismatch: got {row[0]}, want {expected}"


def test_notes_404_for_missing():
    """GET /notes/<nonexistent> must return 404."""
    r = client.get("/notes/definitely-does-not-exist-xyz")
    assert r.status_code == 404
