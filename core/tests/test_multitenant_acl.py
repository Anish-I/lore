# core/tests/test_multitenant_acl.py
"""The Phase-0 GATE: team-scoped recall is leak-proof across members.
If this cannot pass without weakening the ACL, the architecture is wrong (spec §10)."""
from lore import db
from lore.embed import FakeEmbedder
from lore.rerank import FakeReranker
from lore.index import index_document
from lore.recall import retrieve
from lore.tenancy import bootstrap_tenancy, team_scope_id, authorize_scopes

_TENANT = "mt-acl-tenant"


def _seed_membership(conn):
    bootstrap_tenancy(conn)
    conn.execute("insert into orgs(id,name) values('o1','Org1') on conflict do nothing")
    for t in ("t1", "t2"):
        conn.execute("insert into teams(id,org_id,name) values(%s,'o1',%s) on conflict do nothing", (t, t))
    conn.execute("insert into memberships(user_id,org_id,team_id,role,status) "
                 "values('alice','o1','t1','member','active') on conflict (user_id,team_id) do update set status='active'")
    conn.execute("insert into memberships(user_id,org_id,team_id,role,status) "
                 "values('bob','o1','t2','member','active') on conflict (user_id,team_id) do update set status='active'")


def test_cross_member_recall_is_leakproof():
    conn = db.connect()
    db.bootstrap_schema(conn)
    _seed_membership(conn)
    emb, rr = FakeEmbedder(), FakeReranker()

    # Alice indexes a TEAM note (server-side) under team t1.
    index_document(
        source_id="mt-note-falcon", title="Project Falcon",
        text="# Project Falcon\n\nThe Falcon launch checklist and rollout plan.\n",
        scope_id=team_scope_id("t1"), owner_id="alice", tenant_id=_TENANT,
        embedder=emb, conn=conn, source_type="note",
    )

    # Bob indexes his own team note under t2 (so t2 is non-empty too).
    index_document(
        source_id="mt-note-otter", title="Project Otter",
        text="# Project Otter\n\nOtter migration notes.\n",
        scope_id=team_scope_id("t2"), owner_id="bob", tenant_id=_TENANT,
        embedder=emb, conn=conn, source_type="note",
    )

    # Alice (member of t1) recalls Falcon — authorized scopes derived server-side.
    alice_scopes = authorize_scopes(conn, "alice", None)
    hits = retrieve("falcon launch checklist", emb, rr, alice_scopes, _TENANT, limit=8)
    assert any("falcon" in h.text.lower() for h in hits), "Alice must see her team's note"

    # Bob (member of t2 only) CANNOT retrieve Falcon, even forging a request for t1.
    bob_forged = authorize_scopes(conn, "bob", ["team:t1"])
    assert bob_forged == [], "Forged scope must not be authorized"
    bob_hits = retrieve("falcon launch checklist", emb, rr, bob_forged or ["team:__none__"], _TENANT, limit=8)
    assert bob_hits == [] or all("falcon" not in h.text.lower() for h in bob_hits), \
        "Bob must not retrieve, count, or rerank another team's chunk"
