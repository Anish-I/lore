"""Audit log: /search and /ask record hashed entries; read + purge work; the
raw query text is never persisted."""
import os
import hashlib
from fastapi.testclient import TestClient

os.environ.setdefault("VAULT_FAKE", "1")
from lore.api import app  # noqa: E402

client = TestClient(app)
TENANT = "qlog-test"


def _seed():
    # Index one note so searches have something to (maybe) hit.
    client.post("/ingest", json={
        "source_id": "qlog-n1", "tenant": TENANT, "owner": "me",
        "scope": "engineering", "title": "Audit note",
        "text": "The quarterly audit covers retrieval logging and scopes.",
    })


def test_search_writes_a_hashed_audit_entry():
    _seed()
    q = "quarterly audit retrieval"
    r = client.post("/search", json={"query": q, "scopes": ["engineering"], "tenant_id": TENANT, "k": 3})
    assert r.status_code == 200

    log = client.get("/query-log", params={"tenant": TENANT}).json()["entries"]
    assert len(log) >= 1
    top = log[0]
    assert top["endpoint"] == "search"
    assert top["scopes"] == ["engineering"]
    # Query stored ONLY as a hash prefix — never the raw text.
    assert top["query_hash"] == hashlib.sha256(q.encode()).hexdigest()[:16]
    assert q not in str(log)


def test_purge_clears_the_trail():
    _seed()
    client.post("/search", json={"query": "anything", "scopes": ["engineering"], "tenant_id": TENANT, "k": 1})
    assert len(client.get("/query-log", params={"tenant": TENANT}).json()["entries"]) >= 1
    assert client.post("/query-log/purge", json={"tenant": TENANT}).json()["ok"] is True
    assert client.get("/query-log", params={"tenant": TENANT}).json()["entries"] == []


def test_no_tenant_returns_empty_never_cross_tenant():
    assert client.get("/query-log").json()["entries"] == []
