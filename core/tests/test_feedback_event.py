"""Generic button feedback: POST /feedback/event.

Contract: any event name + caller-declared valence fans one press out to the
artifact's evidence notes as weighted feedback rows; votes only land on notes
that exist in the tenant; weights are clamped; the weighted net feeds the
existing ranking multiplier (classic /feedback rows keep weight 1.0).
"""
from fastapi.testclient import TestClient

from lore import db
from lore.api import app

client = TestClient(app)
TENANT = "fb-event-t"
_SCOPE = "private"


def _conn():
    c = db.connect()
    db.bootstrap_schema(c)
    return c


def _note(conn, nid):
    conn.execute(
        """insert into notes(id, tenant_id, owner_id, scope_id, title, body,
                             source_type, updated_at)
           values(%s,%s,'me',%s,'t','b','note',now()) on conflict (id) do nothing""",
        (nid, TENANT, _SCOPE))


def test_event_fans_out_weighted_votes():
    conn = _conn()
    for nid in ("fbe-1", "fbe-2"):
        _note(conn, nid)

    r = client.post("/feedback/event", json={
        "event": "email_sent", "vote": 1, "source": "email-draft",
        "note_ids": ["fbe-1", "fbe-2", "fbe-ghost"], "tenant": TENANT})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["recorded"] == 2 and data["skipped"] == 1     # ghost note refused
    assert data["event"] == "email-draft:email_sent"

    r = client.post("/feedback/event", json={
        "event": "draft_edited", "vote": -1, "weight": 0.5,
        "note_ids": ["fbe-1"], "tenant": TENANT})
    assert r.status_code == 200
    assert r.json()["weight"] == 0.5

    rows = conn.execute(
        "select note_id, vote, event, weight from feedback where tenant_id=%s "
        "order by note_id, event", (TENANT,)).fetchall()
    by = {(r[0], r[2]): (r[1], r[3]) for r in rows}
    assert by[("fbe-1", "email-draft:email_sent")] == (1, 1.0)
    assert by[("fbe-1", "draft_edited")] == (-1, 0.5)
    # weighted net for fbe-1: +1*1.0 - 1*0.5 = 0.5
    net = conn.execute(
        "select sum(vote * coalesce(weight,1.0)) from feedback "
        "where tenant_id=%s and note_id='fbe-1'", (TENANT,)).fetchone()[0]
    assert abs(net - 0.5) < 1e-9


def test_event_validation_and_clamps():
    conn = _conn()
    _note(conn, "fbe-v1")
    # empty note_ids / empty event / missing tenant all refuse cleanly
    assert client.post("/feedback/event", json={
        "event": "x", "vote": 1, "note_ids": [], "tenant": TENANT}).status_code == 422
    assert client.post("/feedback/event", json={
        "event": "  ", "vote": 1, "note_ids": ["fbe-v1"], "tenant": TENANT}).status_code == 422
    assert client.post("/feedback/event", json={
        "event": "x", "vote": 1, "note_ids": ["fbe-v1"]}).status_code == 422
    # weight clamped into (0, 1]; vote normalized to +/-1
    r = client.post("/feedback/event", json={
        "event": "super_click", "vote": 7, "weight": 9.0,
        "note_ids": ["fbe-v1"], "tenant": TENANT})
    assert r.json()["vote"] == 1 and r.json()["weight"] == 1.0


def test_v1_mirror_exists():
    conn = _conn()
    _note(conn, "fbe-m1")
    r = client.post("/api/v1/feedback/event", json={
        "event": "copied", "vote": 1, "note_ids": ["fbe-m1"], "tenant": TENANT})
    assert r.status_code == 200
