"""Loop closures (2026-07-28 addendum): admin relaxation, observations body,
invite accept, sections + wizards v1 surface."""
from fastapi.testclient import TestClient

import lore.api as api

client = TestClient(api.app)
TENANT = "t-loops"


def _key(user, role="member", email=None):
    body = {"user_id": user, "label": user, "role": role, "tenant": TENANT}
    if email:
        body["email"] = email
    r = client.post("/api/v1/keys", json=body)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['key']}"}


def test_doctor_admin_key_only_in_service_mode(monkeypatch):
    admin = _key("lp-admin", role="admin")
    member = _key("lp-member")
    monkeypatch.setenv("LORE_API_KEYS", "1")
    assert client.get("/doctor", headers=member).status_code == 403
    assert client.get("/doctor", headers=admin).status_code == 200


def test_observations_body_variant(monkeypatch):
    monkeypatch.setenv("LORE_API_KEYS", "0")
    transcript = {"messages": [
        {"role": "user", "content": "fix the bug in scoring.py"},
        {"role": "assistant", "content": [
            {"type": "tool_use", "name": "Edit",
             "input": {"file_path": "/tmp/scoring.py"}}]},
    ]}
    r = client.post("/observations/extract", json={
        "tenant": TENANT, "session_id": "lp-sess-1", "transcript": transcript})
    assert r.status_code == 200, r.text
    r = client.post("/observations/extract", json={
        "tenant": TENANT, "session_id": "lp-sess-2"})
    assert r.status_code == 422        # neither variant supplied


def test_invite_accept_with_email_on_key(monkeypatch):
    owner = _key("lp-owner", role="admin")
    joiner = _key("lp-joiner", email="joiner@example.com")
    monkeypatch.setenv("LORE_API_KEYS", "1")
    team = client.post("/api/v1/teams", json={"name": "Loop Team"},
                       headers=owner).json()
    inv = client.post(f"/api/v1/teams/{team['team_id']}/invites",
                      json={"email": "joiner@example.com"}, headers=owner).json()
    r = client.post(f"/api/v1/invites/{inv['invite_id']}/accept", headers=joiner)
    assert r.status_code == 200, r.text
    # wrong addressee cannot claim it
    thief = _key_service("lp-thief")
    r = client.post(f"/api/v1/invites/{inv['invite_id']}/accept", headers=thief)
    assert r.status_code in (403, 422)


def _key_service(user):
    """Create a key while service mode is on (needs an admin key)."""
    import os
    os.environ["LORE_API_KEYS"] = "0"
    try:
        return _key(user)
    finally:
        os.environ["LORE_API_KEYS"] = "1"


def test_sections_and_wizards_surface(monkeypatch):
    key = _key("lp-wiz")
    monkeypatch.setenv("LORE_API_KEYS", "1")
    r = client.get("/api/v1/sections", headers=key)
    assert r.status_code == 200 and "sections" in r.json()
    assert client.post("/api/v1/sections/nope/apply",
                       headers=key).status_code == 404
    r = client.get("/api/v1/wizards", headers=key)
    assert r.status_code == 200 and "wizards" in r.json()
    assert client.get("/api/v1/wizards/nope", headers=key).status_code == 404
