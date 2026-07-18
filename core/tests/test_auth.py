"""Tests for Google-OAuth server-side verification + Lore session JWTs.

Google ID-token verification hits Google's network/keys, so we monkeypatch it;
everything else (JWT issue/verify, user upsert, scope resolution, login wiring)
is exercised for real against Postgres.
"""
import os

# Deterministic signing secret for the suite (>=32 bytes, before lore.auth reads it).
os.environ.setdefault("LORE_JWT_SECRET", "test-secret-please-do-not-use-in-production-0123456789")

import pytest
from lore import db, auth, tenancy, okta


def test_jwt_roundtrip_and_rejection():
    tok = auth.issue_session_jwt("user-abc")
    claims = auth.verify_session_jwt(tok)
    assert claims["sub"] == "user-abc"
    assert claims["iss"] == "lore"

    # Tampered token is rejected.
    with pytest.raises(auth.AuthError):
        auth.verify_session_jwt(tok + "x")

    # Expired token is rejected.
    expired = auth.issue_session_jwt("user-abc", ttl=-10)
    with pytest.raises(auth.AuthError):
        auth.verify_session_jwt(expired)


@pytest.mark.skipif(
    not os.path.exists(os.environ.get("GOOGLE_OAUTH_CLIENT_FILE") or auth._DEFAULT_CLIENT_FILE),
    reason="gitignored secrets/google_oauth_client.json not present on this machine",
)
def test_load_google_client_exposes_client_id():
    # The gitignored secrets/google_oauth_client.json must load and expose a client_id.
    cid = auth.google_client_id()
    assert cid and cid.endswith(".apps.googleusercontent.com")


def test_upsert_user_is_idempotent():
    conn = db.connect()
    db.bootstrap_schema(conn)
    tenancy.bootstrap_tenancy(conn)
    uid = auth.upsert_user(conn, "sub-123", "a@example.com", "Alice")
    assert uid == "sub-123"
    # second upsert updates name without creating a duplicate row
    auth.upsert_user(conn, "sub-123", "a@example.com", "Alice Renamed")
    rows = conn.execute("select email, name from users where id='sub-123'").fetchall()
    assert len(rows) == 1
    assert rows[0][1] == "Alice Renamed"


def test_login_with_google_verifies_issues_jwt_and_resolves_scopes(monkeypatch):
    conn = db.connect()
    db.bootstrap_schema(conn)
    tenancy.bootstrap_tenancy(conn)

    # Seed an org/team and make this user a member of team t-eng.
    conn.execute("insert into orgs(id,name) values('o-acme','Acme') on conflict do nothing")
    conn.execute("insert into teams(id,org_id,name) values('t-eng','o-acme','Eng') on conflict do nothing")
    conn.execute("insert into memberships(user_id,org_id,team_id,role,status) "
                 "values('sub-eng','o-acme','t-eng','member','active') "
                 "on conflict (user_id,team_id) do update set status='active'")

    # Pretend Google verified this identity (no network in tests).
    monkeypatch.setattr(auth, "verify_google_id_token",
                        lambda token, client_id=None: {
                            "sub": "sub-eng", "email": "eng@acme.com",
                            "name": "Eng User", "email_verified": True})

    result = auth.login_with_google(conn, "fake-google-id-token")
    assert result["user_id"] == "sub-eng"
    assert result["email"] == "eng@acme.com"
    assert result["scopes"] == ["team:t-eng"]

    # The issued session JWT verifies back to the same user.
    claims = auth.verify_session_jwt(result["token"])
    assert claims["sub"] == "sub-eng"


def test_login_rejects_unverified_identity(monkeypatch):
    conn = db.connect()
    db.bootstrap_schema(conn)
    tenancy.bootstrap_tenancy(conn)

    def _raise(token, client_id=None):
        raise auth.AuthError("email not verified by Google")
    monkeypatch.setattr(auth, "verify_google_id_token", _raise)

    with pytest.raises(auth.AuthError):
        auth.login_with_google(conn, "bad-token")


# --- HTTP endpoint tests ----------------------------------------------------

from fastapi.testclient import TestClient
from lore.api import app

client = TestClient(app)


