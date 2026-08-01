"""Named scopes + grants engine (2026-07-28 spec, Phase C)."""
import pytest

from lore import db, scopes, tenancy


def _conn():
    c = db.connect()
    db.bootstrap_schema(c)
    tenancy.bootstrap_tenancy(c)
    return c


def test_owner_sees_and_writes_created_scope():
    conn = _conn()
    s = scopes.create_scope(conn, "t-s", "sc-alice", "Case Files")
    assert s["scope_id"].startswith("s:case-files-")
    assert s["scope_id"] in tenancy.authorize_scopes(conn, "sc-alice", None)
    assert scopes.can_write(conn, s["scope_id"], "sc-alice")


def test_read_grant_authorizes_but_never_writes():
    conn = _conn()
    s = scopes.create_scope(conn, "t-s", "sc-alice", "Shared Read")
    scopes.grant(conn, "t-s", s["scope_id"], "sc-bob", "read", granted_by="sc-alice")
    assert s["scope_id"] in tenancy.authorize_scopes(conn, "sc-bob", None)
    assert not scopes.can_write(conn, s["scope_id"], "sc-bob")
    listed = scopes.list_scopes(conn, "t-s", "sc-bob")
    assert any(x["scope_id"] == s["scope_id"] and x["role"] == "read" for x in listed)


def test_non_owner_cannot_grant_and_no_widening():
    conn = _conn()
    s = scopes.create_scope(conn, "t-s", "sc-alice", "Locked")
    with pytest.raises(scopes.ScopeError):
        scopes.grant(conn, "t-s", s["scope_id"], "sc-mallory", "write",
                     granted_by="sc-mallory")
    # requesting a foreign scope yields nothing (intersection semantics)
    assert tenancy.authorize_scopes(conn, "sc-mallory", [s["scope_id"]]) == []


def test_revoke_grant_removes_access():
    conn = _conn()
    s = scopes.create_scope(conn, "t-s", "sc-alice", "Temp Share")
    scopes.grant(conn, "t-s", s["scope_id"], "sc-bob", "read", granted_by="sc-alice")
    scopes.revoke_grant(conn, "t-s", s["scope_id"], "sc-bob", revoked_by="sc-alice")
    assert s["scope_id"] not in tenancy.authorize_scopes(conn, "sc-bob", None)
