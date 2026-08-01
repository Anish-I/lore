"""API-key identity in the HTTP gate (2026-07-28 spec, Phase B)."""

from fastapi.testclient import TestClient

import lore.api as api

client = TestClient(api.app)


def _mk_key(role="member", user="u1", tenant="t-keys", label="test"):
    r = client.post("/api/v1/keys", json={
        "user_id": user, "label": label, "role": role, "tenant": tenant})
    assert r.status_code == 200, r.text
    return r.json()


def test_root_banner_is_json_not_ui():
    r = client.get("/")
    assert r.status_code == 200
    body = r.json()
    assert body["engine"] == "lore" and body["health"] == "/api/v1/health"


def test_local_mode_bootstrap_then_service_mode_gate(monkeypatch):
    admin = _mk_key(role="admin", user="alice")     # local mode: open bootstrap
    member = _mk_key(role="member", user="bob")

    monkeypatch.setenv("LORE_API_KEYS", "1")
    # bad key -> 401
    r = client.get("/api/v1/keys", headers={"Authorization": "Bearer lore_sk_bogus"})
    assert r.status_code == 401
    # member key -> 403 on key management
    r = client.get("/api/v1/keys",
                   headers={"Authorization": f"Bearer {member['key']}"})
    assert r.status_code == 403
    # admin key -> 200, sees both keys, no hashes
    r = client.get("/api/v1/keys",
                   headers={"Authorization": f"Bearer {admin['key']}"})
    assert r.status_code == 200
    keys = r.json()["keys"]
    assert {k["user_id"] for k in keys} >= {"alice", "bob"}
    assert all("key" not in k and "key_hash" not in k for k in keys)
    # unauthenticated creation now refused
    r = client.post("/api/v1/keys", json={"user_id": "eve", "role": "admin"})
    assert r.status_code == 401
    # revoke bob -> his key stops working
    bob_id = next(k["id"] for k in keys if k["user_id"] == "bob")
    r = client.delete(f"/api/v1/keys/{bob_id}",
                      headers={"Authorization": f"Bearer {admin['key']}"})
    assert r.status_code == 200
    r = client.get("/api/v1/keys",
                   headers={"Authorization": f"Bearer {member['key']}"})
    assert r.status_code == 401


def test_key_defaults_tenant_on_read_gate(monkeypatch):
    admin = _mk_key(role="admin", user="dana", tenant="t-dana")
    monkeypatch.setenv("LORE_API_KEYS", "1")
    # /notes read gate: with a key and NO tenant param the principal's tenant is
    # assumed -> authorized request reaches the store (404 unknown id, not 401/422).
    r = client.get("/api/v1/notes/nonexistent-note",
                   headers={"Authorization": f"Bearer {admin['key']}"})
    assert r.status_code == 404
    # without any identity the same call is refused
    r = client.get("/api/v1/notes/nonexistent-note")
    assert r.status_code == 401