def test_auth_google_endpoint_returns_token_then_me_works(monkeypatch):
    monkeypatch.setattr(auth, "verify_google_id_token",
                        lambda token, client_id=None: {
                            "sub": "sub-http", "email": "http@acme.com",
                            "name": "Http User", "email_verified": True})
    r = client.post("/auth/google", json={"id_token": "fake"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user_id"] == "sub-http"
    token = body["token"]

    # The Lore JWT authenticates the protected /auth/me endpoint.
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200, me.text
    assert me.json()["user_id"] == "sub-http"


def test_auth_google_endpoint_rejects_bad_identity(monkeypatch):
    def _raise(token, client_id=None):
        raise auth.AuthError("invalid Google ID token")
    monkeypatch.setattr(auth, "verify_google_id_token", _raise)
    r = client.post("/auth/google", json={"id_token": "bad"})
    assert r.status_code == 401


def test_protected_endpoint_requires_valid_bearer():
    assert client.get("/auth/me").status_code == 401
    assert client.get("/auth/me", headers={"Authorization": "Bearer not.a.jwt"}).status_code == 401


# --- Okta SSO: group → scope reconciliation ---------------------------------

def test_group_scope_map_parses_and_rejects_garbage(monkeypatch):
    monkeypatch.setenv("OKTA_GROUP_SCOPE_MAP", '{"Engineering":"t-eng","Legal":"t-legal"}')
    assert okta.group_scope_map() == {"Engineering": "t-eng", "Legal": "t-legal"}

    monkeypatch.delenv("OKTA_GROUP_SCOPE_MAP", raising=False)
    assert okta.group_scope_map() == {}

    monkeypatch.setenv("OKTA_GROUP_SCOPE_MAP", "not json")
    with pytest.raises(auth.AuthError):
        okta.group_scope_map()

    monkeypatch.setenv("OKTA_GROUP_SCOPE_MAP", '["a","b"]')  # not an object
    with pytest.raises(auth.AuthError):
        okta.group_scope_map()


def test_okta_config_fails_closed_without_issuer_or_client(monkeypatch):
    monkeypatch.delenv("OKTA_ISSUER", raising=False)
    monkeypatch.delenv("OKTA_CLIENT_ID", raising=False)
    with pytest.raises(auth.AuthError):
        okta.okta_config()


def test_sync_okta_groups_grants_revokes_and_leaves_invites_alone():
    conn = db.connect()
    db.bootstrap_schema(conn)
    tenancy.bootstrap_tenancy(conn)
    gmap = {"Engineering": "t-eng", "Legal": "t-legal"}

    # An invite-based membership to a team SSO does NOT manage.
    conn.execute("insert into orgs(id,name) values('o-x','X') on conflict do nothing")
    conn.execute("insert into teams(id,org_id,name) values('t-invited','o-x','Invited') on conflict do nothing")
    conn.execute("insert into memberships(user_id,org_id,team_id,role,status) "
                 "values('u1','o-x','t-invited','member','active') "
                 "on conflict (user_id,team_id) do update set status='active'")

    # First login: member of Engineering + Legal via SSO. Teams auto-provision.
    scopes = okta.sync_okta_groups(conn, "u1", ["Engineering", "Legal"], gmap)
    assert scopes == ["team:t-eng", "team:t-invited", "team:t-legal"]

    # Second login: dropped from Legal in Okta → that scope is revoked; the
    # invite-based team is untouched; Engineering stays.
    scopes = okta.sync_okta_groups(conn, "u1", ["Engineering"], gmap)
    assert scopes == ["team:t-eng", "team:t-invited"]
    revoked = conn.execute(
        "select status from memberships where user_id='u1' and team_id='t-legal'").fetchone()
    assert revoked[0] == "revoked"


def test_login_with_okta_verifies_syncs_and_issues_jwt(monkeypatch):
    conn = db.connect()
    db.bootstrap_schema(conn)
    tenancy.bootstrap_tenancy(conn)

    monkeypatch.setenv("OKTA_ISSUER", "https://dev-test.okta.com/oauth2/default")
    monkeypatch.setenv("OKTA_CLIENT_ID", "0oatestclientid")
    monkeypatch.setenv("OKTA_GROUP_SCOPE_MAP", '{"Engineering":"t-eng"}')

    # Pretend Okta verified this identity + groups (no network in tests).
    monkeypatch.setattr(okta, "verify_okta_id_token",
                        lambda token, issuer=None, client_id=None: {
                            "sub": "00u-okta-1", "email": "eng@corp.com",
                            "name": "Eng User", "email_verified": True,
                            "groups": ["Engineering"]})

    result = okta.login_with_okta(conn, "fake-okta-id-token")
    assert result["user_id"] == "00u-okta-1"
    assert result["email"] == "eng@corp.com"
    assert result["scopes"] == ["team:t-eng"]
    assert result["groups"] == ["Engineering"]

    # The issued session JWT verifies back to the same user.
    assert auth.verify_session_jwt(result["token"])["sub"] == "00u-okta-1"


def test_auth_okta_endpoint_returns_token_then_me_works(monkeypatch):
    monkeypatch.setenv("OKTA_ISSUER", "https://dev-test.okta.com/oauth2/default")
    monkeypatch.setenv("OKTA_CLIENT_ID", "0oatestclientid")
    monkeypatch.setenv("OKTA_GROUP_SCOPE_MAP", '{"Engineering":"t-eng"}')
    monkeypatch.setattr(okta, "verify_okta_id_token",
                        lambda token, issuer=None, client_id=None: {
                            "sub": "00u-http", "email": "http@corp.com",
                            "name": "Http User", "email_verified": True,
                            "groups": ["Engineering"]})
    r = client.post("/auth/okta", json={"id_token": "fake"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user_id"] == "00u-http"
    assert body["scopes"] == ["team:t-eng"]

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.status_code == 200, me.text
    assert me.json()["user_id"] == "00u-http"


def test_auth_okta_endpoint_rejects_bad_identity(monkeypatch):
    monkeypatch.setenv("OKTA_ISSUER", "https://dev-test.okta.com/oauth2/default")
    monkeypatch.setenv("OKTA_CLIENT_ID", "0oatestclientid")

    def _raise(token, issuer=None, client_id=None):
        raise auth.AuthError("invalid Okta ID token")
    monkeypatch.setattr(okta, "verify_okta_id_token", _raise)
    r = client.post("/auth/okta", json={"id_token": "bad"})
    assert r.status_code == 401
