"""Regression tests for the 2026-07-03 red-team/blue-team security pass.

Covers:
  - /reindex path-traversal containment (VAULT_ROOTS) — F2 arbitrary file read
  - invite expiry — MED-4
  - broadened secret redaction — MED-1
"""
import datetime

import pytest


# ---------- F2: /reindex path containment ----------

def test_reindex_guard_blocks_escape_when_roots_configured(tmp_path, monkeypatch):
    from lore import api
    root = tmp_path / "vault"
    root.mkdir()
    monkeypatch.setenv("VAULT_ROOTS", str(root))

    # A path outside the configured root is refused.
    outside = tmp_path / "secrets.txt"
    outside.write_text("SECRET")
    with pytest.raises(api.HTTPException) as ei:
        api._guard_reindex_path(str(outside))
    assert ei.value.status_code == 400

    # A path inside the root is allowed.
    inside = root / "note.md"
    inside.write_text("# hi")
    api._guard_reindex_path(str(inside))  # no raise


def test_reindex_guard_noop_when_unconfigured(monkeypatch):
    from lore import api
    monkeypatch.delenv("VAULT_ROOTS", raising=False)
    monkeypatch.delenv("VAULT_ROOT", raising=False)
    # Legacy/dev mode: guard is a no-op (does not raise) — behavior preserved.
    api._guard_reindex_path("C:/anything/at/all")


# ---------- MED-4: invite expiry ----------

def test_invite_expired_helper():
    from lore import tenancy
    now = datetime.datetime.now(datetime.timezone.utc)
    assert tenancy._invite_expired(now) is False
    old = now - datetime.timedelta(days=tenancy.INVITE_TTL_DAYS + 1)
    assert tenancy._invite_expired(old) is True
    assert tenancy._invite_expired(None) is False
    # ISO string form (SQLite-style) also handled.
    assert tenancy._invite_expired(old.isoformat()) is True


def test_accept_invite_rejects_expired(monkeypatch):
    from lore import db, tenancy
    conn = db.connect()
    tenancy.bootstrap_tenancy(conn)
    team = tenancy.create_team(conn, "Sec Team", "owner-1")
    inv = tenancy.invite_to_team(conn, team["team_id"], "friend@example.com", "owner-1")
    # Backdate the invite past the TTL.
    old = (datetime.datetime.now(datetime.timezone.utc)
           - datetime.timedelta(days=tenancy.INVITE_TTL_DAYS + 2))
    conn.execute("update invites set created_at=%s where id=%s", (old, inv["invite_id"]))
    with pytest.raises(tenancy.InviteError, match="expired"):
        tenancy.accept_invite(conn, inv["invite_id"], "friend-uid", "friend@example.com")


# ---------- MED-1: broadened redaction ----------
# Fixtures are assembled from parts at runtime so no secret-shaped literal exists
# in the source (avoids tripping GitHub push-protection / secret scanners).
_BODY = "1234567890abcdefghijklmnopqrstuv"  # 32 filler chars

@pytest.mark.parametrize("secret", [
    "AI" + "za" + "Sy" + _BODY + "w",        # Google API key (AIza + 35)
    "GOC" + "SPX-" + _BODY + "wxyz12",       # Google OAuth secret
    "sk_" + "live_" + _BODY[:24],            # Stripe live key
    "sk-" + _BODY[:28],                      # OpenAI-style key
])
def test_redact_covers_common_provider_keys(secret):
    from lore.redact import redact
    out = redact(f"my key is {secret} ok")
    assert secret not in out
    assert "[REDACTED]" in out


# ---------- CRIT-1: LORE_SERVER_MODE data-plane enforcement gate ----------

def _server_client(monkeypatch):
    """A TestClient with the enforcement gate ON and a known JWT secret."""
    from fastapi.testclient import TestClient
    from lore.api import app, get_embedder, get_reranker, get_sparse_embedder
    from lore.embed import FakeEmbedder
    from lore.rerank import FakeReranker
    monkeypatch.setenv("LORE_SERVER_MODE", "1")
    monkeypatch.setenv("LORE_JWT_SECRET", "test-secret-abc")
    app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
    app.dependency_overrides[get_reranker] = lambda: FakeReranker()
    app.dependency_overrides[get_sparse_embedder] = lambda: None
    return TestClient(app)


def _seed_member(user_id, team_id="sec_tX"):
    from lore import api, tenancy
    tenancy.bootstrap_tenancy(api._conn)
    api._conn.execute("insert into orgs(id,name) values('oX','OrgX') on conflict do nothing")
    api._conn.execute("insert into teams(id,org_id,name) values(%s,'oX',%s) on conflict do nothing",
                      (team_id, team_id))
    api._conn.execute(
        "insert into memberships(user_id,org_id,team_id,role,status) "
        "values(%s,'oX',%s,'member','active') on conflict (user_id,team_id) do update set status='active'",
        (user_id, team_id))


def _token(user_id):
    from lore import auth
    return {"Authorization": f"Bearer {auth.issue_session_jwt(user_id)}"}


def test_server_mode_search_requires_bearer(monkeypatch):
    client = _server_client(monkeypatch)
    r = client.post("/search", json={"query": "x", "scopes": ["team:sec_tX"], "tenant_id": "t"})
    assert r.status_code == 401


def test_server_mode_ask_requires_bearer(monkeypatch):
    client = _server_client(monkeypatch)
    r = client.post("/ask", json={"question": "x", "principal_scopes": ["team:sec_tX"], "tenant_id": "t"})
    assert r.status_code == 401


def test_server_mode_drops_forged_team_scope(monkeypatch):
    # Mallory is NOT a member of tX; requesting team:sec_tX must yield no authorized
    # scopes → 403 (never silently querying the team she can't see).
    client = _server_client(monkeypatch)
    _seed_member("sec_alice", "sec_tX")            # alice is the real member
    r = client.post("/search", headers=_token("sec_mallory"),
                    json={"query": "secrets", "scopes": ["team:sec_tX"], "tenant_id": "t"})
    assert r.status_code == 403


def test_server_mode_write_rejects_foreign_scope(monkeypatch):
    # Mallory cannot ingest INTO team tX (not a member); only her own private scope.
    client = _server_client(monkeypatch)
    _seed_member("sec_alice", "sec_tX")
    r = client.post("/ingest", headers=_token("sec_mallory"),
                    json={"source_id": "sec_n1", "title": "t", "text": "hi",
                          "scope": "team:sec_tX", "owner": "spoofed", "tenant": "t"})
    assert r.status_code == 403


def test_server_mode_write_allows_own_private_scope(monkeypatch):
    client = _server_client(monkeypatch)
    r = client.post("/ingest", headers=_token("sec_carol"),
                    json={"source_id": "n-sec-carol", "title": "t", "text": "hello world",
                          "scope": "private:sec_carol", "owner": "sec_carol", "tenant": "t"})
    assert r.status_code == 200


def test_server_mode_forget_blocks_anonymous(monkeypatch):
    client = _server_client(monkeypatch)
    r = client.post("/forget", json={"tenant": "t", "path_prefix": "/"})
    assert r.status_code == 401
