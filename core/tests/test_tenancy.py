from lore import db
from lore.tenancy import authorized_team_scope_ids, bootstrap_tenancy, team_scope_id, syncable_scope


def _seed(conn):
    bootstrap_tenancy(conn)
    conn.execute("insert into orgs(id,name) values('o1','Org1') on conflict do nothing")
    conn.execute("insert into teams(id,org_id,name) values('t1','o1','Team1') on conflict do nothing")
    conn.execute("insert into teams(id,org_id,name) values('t2','o1','Team2') on conflict do nothing")
    # alice in t1 (active), bob in t2 (active), carol in t1 but REVOKED
    conn.execute("insert into memberships(user_id,org_id,team_id,role,status) "
                 "values('alice','o1','t1','member','active') on conflict (user_id,team_id) do update set status='active'")
    conn.execute("insert into memberships(user_id,org_id,team_id,role,status) "
                 "values('bob','o1','t2','member','active') on conflict (user_id,team_id) do update set status='active'")
    conn.execute("insert into memberships(user_id,org_id,team_id,role,status) "
                 "values('carol','o1','t1','member','revoked') on conflict (user_id,team_id) do update set status='revoked'")


def test_authorized_scopes_from_membership():
    conn = db.connect()
    _seed(conn)
    assert authorized_team_scope_ids(conn, "alice") == ["team:t1"]
    assert authorized_team_scope_ids(conn, "bob") == ["team:t2"]
    # revoked membership grants nothing
    assert authorized_team_scope_ids(conn, "carol") == []
    # unknown user grants nothing
    assert authorized_team_scope_ids(conn, "nobody") == []


def test_authorized_scopes_sorted_for_multi_team():
    conn = db.connect()
    _seed(conn)
    conn.execute("insert into memberships(user_id,org_id,team_id,role,status) "
                 "values('dave','o1','t1','member','active') on conflict (user_id,team_id) do update set status='active'")
    conn.execute("insert into memberships(user_id,org_id,team_id,role,status) "
                 "values('dave','o1','t2','member','active') on conflict (user_id,team_id) do update set status='active'")
    assert authorized_team_scope_ids(conn, "dave") == ["team:t1", "team:t2"]


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
