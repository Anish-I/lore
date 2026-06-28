import os, tempfile, uuid, pytest
from lore import db
from lore.embed import FakeEmbedder
from lore.rerank import FakeReranker
from lore.index import index_note
from lore.recall import retrieve

@pytest.fixture(scope="module")
def conn():
    c = db.connect(); db.bootstrap_schema(c); return c

def _write(md):
    f = tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8")
    f.write(md); f.close(); return f.name

def test_index_then_recall_returns_cited_chunk(conn):
    path = _write("# Acme Account\n\n## Renewal\nAcme renews in Q3. Risk: the champion left the company.\n")
    n = index_note(path, FakeEmbedder(), conn, "alice", "alice-private", "t1")
    assert n >= 1
    hits = retrieve("Acme renewal champion risk", FakeEmbedder(), FakeReranker(),
                    allowed_scope_ids=["alice-private"], tenant_id="t1")
    assert hits and hits[0].note_id
    assert any("champion" in h.text for h in hits)

def test_acl_excludes_other_scope(conn):
    path = _write("# Secret\n\n## Bonus\nBob bonus is 50k.\n")
    index_note(path, FakeEmbedder(), conn, "bob", "bob-private", "t1")
    hits = retrieve("Bob bonus", FakeEmbedder(), FakeReranker(),
                    allowed_scope_ids=["alice-private"], tenant_id="t1")
    assert all("bonus" not in h.text.lower() for h in hits)

def test_reindex_removes_stale_chunks(conn):
    """C1: re-indexing the same note must purge old Qdrant points for removed sections."""
    # Write a note with two distinct sections
    f = tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8")
    f.write("# Stale Test\n\n## Alpha\nAlpha unique content here.\n\n## Beta\nBeta stale content remove.\n")
    f.close()
    path = f.name
    # Use a unique scope/tenant per run to prevent cross-run contamination
    run_id = uuid.uuid4().hex[:8]
    tenant = f"t-c1-{run_id}"
    scope = f"scope-c1-{run_id}"

    # First index: both Alpha and Beta sections present
    n1 = index_note(path, FakeEmbedder(), conn, "owner-c1", scope, tenant)
    assert n1 >= 2, f"Expected >=2 chunks for two sections, got {n1}"

    # Confirm Beta is retrievable before re-index
    hits_before = retrieve("Beta stale content", FakeEmbedder(), FakeReranker(),
                           allowed_scope_ids=[scope], tenant_id=tenant)
    assert any("Beta" in h.text for h in hits_before), "Beta should be present before re-index"

    # Re-index the same path with Beta section removed
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("# Stale Test\n\n## Alpha\nAlpha unique content here.\n")

    n2 = index_note(path, FakeEmbedder(), conn, "owner-c1", scope, tenant)
    assert n2 >= 1

    # Beta must no longer appear in recall results
    hits_after = retrieve("Beta stale content", FakeEmbedder(), FakeReranker(),
                          allowed_scope_ids=[scope], tenant_id=tenant)
    assert all("Beta" not in h.text for h in hits_after), \
        f"Stale Beta chunk still returned after re-index: {[h.text for h in hits_after]}"

    os.unlink(path)
