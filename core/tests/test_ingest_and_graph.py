"""Integration tests for POST /ingest and GET /graph.

Requires:
  - VAULT_FAKE=1 (set by conftest.py) — uses FakeEmbedder so no Qdrant models load.
  - Live Postgres at DATABASE_URL.
  - Live Qdrant at QDRANT_URL (for /ingest which calls qdrant_store.upsert).

Tests that only touch the Postgres graph layer (/graph, edge queries) do not
require Qdrant beyond the collection-check in ensure_collection.
"""
from fastapi.testclient import TestClient
from lore.api import app, get_embedder, get_reranker
from lore.embed import FakeEmbedder
from lore.rerank import FakeReranker

app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
app.dependency_overrides[get_reranker] = lambda: FakeReranker()
client = TestClient(app)


def test_ingest_returns_ok():
    r = client.post("/ingest", json={
        "source_id": "ingest-test-001",
        "title": "First Ingest Note",
        "text": "# First Ingest Note\n\nThis is test content for ingest.\n",
        "scope": "alice-private",
        "owner": "alice",
        "tenant": "t1",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["note_id"] == "ingest-test-001"
    assert body["chunks"] >= 1


def test_ingest_update_refreshes_scope_and_owner():
    """Re-indexing the same source_id must update scope/owner, not duplicate the row."""
    base = {
        "source_id": "ingest-test-002",
        "title": "Updatable Note",
        "text": "# Updatable\n\nOriginal content.\n",
        "scope": "alice-private",
        "owner": "alice",
        "tenant": "t1",
    }
    r1 = client.post("/ingest", json=base)
    assert r1.status_code == 200

    # Re-ingest same source_id with a different scope and owner.
    r2 = client.post("/ingest", json={**base, "scope": "eng-team", "owner": "bob"})
    assert r2.status_code == 200

    # Confirm Postgres has exactly one row with the updated values.
    from lore import db
    conn = db.connect()
    rows = conn.execute(
        "select scope_id, owner_id from notes where id=%s",
        ("ingest-test-002",),
    ).fetchall()
    assert len(rows) == 1, f"Expected 1 note row, got {len(rows)}"
    assert rows[0][0] == "eng-team", "scope_id not updated"
    assert rows[0][1] == "bob", "owner_id not updated"


def test_graph_response_shape():
    """GET /graph must return the documented {nodes, edges} shape."""
    r = client.get("/graph")
    assert r.status_code == 200
    body = r.json()
    assert "nodes" in body
    assert "edges" in body
    # Validate node field set if any nodes present.
    for node in body["nodes"]:
        assert all(k in node for k in ("id", "label", "scope", "owner", "links", "updated")), \
            f"Node missing required fields: {node}"
    # Each edge must be at least [src, dst, kind] with an optional weight as 4th element.
    from lore.relations import RELATION_KINDS
    allowed_kinds = ("link", "folder", "tag", "topic") + RELATION_KINDS
    for edge in body["edges"]:
        assert len(edge) >= 3, f"Edge must be [src, dst, kind, ...], got: {edge}"
        assert edge[2] in allowed_kinds, f"Unexpected edge kind: {edge[2]}"


def test_graph_edge_acl_drop():
    """An edge must not appear in /graph when one of its endpoints is out-of-scope.

    We index two notes in the same tenant under different scopes.  The private note
    links to the team note.  Querying with only the private scope must:
      - return the private node
      - NOT return the team node
      - NOT return the link edge (its dst is out of scope)
    """
    # Index target note (team scope).
    client.post("/ingest", json={
        "source_id": "acl-node-team",
        "title": "Team Note ACL",
        "text": "# Team Note ACL\n\nTeam-visible content.\n",
        "scope": "eng-team",
        "owner": "alice",
        "tenant": "acl-test-tenant",
    })
    # Index source note (private scope) with wikilink to the team note.
    client.post("/ingest", json={
        "source_id": "acl-node-private",
        "title": "Private Note ACL",
        "text": "# Private Note ACL\n\nSee [[Team Note ACL]] for context.\n",
        "scope": "alice-private",
        "owner": "alice",
        "tenant": "acl-test-tenant",
    })

    # Query with only alice-private scope — team note must be excluded.
    r = client.get("/graph", params={"tenant": "acl-test-tenant", "scopes": "alice-private"})
    assert r.status_code == 200
    body = r.json()

    node_ids = {n["id"] for n in body["nodes"]}
    assert "acl-node-private" in node_ids, "Private node should be visible"
    assert "acl-node-team" not in node_ids, "Team node must be hidden (out of scope)"

    # No edge should reference the out-of-scope node.
    for edge in body["edges"]:
        assert "acl-node-team" not in edge, \
            f"Edge references out-of-scope node: {edge}"


def test_wikilink_produces_link_edge():
    """Indexing a note with [[Target]] must create a 'link' edge to the target note
    when the target already exists in Postgres under the same tenant."""
    from lore import db

    # Index the target note first.
    client.post("/ingest", json={
        "source_id": "wikilink-target",
        "title": "Wiki Target Note",
        "text": "# Wiki Target Note\n\nI am the link target.\n",
        "scope": "eng-team",
        "owner": "alice",
        "tenant": "wikilink-tenant",
    })

    # Index a source note that wikilinks to the target.
    client.post("/ingest", json={
        "source_id": "wikilink-source",
        "title": "Wiki Source Note",
        "text": "# Wiki Source Note\n\nSee [[Wiki Target Note]] for details.\n",
        "scope": "eng-team",
        "owner": "alice",
        "tenant": "wikilink-tenant",
    })

    conn = db.connect()
    row = conn.execute(
        """select kind from edges
           where tenant_id=%s and src_note_id=%s and dst_note_id=%s""",
        ("wikilink-tenant", "wikilink-source", "wikilink-target"),
    ).fetchone()

    assert row is not None, (
        "Expected a 'link' edge from wikilink-source to wikilink-target, "
        "but none was found in the edges table."
    )
    assert row[0] == "link"
