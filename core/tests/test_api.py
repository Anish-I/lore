from fastapi.testclient import TestClient
from lore.api import app, get_embedder, get_reranker
from lore.embed import FakeEmbedder
from lore.rerank import FakeReranker
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


def _ingest(source_id, title, text, tenant, scope="s1"):
    r = client.post("/ingest", json={
        "source_id": source_id, "title": title, "text": text,
        "scope": scope, "owner": "o1", "tenant": tenant})
    assert r.status_code == 200, r.text
    return r.json()


def test_ingest_auto_proposes_and_state_excludes_superseded():
    import uuid
    tenant = "t-state-" + uuid.uuid4().hex[:8]
    body_old = ("---\ncreated: 2025-01-01T00:00:00Z\n---\n# widget cadence\n\n"
                "the widget sync cadence is every ten minutes for the whole fleet today\n")
    body_new = ("---\ncreated: 2025-01-02T00:00:00Z\n---\n# widget cadence revision\n\n"
                "the widget sync cadence is every five minutes for the whole fleet today\n")
    _ingest("w-old", "widget cadence", body_old, tenant)
    _ingest("w-new", "widget cadence revision", body_new, tenant)

    # /ingest auto-proposed the supersession (LORE_AUTO_SUPERSEDE default on)
    r = client.get(f"/supersessions?tenant={tenant}")
    assert r.status_code == 200
    props = r.json()["proposals"]
    assert any(p["src"] == "w-new" and p["dst"] == "w-old" for p in props)

    # proposals do NOT affect /state yet — both notes present
    r = client.get(f"/state?tenant={tenant}&scopes=s1&budget=800")
    assert r.status_code == 200
    assert "widget cadence" in r.json()["block"]
    assert r.json()["count"] == 2

    # accept → old note drops out of /state
    r = client.post("/supersessions/resolve", json={
        "tenant": tenant, "src": "w-new", "dst": "w-old", "action": "accept"})
    assert r.status_code == 200 and r.json()["resolved"] is True
    r = client.get(f"/state?tenant={tenant}&scopes=s1&budget=800")
    data = r.json()
    assert data["count"] == 1
    assert "revision" in data["block"]
    assert data["tokens_est"] <= data["budget"]


def test_state_requires_tenant_and_scopes():
    assert client.get("/state").status_code == 422
    assert client.get("/state?tenant=t1").status_code == 422


def test_ingest_hook_populates_people():
    import uuid
    tenant = "t-people-" + uuid.uuid4().hex[:8]
    body = ("---\ncreated: 2025-03-01T00:00:00Z\n---\n# sync notes\n\n"
            "Dana Whitmore joined the weekly sync today. Dana Whitmore approved the "
            "final summary and Priya Natarajan <priya@example.com> took the notes.\n")
    _ingest("p-note-1", "sync notes", body, tenant)

    r = client.get(f"/people?tenant={tenant}&scopes=s1")
    assert r.status_code == 200
    names = {p["name"]: p for p in r.json()["people"]}
    assert "Dana Whitmore" in names
    assert names["Priya Natarajan"]["emails"] == ["priya@example.com"]

    detail = client.get(f"/people/detail?tenant={tenant}&scopes=s1"
                        f"&person_id={names['Dana Whitmore']['id']}").json()
    assert detail["interactions"][0]["note_id"] == "p-note-1"
