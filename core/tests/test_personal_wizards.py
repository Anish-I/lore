"""Personal Wizards: an APPLIED Section promoted to a scoped RAG assistant.

The contract under test:
  * promote is only valid on an 'applied' section (409/SectionError otherwise)
    and is idempotent — nothing on disk is ever touched by the backend.
  * /wizards/personal lists wizards with the folder derived from the section's
    recorded move plan.
  * /wizards/personal/{id}/ask returns the same shape as /ask but citations come
    ONLY from the wizard's own notes, and every turn persists to the chat table.
  * /wizards/personal/{id}/chat returns the persisted history, oldest first.
"""
import json

import pytest
from fastapi.testclient import TestClient

from lore import db
from lore.api import app
from lore.sections import (
    SectionError, append_wizard_chat, apply_section, list_personal_wizards,
    promote_section, wizard_chat, wizard_members,
)

client = TestClient(app)

_SCOPE = "private"


def _conn():
    c = db.connect()
    db.bootstrap_schema(c)
    return c


def _seed_section(conn, tenant, tmp_path, name="Kalshi Trading"):
    """Index two member notes + one outsider (same scope), then insert a
    'proposed' section over the members. Returns (section_id, member_ids, outsider_id)."""
    paths = {}
    for fname, body in [
        ("kalshi-a.md", "# Kalshi A\n\nKalshi trading bot pair sizing and fed markets.\n"),
        ("kalshi-b.md", "# Kalshi B\n\nKalshi trading crypto weather strategy notes.\n"),
        ("acme.md", "# Acme\n\nKalshi trading mention but really about the Acme renewal.\n"),
    ]:
        p = tmp_path / fname
        p.write_text(body, encoding="utf-8")
        r = client.post("/reindex", json={"path": str(p), "owner_id": "me",
                                          "scope_id": _SCOPE, "tenant_id": tenant})
        assert r.status_code == 200
        paths[fname] = str(p)

    ids = {r[1].rsplit("/", 1)[-1]: r[0] for r in conn.execute(
        "select id, replace(source_path, '\\', '/') from notes where tenant_id=%s",
        (tenant,)).fetchall()}
    members = [ids["kalshi-a.md"], ids["kalshi-b.md"]]
    sid = f"sec:{tenant}:kalshi-trading"
    conn.execute(
        "insert into section_proposals(id, tenant_id, name, topic, note_ids, status) "
        "values(%s,%s,%s,%s,%s,'proposed') on conflict do nothing",
        (sid, tenant, name, name, json.dumps(members)))
    return sid, members, ids["acme.md"]


# ---------------------------------------------------------------------------
# promote
# ---------------------------------------------------------------------------

def test_promote_requires_applied_section(tmp_path):
    tenant = "wiz-not-applied"
    conn = _conn()
    sid, _members, _out = _seed_section(conn, tenant, tmp_path)

    with pytest.raises(SectionError):
        promote_section(conn, tenant, sid)          # still 'proposed'
    r = client.post(f"/sections/{sid}/promote", json={"tenant": tenant})
    assert r.status_code == 409

    r = client.post("/sections/nope/promote", json={"tenant": tenant})
    assert r.status_code == 409                      # unknown section, same as other transitions


def test_promote_applied_section_is_idempotent(tmp_path):
    tenant = "wiz-promote"
    conn = _conn()
    sid, members, _out = _seed_section(conn, tenant, tmp_path)
    dest = str(tmp_path / "Kalshi Trading").replace("\\", "/")
    apply_section(conn, tenant, sid, dest_dir=dest)  # state only; no files move

    r = client.post(f"/sections/{sid}/promote", json={"tenant": tenant})
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == f"wiz:{tenant}:kalshi-trading"
    assert body["section_id"] == sid
    assert body["note_count"] == len(members)

    # Promote again: no duplicate row, same wizard back.
    r2 = client.post(f"/sections/{sid}/promote", json={"tenant": tenant})
    assert r2.status_code == 200 and r2.json()["id"] == body["id"]
    assert len(list_personal_wizards(conn, tenant)) == 1

    # Listing endpoint carries the folder from the recorded move plan.
    lr = client.get(f"/wizards/personal?tenant={tenant}")
    assert lr.status_code == 200
    wiz = lr.json()["wizards"]
    assert len(wiz) == 1
    assert wiz[0]["folder"] == dest
    assert wiz[0]["topic"] == "Kalshi Trading"

    # Section undo stays possible after promotion (wizard is just a view).
    ur = client.post(f"/sections/{sid}/undo", json={"tenant": tenant})
    assert ur.status_code == 200


