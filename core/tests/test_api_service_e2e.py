"""Three-personas acceptance (2026-07-28 spec): alice shares, bob reads, mallory sees nothing."""
from fastapi.testclient import TestClient

import lore.api as api

client = TestClient(api.app)
TENANT = "t-e2e"


def _key(user, role="member"):
    r = client.post("/api/v1/keys", json={
        "user_id": user, "label": user, "role": role, "tenant": TENANT})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['key']}"}


def test_three_personas_scope_sharing(monkeypatch):
    alice = _key("e2e-alice", role="admin")     # local-mode bootstrap
    bob = _key("e2e-bob")
    mallory = _key("e2e-mallory")
    monkeypatch.setenv("LORE_API_KEYS", "1")

    # alice creates a named scope and ingests a case file into it
    r = client.post("/api/v1/scopes", json={"name": "Case Files"}, headers=alice)
    assert r.status_code == 200, r.text
    sid = r.json()["scope_id"]
    r = client.post("/api/v1/ingest", json={
        "source_id": "e2e-case-1", "title": "Thompson claim memo",
        "text": "Settlement drafted for the Thompson liability claim.",
        "scope": sid}, headers=alice)
    assert r.status_code == 200, r.text

    # bob can't see it before the grant; a forged scope request widens nothing
    r = client.get(f"/api/v1/notes/e2e-case-1?scopes={sid}", headers=bob)
    assert r.status_code in (403, 404)
    # bob can't write into alice's scope even after a READ grant
    r = client.post(f"/api/v1/scopes/{sid}/grants",
                    json={"user_id": "e2e-bob", "role": "read"}, headers=alice)
    assert r.status_code == 200, r.text
    r = client.get(f"/api/v1/notes/e2e-case-1?scopes={sid}", headers=bob)
    assert r.status_code == 200 and "Thompson" in r.json()["body"]
    assert any(s["scope_id"] == sid for s in
               client.get("/api/v1/scopes", headers=bob).json()["scopes"])
    r = client.post("/api/v1/ingest", json={
        "source_id": "e2e-bob-write", "title": "x", "text": "y",
        "scope": sid}, headers=bob)
    assert r.status_code == 403

    # mallory: no grant -> invisible; grant attempt on foreign scope -> 403
    r = client.get(f"/api/v1/notes/e2e-case-1?scopes={sid}", headers=mallory)
    assert r.status_code in (403, 404)
    r = client.post(f"/api/v1/scopes/{sid}/grants",
                    json={"user_id": "e2e-mallory", "role": "write"}, headers=mallory)
    assert r.status_code == 403

    # revoke bob -> access disappears
    r = client.delete(f"/api/v1/scopes/{sid}/grants/e2e-bob", headers=alice)
    assert r.status_code == 200
    r = client.get(f"/api/v1/notes/e2e-case-1?scopes={sid}", headers=bob)
    assert r.status_code in (403, 404)


def test_teams_surface_over_existing_tenancy(monkeypatch):
    alice = _key("e2e-tm-alice", role="admin")
    monkeypatch.setenv("LORE_API_KEYS", "1")
    r = client.post("/api/v1/teams", json={"name": "Clerk Office"}, headers=alice)
    assert r.status_code == 200, r.text
    team_id = r.json()["team_id"]
    r = client.post(f"/api/v1/teams/{team_id}/invites",
                    json={"email": "deputy@ellington-ct.gov"}, headers=alice)
    assert r.status_code == 200, r.text
    assert r.json().get("email") == "deputy@ellington-ct.gov"
