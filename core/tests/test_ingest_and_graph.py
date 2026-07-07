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


# ---------------------------------------------------------------------------
# M1-C: edge provenance in /graph + note edges + Ask conflict surfacing
# ---------------------------------------------------------------------------

def _ingest_origin_pair(tenant):
    """Two linked notes with realistic bodies (too-short bodies produce zero
    chunks and the no-chunk path creates no edges)."""
    client.post("/ingest", json={
        "source_id": "origin-b", "title": "Origin Target",
        "text": "# Origin Target\n\nI am the origin target note with enough body text to chunk properly.\n",
        "scope": "eng-team", "owner": "alice", "tenant": tenant,
    })
    client.post("/ingest", json={
        "source_id": "origin-a", "title": "Origin Source",
        "text": "# Origin Source\n\nSee [[Origin Target]] for the full details of this decision record.\n",
        "scope": "eng-team", "owner": "alice", "tenant": tenant,
    })


def test_graph_edges_are_five_tuples_with_origin():
    tenant = "origin-tenant"
    _ingest_origin_pair(tenant)
    r = client.get("/graph", params={"tenant": tenant, "scopes": "eng-team"})
    assert r.status_code == 200
    edges = r.json()["edges"]
    assert edges, "expected at least the wikilink edge"
    for e in edges:
        assert len(e) == 5, f"edge is not a 5-tuple: {e}"
        assert e[4] in ("index", "capture", "llm"), f"bad origin: {e[4]}"


def test_note_detail_includes_typed_edges_with_provenance():
    tenant = "origin-tenant"
    _ingest_origin_pair(tenant)
    r = client.get("/notes/origin-a", params={"tenant": tenant, "scopes": "eng-team"})
    assert r.status_code == 200
    body = r.json()
    assert "edges" in body
    out = body["edges"]["out"]
    assert any(e["other_id"] == "origin-b" and e["kind"] == "link" and e["origin"] == "index"
               for e in out), f"missing provenanced link edge: {out}"


def test_note_detail_edges_respect_acl():
    tenant = "origin-tenant"
    _ingest_origin_pair(tenant)
    # Target moved out of the caller's scopes -> its edge must disappear.
    client.post("/ingest", json={
        "source_id": "origin-b", "title": "Origin Target",
        "text": "# Origin Target\n\nI am the origin target note with enough body text to chunk properly.\n",
        "scope": "hidden-scope", "owner": "alice", "tenant": tenant,
    })
    r = client.get("/notes/origin-a", params={"tenant": tenant, "scopes": "eng-team"})
    assert r.status_code == 200
    out = r.json()["edges"]["out"]
    assert not any(e["other_id"] == "origin-b" for e in out), "ACL leak: hidden note in edges"


def test_ask_surfaces_contradiction_conflicts():
    from lore import db
    tenant = "conflict-tenant"
    client.post("/ingest", json={
        "source_id": "cfl-b", "title": "Rate Policy Old",
        "text": "# Rate Policy Old\n\nThe LORE-9911 limit is five percent according to the original policy document.\n",
        "scope": "eng-team", "owner": "alice", "tenant": tenant,
    })
    client.post("/ingest", json={
        "source_id": "cfl-a", "title": "Rate Policy New",
        "text": "# Rate Policy New\n\nAbout LORE-9911: this contradicts [[Rate Policy Old]] because the limit is now nine percent.\n",
        "scope": "eng-team", "owner": "alice", "tenant": tenant,
    })
    conn = db.connect()
    edge = conn.execute(
        "select kind, origin from edges where tenant_id=%s and src_note_id=%s and kind=%s",
        (tenant, "cfl-a", "contradicts")).fetchone()
    assert edge is not None, "contradicts cue did not produce an edge"

    r = client.post("/ask", json={
        "question": "What is the LORE-9911 limit?",
        "principal_scopes": ["eng-team"],
        "tenant_id": tenant,
    })
    assert r.status_code == 200
    body = r.json()
    assert "conflicts" in body
    cited = {c["note_id"] for c in body["citations"]}
    if "cfl-a" in cited or "cfl-b" in cited:
        pairs = {(c["a_id"], c["b_id"]) for c in body["conflicts"]}
        assert any({"cfl-a", "cfl-b"} == {a, b} for a, b in pairs), (
            f"conflict pair not surfaced: {body['conflicts']} (cited={cited})")
