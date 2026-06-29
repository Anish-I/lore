from lore import db
from lore.tenancy import bootstrap_tenancy, team_scope_id, syncable_scope


def test_scope_helpers():
    assert team_scope_id(7) == "team:7"
    assert syncable_scope("team") is True
    assert syncable_scope("enterprise") is True
    # private must never be syncable — the zero-knowledge invariant
    assert syncable_scope("private") is False
    assert syncable_scope("anything-else") is False


def test_bootstrap_tenancy_is_idempotent():
    conn = db.connect()
    bootstrap_tenancy(conn)
    bootstrap_tenancy(conn)  # second call must not raise
    # tables exist and are queryable
    conn.execute("select count(*) from orgs")
    conn.execute("select count(*) from teams")
    conn.execute("select count(*) from memberships")
    conn.execute("select count(*) from audit_log")
