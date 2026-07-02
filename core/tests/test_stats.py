"""Tests for GET /stats — cheap per-tenant counts consumed by the desktop app's
boot-time disk<->index reconcile (M1 Task R): the app compares this against an
on-disk note count to detect a stale index (e.g. after a store swap) and trigger
a background re-scrape."""
from fastapi.testclient import TestClient
from lore.api import app, get_embedder, get_reranker
from lore.embed import FakeEmbedder
from lore.rerank import FakeReranker

app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
app.dependency_overrides[get_reranker] = lambda: FakeReranker()
client = TestClient(app)


def test_stats_counts_notes_chunks_edges():
    tenant = "stats-test-tenant"
    client.post("/ingest", json={
        "source_id": "stats-note-1",
        "title": "Stats Note One",
        "text": "# Stats Note One\n\nFirst note for stats counting.\n",
        "scope": "alice-private",
        "owner": "alice",
        "tenant": tenant,
    })
    client.post("/ingest", json={
        "source_id": "stats-note-2",
        "title": "Stats Note Two",
        "text": "# Stats Note Two\n\nSee [[Stats Note One]] for context.\n",
        "scope": "alice-private",
        "owner": "alice",
        "tenant": tenant,
    })

    r = client.get("/stats", params={"tenant": tenant})
    assert r.status_code == 200
    body = r.json()
    assert body["notes"] == 2
    assert body["chunks"] >= 2
    assert body["edges"] >= 1  # wikilink from note 2 to note 1


def test_stats_does_not_leak_across_tenants():
    """A second tenant's notes must not be counted against the first tenant's stats."""
    client.post("/ingest", json={
        "source_id": "stats-other-tenant-note",
        "title": "Other Tenant Note",
        "text": "# Other Tenant Note\n\nBelongs to a different tenant.\n",
        "scope": "bob-private",
        "owner": "bob",
        "tenant": "stats-other-tenant",
    })
    r = client.get("/stats", params={"tenant": "stats-test-tenant"})
    assert r.status_code == 200
    # Still exactly the 2 notes indexed for stats-test-tenant above, not 3.
    assert r.json()["notes"] == 2


def test_stats_unknown_tenant_returns_zero():
    r = client.get("/stats", params={"tenant": "no-such-tenant-xyz"})
    assert r.status_code == 200
    assert r.json() == {"notes": 0, "chunks": 0, "edges": 0}


def test_stats_missing_tenant_returns_zero():
    """No tenant assumed when omitted — mirrors /graph's behavior (never leaks
    cross-tenant counts to a caller that forgot to pass one)."""
    r = client.get("/stats")
    assert r.status_code == 200
    assert r.json() == {"notes": 0, "chunks": 0, "edges": 0}
