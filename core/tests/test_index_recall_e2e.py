import os, tempfile, pytest
from vault import db
from vault.embed import FakeEmbedder
from vault.rerank import FakeReranker
from vault.index import index_note
from vault.recall import retrieve

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