def test_wizards_personal_list_requires_tenant():
    assert client.get("/wizards/personal").status_code == 422


# ---------------------------------------------------------------------------
# membership + scoped ask
# ---------------------------------------------------------------------------

def test_wizard_members_union_of_folder_and_recorded_ids(tmp_path):
    tenant = "wiz-members"
    conn = _conn()
    sid, members, outsider = _seed_section(conn, tenant, tmp_path)
    dest = str(tmp_path / "Kalshi Trading").replace("\\", "/")
    apply_section(conn, tenant, sid, dest_dir=dest)
    wid = promote_section(conn, tenant, sid)["id"]

    # Recorded note_ids resolve even though no file ever moved (backend never touches fs).
    got, scopes = wizard_members(conn, tenant, wid)
    assert got == set(members)
    assert scopes == [_SCOPE]
    assert outsider not in got

    # A note that later lands INSIDE the section folder joins by path prefix.
    conn.execute(
        "insert into notes(id, tenant_id, owner_id, scope_id, source_path, title, updated_at) "
        "values('wm-new',%s,'me',%s,%s,'New member',now())",
        (tenant, _SCOPE, dest + "/new-member.md"))
    got2, _ = wizard_members(conn, tenant, wid)
    assert got2 == set(members) | {"wm-new"}

    with pytest.raises(SectionError):
        wizard_members(conn, tenant, "wiz:nope:missing")


def test_wizard_ask_scopes_citations_and_persists_chat(tmp_path):
    tenant = "wiz-ask"
    conn = _conn()
    sid, members, outsider = _seed_section(conn, tenant, tmp_path)
    apply_section(conn, tenant, sid,
                  dest_dir=str(tmp_path / "Kalshi Trading").replace("\\", "/"))
    wid = client.post(f"/sections/{sid}/promote", json={"tenant": tenant}).json()["id"]

    # Sanity: an UNSCOPED ask over the same scope can see the outsider note too.
    plain = client.post("/ask", json={"question": "Kalshi trading strategy",
                                      "principal_scopes": [_SCOPE], "tenant_id": tenant})
    assert plain.status_code == 200

    r = client.post(f"/wizards/personal/{wid}/ask",
                    json={"question": "Kalshi trading strategy", "tenant": tenant})
    assert r.status_code == 200
    body = r.json()
    assert set(body) >= {"answer", "engine", "citations"}   # same shape as /ask
    assert body["citations"], "wizard ask should retrieve from its member notes"
    cited = {c["note_id"] for c in body["citations"]}
    assert cited <= set(members)
    assert outsider not in cited

    # Both turns persisted, oldest first, sources on the assistant turn.
    hr = client.get(f"/wizards/personal/{wid}/chat?tenant={tenant}")
    assert hr.status_code == 200
    msgs = hr.json()["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[0]["text"] == "Kalshi trading strategy"
    assert msgs[1]["text"] == body["answer"]
    assert {c["note_id"] for c in (msgs[1]["sources"] or [])} == cited

    # A second ask appends two more turns in order.
    client.post(f"/wizards/personal/{wid}/ask",
                json={"question": "pair sizing?", "tenant": tenant})
    msgs2 = client.get(f"/wizards/personal/{wid}/chat?tenant={tenant}").json()["messages"]
    assert [m["role"] for m in msgs2] == ["user", "assistant", "user", "assistant"]
    assert msgs2[2]["text"] == "pair sizing?"


def test_wizard_ask_and_chat_unknown_wizard_404():
    tenant = "wiz-404"
    _conn()
    r = client.post("/wizards/personal/wiz:none/ask",
                    json={"question": "hi", "tenant": tenant})
    assert r.status_code == 404
    assert client.get(f"/wizards/personal/wiz:none/chat?tenant={tenant}").status_code == 404
    assert client.get("/wizards/personal/wiz:none/chat").status_code == 422  # tenant required


def test_wizard_chat_is_tenant_scoped(tmp_path):
    tenant = "wiz-acl-a"
    conn = _conn()
    sid, _members, _out = _seed_section(conn, tenant, tmp_path)
    apply_section(conn, tenant, sid, dest_dir=str(tmp_path / "KT").replace("\\", "/"))
    wid = promote_section(conn, tenant, sid)["id"]
    append_wizard_chat(conn, tenant, wid, "user", "secret question")

    # Another tenant can neither list the wizard nor read its chat.
    assert client.get("/wizards/personal?tenant=wiz-acl-b").json()["wizards"] == []
    assert client.get(f"/wizards/personal/{wid}/chat?tenant=wiz-acl-b").status_code == 404
    assert [m["text"] for m in wizard_chat(conn, tenant, wid)] == ["secret question"]
