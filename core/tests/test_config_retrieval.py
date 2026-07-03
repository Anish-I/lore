"""Tests for GET /config/retrieval — the truthful retrieval-stack snapshot consumed by
the desktop app's Settings "Indexing & recall" section (replaces hardcoded
'not configured' badges with the actual resolved embedder/reranker state)."""
from fastapi.testclient import TestClient
from lore.api import app

client = TestClient(app)


def test_config_retrieval_shape():
    r = client.get("/config/retrieval")
    assert r.status_code == 200
    body = r.json()
    for key in ("embeddingModel", "reranker", "contextualRetrieval", "localFallback"):
        assert key in body
    assert {"provider", "model"} <= set(body["embeddingModel"])
    assert {"provider", "model"} <= set(body["reranker"])
    assert {"enabled", "mode"} <= set(body["contextualRetrieval"])
    assert {"available", "active"} <= set(body["localFallback"])


def test_config_retrieval_reports_fake_lane_under_vault_fake():
    # conftest forces VAULT_FAKE=1 for the whole suite, so the endpoint must
    # report the fake models — never claim voyage/local models it isn't using.
    body = client.get("/config/retrieval").json()
    assert body["embeddingModel"]["provider"] == "fake"
    assert body["reranker"]["provider"] == "fake"
    # Fake lane never counts as the active local path.
    assert body["localFallback"]["active"] is False


def test_config_retrieval_contextual_always_enabled():
    # apply_context() runs unconditionally in index.py — the endpoint reflects that.
    body = client.get("/config/retrieval").json()
    assert body["contextualRetrieval"]["enabled"] is True
    assert body["contextualRetrieval"]["mode"] == "metadata"


def test_config_retrieval_accepts_tenant_param():
    r = client.get("/config/retrieval", params={"tenant": "any-tenant"})
    assert r.status_code == 200
    assert "embeddingModel" in r.json()
