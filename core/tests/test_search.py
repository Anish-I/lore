"""Tests for POST /search — shape and ACL filtering."""
from fastapi.testclient import TestClient
from lore.api import app, get_embedder, get_reranker
from lore.embed import FakeEmbedder
from lore.rerank import FakeReranker

app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
app.dependency_overrides[get_reranker] = lambda: FakeReranker()
client = TestClient(app)

_TENANT = "search-test-tenant"


def _ingest(source_id, title, text, scope):
    r = client.post("/ingest", json={
        "source_id": source_id,
        "title": title,
        "text": text,
        "scope": scope,
        "owner": "alice",
        "tenant": _TENANT,
    })
    assert r.status_code == 200, r.text


def test_search_returns_results_shape():
    """POST /search must return {results:[...]} with required fields on each hit."""
    _ingest("search-note-001", "Qdrant Vector DB", "# Qdrant\n\nQdrant is a vector database.\n", "private")

    r = client.post("/search", json={
        "query": "vector database",
        "scopes": ["private"],
        "tenant_id": _TENANT,
        "k": 5,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert "results" in body
    # Shape check on each hit.
    for hit in body["results"]:
        assert "note_id" in hit
        assert "heading_path" in hit
        assert "text" in hit
        assert "score" in hit
        assert isinstance(hit["score"], float)


def test_search_scope_filters_out_of_scope_notes():
    """Notes in a scope not listed in the request must not appear in results."""
    _ingest("search-scope-secret", "Secret Pricing Note", "# Secret\n\nConfidential pricing data.\n", "admin-only")
    _ingest("search-scope-public", "Public Overview", "# Overview\n\nPublic information about pricing.\n", "private")

    r = client.post("/search", json={
        "query": "pricing",
        "scopes": ["private"],
        "tenant_id": _TENANT,
        "k": 10,
    })
    assert r.status_code == 200, r.text
    returned_ids = {h["note_id"] for h in r.json().get("results", [])}
    assert "search-scope-secret" not in returned_ids, \
        "Out-of-scope note must not appear in search results"


def test_search_empty_query_returns_no_crash():
    """An unusual query should not crash the endpoint (may return empty results)."""
    r = client.post("/search", json={
        "query": "xyzzy_nonexistent_term_abc123",
        "scopes": ["private"],
        "tenant_id": _TENANT,
    })
    assert r.status_code == 200
    assert "results" in r.json()
