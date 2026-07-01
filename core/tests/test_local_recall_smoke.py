# core/tests/test_local_recall_smoke.py
"""Recall-parity smoke: index a note on SQLite + embedded Qdrant with Fake models,
then retrieve it via the real lore.recall pipeline (the local-store parity gate)."""
from lore import db
from lore.embed import FakeEmbedder
from lore.rerank import FakeReranker
from lore.index import index_document
from lore.recall import retrieve


def test_local_sqlite_index_and_recall(tmp_path, monkeypatch):
    monkeypatch.setenv("VAULT_FAKE", "1")
    # Note: lore.qdrant_store builds its client at module import, so the effective
    # vector store here is the one conftest.py selected (embedded Qdrant by default;
    # server under LORE_TEST_PG=1). These env pins document the intended lane.
    monkeypatch.setenv("QDRANT_PATH", str(tmp_path / "qdrant"))
    monkeypatch.delenv("QDRANT_URL", raising=False)
    url = f"sqlite:///{tmp_path/'lore.db'}"
    conn = db._connect_url(url)
    db.bootstrap_schema(conn)
    emb, rr = FakeEmbedder(), FakeReranker()
    index_document(
        source_id="n-falcon", title="Project Falcon",
        text="# Project Falcon\n\nThe Falcon launch checklist and rollout plan.\n",
        scope_id="private", owner_id="me", tenant_id="solo",
        embedder=emb, conn=conn, source_type="note",
    )
    hits = retrieve("falcon launch checklist", emb, rr, ["private"], "solo", limit=8)
    assert any("falcon" in h.text.lower() for h in hits)
    conn.close()
