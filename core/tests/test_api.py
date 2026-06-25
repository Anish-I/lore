from fastapi.testclient import TestClient
from vault.api import app, get_embedder, get_reranker
from vault.embed import FakeEmbedder
from vault.rerank import FakeReranker
app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
app.dependency_overrides[get_reranker] = lambda: FakeReranker()
client = TestClient(app)

def test_ask_returns_citations(tmp_path):
    p = tmp_path / "acme.md"
    p.write_text("# Acme\n\n## Renewal\nAcme renews Q3. Risk: champion left.\n", encoding="utf-8")
    client.post("/reindex", json={"path": str(p), "owner_id":"alice","scope_id":"alice-private","tenant_id":"t1"})
    r = client.post("/ask", json={"question":"Acme renewal risk","principal_scopes":["alice-private"],"tenant_id":"t1"})
    assert r.status_code == 200
    body = r.json()
    assert body["citations"] and body["citations"][0]["note_id"]
