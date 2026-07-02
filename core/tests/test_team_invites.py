"""E2E: login → create a team ("base") → invite by email → invitee accepts → scoped access.

Google's network verification is bypassed by issuing session JWTs directly (same
code path /auth/google ends in); everything after login runs the real API.
"""
import os

os.environ.setdefault("LORE_JWT_SECRET", "test-secret-please-do-not-use-in-production-0123456789")

from fastapi.testclient import TestClient

from lore import auth, db, tenancy
from lore.api import app

client = TestClient(app)


def _login(sub: str, email: str, name: str) -> dict:
    """Simulate a completed Google login: upsert the user + mint a session JWT."""
    conn = db.connect()
    db.bootstrap_schema(conn)
    tenancy.bootstrap_tenancy(conn)
    user_id = auth.upsert_user(conn, sub, email, name)
    token = auth.issue_session_jwt(user_id)
    return {"user_id": user_id, "headers": {"Authorization": f"Bearer {token}"}}


def test_invite_accept_grants_scope_and_wrong_email_cannot_hijack():
    owner = _login("sub-owner-1", "anish@example.com", "Anish")
    friend = _login("sub-friend-1", "friend@example.com", "Friend")
    mallory = _login("sub-mallory-1", "mallory@example.com", "Mallory")

    # Owner creates the base.
    r = client.post("/teams", json={"name": "Anish's Base"}, headers=owner["headers"])
    assert r.status_code == 200, r.text
    team = r.json()
    assert team["scope"].startswith("team:")

    # Owner sees the new scope immediately; friend does not.
    assert team["scope"] in client.get("/auth/me", headers=owner["headers"]).json()["scopes"]
    assert team["scope"] not in client.get("/auth/me", headers=friend["headers"]).json()["scopes"]

    # Owner invites friend by email (case-insensitive), idempotently.
    r = client.post(f"/teams/{team['team_id']}/invites",
                    json={"email": "Friend@Example.com"}, headers=owner["headers"])
    assert r.status_code == 200, r.text
    invite = r.json()
    again = client.post(f"/teams/{team['team_id']}/invites",
                        json={"email": "friend@example.com"}, headers=owner["headers"]).json()
    assert again["invite_id"] == invite["invite_id"], "re-invite must not mint a second invite"

    # A non-member cannot invite anyone.
    r = client.post(f"/teams/{team['team_id']}/invites",
                    json={"email": "x@example.com"}, headers=mallory["headers"])
    assert r.status_code == 403

    # Friend logs in and finds the pending invite addressed to their email.
    pending = client.get("/invites", headers=friend["headers"]).json()["invites"]
    assert any(i["invite_id"] == invite["invite_id"] for i in pending)
    # Mallory sees nothing…
    assert client.get("/invites", headers=mallory["headers"]).json()["invites"] == []
    # …and cannot accept friend's invite even knowing its id.
    r = client.post(f"/invites/{invite['invite_id']}/accept", headers=mallory["headers"])
    assert r.status_code == 403

    # Friend accepts → active membership, scope appears in /auth/me.
    r = client.post(f"/invites/{invite['invite_id']}/accept", headers=friend["headers"])
    assert r.status_code == 200, r.text
    assert r.json()["scope"] == team["scope"]
    assert team["scope"] in client.get("/auth/me", headers=friend["headers"]).json()["scopes"]

    # Second accept is rejected (invite closed), membership unaffected.
    r = client.post(f"/invites/{invite['invite_id']}/accept", headers=friend["headers"])
    assert r.status_code == 403
    assert team["scope"] in client.get("/auth/me", headers=friend["headers"]).json()["scopes"]

    # Server-side authorization agrees (the leak-proof gate reads memberships).
    conn = db.connect()
    assert tenancy.authorize_scopes(conn, friend["user_id"], [team["scope"]]) == [team["scope"]]
    assert tenancy.authorize_scopes(conn, mallory["user_id"], [team["scope"]]) == []
