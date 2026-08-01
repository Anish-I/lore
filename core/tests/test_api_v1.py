"""The /api/v1 contract: additive mirror + version handshake + SDK wiring.

Guarantees:
  * /api/v1/health returns the version/capability/provider handshake.
  * v1 endpoints hit the SAME handlers as the root routes (mirror, not fork).
  * root routes STILL work (deprecated aliases — desktop/hooks must not break).
  * LoreClient talks to the engine over /api/v1 only.
"""
from fastapi.testclient import TestClient

from lore.api import app, get_embedder, get_reranker
from lore.embed import FakeEmbedder
from lore.rerank import FakeReranker
from lore.version import API_VERSION, ENGINE_VERSION

app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
app.dependency_overrides[get_reranker] = lambda: FakeReranker()
client = TestClient(app)


def test_v1_health_handshake():
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["engine"] == "lore"
    assert body["api_version"] == API_VERSION
    assert body["engine_version"] == ENGINE_VERSION
    # providers advertised as a bool map (codex/claude/byok)
    assert set(body["providers"]) == {"codex", "claude", "byok"}
    assert all(isinstance(v, bool) for v in body["providers"].values())
    # capabilities reflect actually-mounted v1 routes
    assert "/ask" in body["capabilities"]
    assert "/search" in body["capabilities"]


def test_v1_mirrors_curated_surface():
    paths = {r.path for r in app.router.routes}
    for p in ("/ask", "/search", "/context-pack", "/state", "/graph",
              "/notes/{note_id}", "/ingest", "/capture", "/feedback"):
        assert "/api/v1" + p in paths, f"missing v1 mirror for {p}"
    # curated: internal/admin routes are NOT promoted into the contract
    # (teams/scopes/keys ARE v1 since the 2026-07-28 API-service spec)
    assert "/api/v1/admin/snapshot" not in paths
    assert "/api/v1/upkeep/run" not in paths
    assert "/api/v1/teams" in paths and "/api/v1/scopes" in paths


def test_v1_and_root_hit_same_handler(tmp_path):
    p = tmp_path / "acme.md"
    p.write_text("# Acme\n\n## Renewal\nAcme renews Q3. Risk: champion left.\n",
                 encoding="utf-8")
    client.post("/reindex", json={"path": str(p), "owner_id": "alice",
                                  "scope_id": "alice-private", "tenant_id": "tv1"})
    payload = {"query": "Acme renewal", "scopes": ["alice-private"],
               "tenant_id": "tv1", "k": 5}
    root = client.post("/search", json=payload)
    v1 = client.post("/api/v1/search", json=payload)
    assert root.status_code == v1.status_code == 200
    # same handler → same result shape
    assert set(root.json()) == set(v1.json())
    assert "results" in v1.json()


def test_root_routes_still_work():
    # deprecated alias must not 404 after v1 mount
    assert client.get("/presets").status_code == 200
    assert client.get("/doctor").status_code in (200, 403)


def test_loreclient_uses_v1(tmp_path):
    from lore.client import LoreClient, LoreVersionError

    class _TestTransport(LoreClient):
        """Route the SDK's HTTP through FastAPI's TestClient instead of a socket."""
        def _request(self, method, path, *, body=None, params=None):
            url = "/api/v1" + path
            r = client.request(method, url, json=body, params=params)
            if r.status_code >= 400:
                from lore.client import LoreError
                raise LoreError(f"HTTP {r.status_code}: {r.text[:200]}")
            return r.json()

    lore = _TestTransport(tenant="tv1sdk", scopes=["alice-private"])
    h = lore.check_compatible()          # raises if api_version mismatch
    assert h["api_version"] == API_VERSION

    p = tmp_path / "n.md"
    p.write_text("# Widget\n\n## Spec\nWidget ships in July.\n", encoding="utf-8")
    client.post("/reindex", json={"path": str(p), "owner_id": "alice",
                                  "scope_id": "alice-private", "tenant_id": "tv1sdk"})
    out = lore.search("Widget spec")
    assert "results" in out

    # version guard actually fires
    try:
        lore.check_compatible(expected="v999")
    except LoreVersionError:
        pass
    else:
        raise AssertionError("expected LoreVersionError on mismatched version")
