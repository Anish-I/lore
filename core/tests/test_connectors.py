"""Connectors: .eml + Slack-export parsing and idempotent sync into the to-dos
pipeline.

No LLM and no OAuth — the heuristic extractor runs under VAULT_FAKE, and the
sources are local files (a folder of .eml, or a Slack workspace export), so the
whole enterprise "source → to-dos" path is exercised end-to-end here.
"""
import json
import os

os.environ.setdefault("LORE_JWT_SECRET", "test-secret-please-do-not-use-in-production-0123456789")

import pytest
from lore import db, tenancy, connectors, todos as todos_mod


def _eml(msg_id, subject, body, sender="Alice Smith <alice@corp.com>",
         to="Bob Jones <bob@corp.com>"):
    mid = f"Message-ID: <{msg_id}>\n" if msg_id else ""
    return (f"From: {sender}\nTo: {to}\n{mid}"
            f"Subject: {subject}\nDate: Mon, 01 Jul 2026 10:00:00 +0000\n"
            f"Content-Type: text/plain; charset=utf-8\n\n{body}")


def _write(folder, name, text):
    p = os.path.join(folder, name)
    with open(p, "w", encoding="utf-8") as f:
        f.write(text)
    return p


def test_parse_eml_extracts_body_headers_and_message_id():
    parsed = connectors.parse_eml(_eml("m-1@corp.com", "Q3 planning",
                                       "Bob, send the budget draft by Friday EOD."))
    assert parsed["external_id"] == "m-1@corp.com"
    assert parsed["subject"] == "Q3 planning"
    assert "Bob Jones <bob@corp.com>" in parsed["text"]      # To header rebuilt for name-resolution
    assert "send the budget draft" in parsed["text"]


def test_parse_eml_falls_back_to_content_hash_without_message_id():
    parsed = connectors.parse_eml(_eml(None, "No id here", "Some body text."))
    assert parsed["external_id"].startswith("sha256:")
    # Stable: same content → same id (so dedup holds even without a Message-ID).
    again = connectors.parse_eml(_eml(None, "No id here", "Some body text."))
    assert parsed["external_id"] == again["external_id"]


def test_parse_eml_strips_html_body():
    html = ("MIME-Version: 1.0\nFrom: A <a@x.com>\nSubject: h\n"
            "Content-Type: text/html; charset=utf-8\n\n"
            "<html><body><p>Bob, review the <b>vendor</b> list.</p>"
            "<script>alert(1)</script></body></html>")
    parsed = connectors.parse_eml(html)
    assert "review the vendor list" in parsed["text"]
    assert "<b>" not in parsed["text"] and "alert(1)" not in parsed["text"]


def test_sync_mailbox_extracts_todos_and_is_idempotent(tmp_path):
    conn = db.connect()
    db.bootstrap_schema(conn)
    tenancy.bootstrap_tenancy(conn)

    folder = str(tmp_path)
    _write(folder, "a.eml", _eml("a@corp.com", "Budget",
                                 "Bob, send the budget draft by Friday EOD."))
    _write(folder, "b.eml", _eml("b@corp.com", "Vendors",
                                 "Carol, review the vendor list.",
                                 to="Carol Diaz <carol@corp.com>"))

    r1 = connectors.sync_mailbox(conn, "acme", "team:t-eng", folder, owner="alice")
    assert r1["processed"] == 2
    assert r1["skipped"] == 0
    assert r1["todos_created"] >= 2
    # Full-name resolution from the recipient header, and provenance stamped on.
    assignees = {t["assignee"] for t in r1["todos"]}
    assert "Bob Jones" in assignees
    assert all(t["source"] for t in r1["todos"])   # provenance filled in

    # Re-sync the same folder: every message is already watermarked → nothing new.
    r2 = connectors.sync_mailbox(conn, "acme", "team:t-eng", folder, owner="alice")
    assert r2["processed"] == 0
    assert r2["skipped"] == 2
    assert r2["todos_created"] == 0

    # The to-dos are persisted, scope-filtered, and pending.
    listed = todos_mod.list_todos(conn, "acme", ["team:t-eng"], status="pending")
    assert len(listed) == r1["todos_created"]
    assert all(t["scope_id"] == "team:t-eng" for t in listed)

    # A different scope sees none of them (ACL holds through the connector).
    assert todos_mod.list_todos(conn, "acme", ["team:t-other"]) == []


def test_sync_same_folder_into_two_scopes_does_not_collide(tmp_path):
    """Two scopes in one tenant syncing the SAME folder (same auto `source` name)
    must each get their own to-dos — the watermark is keyed per scope, so scope B
    is not starved by scope A having seen the messages first (F2 regression)."""
    conn = db.connect()
    db.bootstrap_schema(conn)
    tenancy.bootstrap_tenancy(conn)

    folder = str(tmp_path)
    _write(folder, "a.eml", _eml("shared@corp.com", "Budget",
                                 "Bob, send the budget draft by Friday EOD."))

    a = connectors.sync_mailbox(conn, "acme", "team:t-a", folder, owner="alice")
    b = connectors.sync_mailbox(conn, "acme", "team:t-b", folder, owner="alice")

    # Both scopes processed the message (before the fix, B skipped it → 0 to-dos).
    assert a["processed"] == 1 and a["todos_created"] >= 1
    assert b["processed"] == 1 and b["todos_created"] >= 1
    assert b["skipped"] == 0

    # Each scope holds its own copy; neither can see the other's.
    assert len(todos_mod.list_todos(conn, "acme", ["team:t-a"])) == a["todos_created"]
    assert len(todos_mod.list_todos(conn, "acme", ["team:t-b"])) == b["todos_created"]

    # Re-syncing scope A is still idempotent (the per-scope watermark holds).
    a2 = connectors.sync_mailbox(conn, "acme", "team:t-a", folder, owner="alice")
    assert a2["processed"] == 0 and a2["skipped"] == 1


def test_sync_mailbox_respects_limit(tmp_path):
    conn = db.connect()
    db.bootstrap_schema(conn)
    tenancy.bootstrap_tenancy(conn)
    folder = str(tmp_path)
    for i in range(3):
        _write(folder, f"{i}.eml", _eml(f"{i}@corp.com", f"S{i}",
                                        "Bob, ship the thing today."))
    r = connectors.sync_mailbox(conn, "acme", "team:t-eng", folder, owner="a", limit=1)
    assert r["processed"] == 1
    # The unprocessed two are NOT watermarked, so a later full sync still gets them.
    r2 = connectors.sync_mailbox(conn, "acme", "team:t-eng", folder, owner="a")
    assert r2["processed"] == 2


# --- Slack workspace export -------------------------------------------------


def _slack_export(folder, channel="planning", messages=None, users=None):
    """Write a minimal Slack export: users.json + <channel>/<day>.json."""
    users = users or [
        {"id": "U1", "profile": {"real_name": "Alice Smith"}},
        {"id": "U2", "real_name": "Bob Jones"},
    ]
    with open(os.path.join(folder, "users.json"), "w", encoding="utf-8") as f:
        json.dump(users, f)
    cdir = os.path.join(folder, channel)
    os.makedirs(cdir, exist_ok=True)
    with open(os.path.join(cdir, "2026-07-01.json"), "w", encoding="utf-8") as f:
        json.dump(messages, f)


def test_parse_slack_export_groups_threads_and_resolves_names(tmp_path):
    folder = str(tmp_path)
    _slack_export(folder, messages=[
        {"type": "message", "user": "U1", "ts": "1.0",
         "text": "Bob, ship the release notes by Friday."},
        {"type": "message", "user": "U2", "ts": "1.1", "thread_ts": "1.0",
         "text": "On it. <@U1> can you review?"},
        {"type": "message", "user": "U1", "ts": "2.0", "text": "Standalone note."},
        {"type": "message", "subtype": "channel_join", "user": "U2", "ts": "2.1",
         "text": "has joined"},   # skipped: subtype
    ])
    threads = list(connectors.parse_slack_export(folder))
    # Two roots (thread "1.0" with its reply, and standalone "2.0"); join is dropped.
    assert len(threads) == 2
    root = next(t for t in threads if t["external_id"] == "planning:1.0")
    assert "Alice Smith" in root["participants"] and "Bob Jones" in root["participants"]
    assert "ship the release notes" in root["text"]
    assert "<@U1>" not in root["text"] and "Alice Smith" in root["text"]  # mention resolved


def test_sync_slack_export_extracts_and_is_idempotent(tmp_path):
    conn = db.connect()
    db.bootstrap_schema(conn)
    tenancy.bootstrap_tenancy(conn)
    folder = str(tmp_path)
    _slack_export(folder, messages=[
        {"type": "message", "user": "U1", "ts": "1.0",
         "text": "Bob, ship the release notes by Friday."},
    ])

    # A scope unique to this test so the shared session DB (other tests' todos)
    # doesn't perturb the exact-count assertions below.
    r1 = connectors.sync_slack_export(conn, "acme", "team:t-slack", folder, owner="alice")
    assert r1["processed"] == 1
    assert r1["todos_created"] >= 1
    assert all(t["source"] and t["source"].startswith("#") for t in r1["todos"])  # channel provenance

    r2 = connectors.sync_slack_export(conn, "acme", "team:t-slack", folder, owner="alice")
    assert r2["processed"] == 0 and r2["skipped"] == 1 and r2["todos_created"] == 0

    listed = todos_mod.list_todos(conn, "acme", ["team:t-slack"], status="pending")
    assert len(listed) == r1["todos_created"]
    assert todos_mod.list_todos(conn, "acme", ["team:t-other"]) == []


def test_sync_slack_export_uses_injected_llm(tmp_path):
    """Conversational Slack text the heuristic wouldn't catch is handled by the
    LLM path — proving the connector threads the provider seam through."""
    conn = db.connect()
    db.bootstrap_schema(conn)
    tenancy.bootstrap_tenancy(conn)
    folder = str(tmp_path)
    _slack_export(folder, messages=[
        {"type": "message", "user": "U2", "ts": "1.0",
         "text": "hey could someone take a look at the flaky deploy when you get a sec"},
    ])
    fake_llm = lambda prompt: ('[{"assignee":"Bob Jones","task":"Investigate the flaky deploy",'
                               '"due":null,"due_text":null,"source":"#planning"}]')
    r = connectors.sync_slack_export(conn, "acme", "team:t-eng", folder,
                                     owner="alice", llm_call=fake_llm)
    assert r["todos_created"] == 1
    assert r["todos"][0]["task"] == "Investigate the flaky deploy"


# --- HTTP endpoint ----------------------------------------------------------

from fastapi.testclient import TestClient
from lore.api import app

client = TestClient(app)


def test_mailbox_sync_endpoint_round_trip(tmp_path):
    folder = str(tmp_path)
    _write(folder, "x.eml", _eml("x@corp.com", "Kickoff",
                                 "Bob, draft the kickoff plan by tomorrow."))
    r = client.post("/connectors/mailbox/sync",
                    json={"tenant_id": "acme", "folder": folder, "scope": "team:t-eng",
                          "owner": "alice"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["processed"] == 1
    assert body["todos_created"] >= 1

    # The synced to-dos show up on /todos for that scope.
    got = client.get("/todos", params={"tenant": "acme", "scopes": "team:t-eng",
                                        "status": "pending"})
    assert got.status_code == 200
    assert got.json()["count"] >= 1


def test_slack_sync_endpoint_round_trip(tmp_path):
    folder = str(tmp_path)
    _slack_export(folder, messages=[
        {"type": "message", "user": "U1", "ts": "1.0",
         "text": "Bob, draft the kickoff plan by tomorrow."},
    ])
    r = client.post("/connectors/slack/sync",
                    json={"tenant_id": "acme", "folder": folder, "scope": "team:t-eng",
                          "owner": "alice"})
    assert r.status_code == 200, r.text
    assert r.json()["processed"] == 1


def test_mailbox_sync_endpoint_404_on_missing_folder():
    r = client.post("/connectors/mailbox/sync",
                    json={"tenant_id": "acme", "folder": "/no/such/folder/here",
                          "scope": "team:t-eng"})
    assert r.status_code == 404


def test_mailbox_sync_endpoint_422_without_scope():
    r = client.post("/connectors/mailbox/sync",
                    json={"tenant_id": "acme", "folder": "/tmp", "scope": ""})
    assert r.status_code == 422


def test_filesystem_connectors_disabled_in_server_mode(monkeypatch, tmp_path):
    """In a hosted deployment `folder` reads the SERVER's filesystem — an
    authenticated user could exfiltrate arbitrary .eml/.json. Both filesystem
    connectors must refuse (403) in server mode; hosted uses a provider API."""
    folder = str(tmp_path)
    _write(folder, "x.eml", _eml("x@corp.com", "Kickoff", "Bob, do the thing."))
    monkeypatch.setenv("LORE_SERVER_MODE", "1")
    for endpoint in ("/connectors/mailbox/sync", "/connectors/slack/sync"):
        r = client.post(endpoint,
                        json={"tenant_id": "acme", "folder": folder, "scope": "team:t-eng"})
        assert r.status_code == 403, f"{endpoint}: {r.status_code} {r.text}"


# --- Gmail API connector (live source, injected transport) ------------------
# The Gmail connector's only new part is "fetch the next messages"; everything
# else (parse_eml, extract, persist, watermark) is the shared substrate. So the
# tests inject a fake `fetch` that yields (gmail_id, raw .eml bytes) — the exact
# shape the real Gmail transport produces from `format=raw` — and exercise the
# whole path with no network and no OAuth.

def _fake_gmail(messages):
    """Build a fetch(access_token, query, limit) that yields (id, raw_bytes) from
    a list of (gmail_id, eml_text). Mirrors connectors.gmail_fetch's contract."""
    def fetch(access_token, query=None, limit=50):
        for gid, text in messages[: (limit or len(messages))]:
            yield gid, text.encode("utf-8")
    return fetch


def test_sync_gmail_extracts_todos_and_is_idempotent():
    conn = db.connect()
    db.bootstrap_schema(conn)
    tenancy.bootstrap_tenancy(conn)
    fetch = _fake_gmail([
        ("g-1", _eml("mid-1@corp.com", "Budget", "Bob, send the budget draft by Friday EOD.")),
        ("g-2", _eml("mid-2@corp.com", "Vendors", "Carol, review the vendor list.",
                     to="Carol Diaz <carol@corp.com>")),
    ])

    r1 = connectors.sync_gmail(conn, "acme", "team:t-gmail", access_token="tok",
                               owner="alice", fetch=fetch)
    assert r1["source"] == "gmail:me"
    assert r1["processed"] == 2 and r1["skipped"] == 0
    assert r1["todos_created"] >= 2
    assert "Bob Jones" in {t["assignee"] for t in r1["todos"]}   # header name-resolution
    assert all(t["source"] for t in r1["todos"])                 # provenance stamped

    # Re-sync: both gmail ids are watermarked → nothing new (idempotent).
    r2 = connectors.sync_gmail(conn, "acme", "team:t-gmail", access_token="tok",
                               owner="alice", fetch=fetch)
    assert r2["processed"] == 0 and r2["skipped"] == 2 and r2["todos_created"] == 0

    listed = todos_mod.list_todos(conn, "acme", ["team:t-gmail"], status="pending")
    assert len(listed) == r1["todos_created"]
    assert todos_mod.list_todos(conn, "acme", ["team:t-other"]) == []


def test_sync_gmail_watermarks_by_gmail_id_not_header():
    """Two Gmail messages that share a Message-ID header (forwards/duplicates) but
    have distinct Gmail ids are BOTH processed — the watermark keys on the stable
    Gmail id, which the connector prefers over the header."""
    conn = db.connect()
    db.bootstrap_schema(conn)
    tenancy.bootstrap_tenancy(conn)
    same_header = "dup@corp.com"
    fetch = _fake_gmail([
        ("g-a", _eml(same_header, "One", "Bob, ship the thing today.")),
        ("g-b", _eml(same_header, "Two", "Bob, ship the thing today.")),
    ])
    r = connectors.sync_gmail(conn, "acme", "team:t-gmail-dup", access_token="tok",
                              owner="alice", fetch=fetch)
    assert r["processed"] == 2 and r["skipped"] == 0


def test_sync_gmail_respects_limit():
    conn = db.connect()
    db.bootstrap_schema(conn)
    tenancy.bootstrap_tenancy(conn)
    fetch = _fake_gmail([(f"g{i}", _eml(f"{i}@corp.com", f"S{i}", "Bob, do it today."))
                         for i in range(3)])
    r = connectors.sync_gmail(conn, "acme", "team:t-gmail-lim", access_token="tok",
                              owner="a", fetch=fetch, limit=1)
    assert r["processed"] == 1


def test_gmail_fetch_requires_token():
    with pytest.raises(connectors.ConnectorError):
        list(connectors.gmail_fetch("", limit=5))


def test_gmail_sync_endpoint_round_trip(monkeypatch):
    """The endpoint uses the real code path (default fetch=gmail_fetch), so we
    monkeypatch the transport rather than pass a fetch — proving the wiring."""
    monkeypatch.setattr(connectors, "gmail_fetch",
                        _fake_gmail([("g-http", _eml("h@corp.com", "Kickoff",
                                     "Bob, draft the kickoff plan by tomorrow."))]))
    r = client.post("/connectors/gmail/sync",
                    json={"tenant_id": "acme", "scope": "team:t-gmail-ep",
                          "access_token": "fake-google-token", "owner": "alice"})
    assert r.status_code == 200, r.text
    assert r.json()["processed"] == 1 and r.json()["todos_created"] >= 1

    got = client.get("/todos", params={"tenant": "acme", "scopes": "team:t-gmail-ep",
                                       "status": "pending"})
    assert got.json()["count"] >= 1


def test_gmail_sync_endpoint_422_without_token():
    r = client.post("/connectors/gmail/sync",
                    json={"tenant_id": "acme", "scope": "team:t-eng", "access_token": ""})
    assert r.status_code == 422


def test_gmail_sync_endpoint_502_on_provider_error(monkeypatch):
    def _boom(access_token, query=None, limit=50):
        raise connectors.ConnectorError("Gmail rejected the access token")
        yield  # make it a generator
    monkeypatch.setattr(connectors, "gmail_fetch", _boom)
    r = client.post("/connectors/gmail/sync",
                    json={"tenant_id": "acme", "scope": "team:t-eng",
                          "access_token": "expired"})
    assert r.status_code == 502, r.text


def test_gmail_connector_allowed_in_server_mode(monkeypatch):
    """Unlike the filesystem connectors, Gmail reads no server FS — it uses the
    caller's own OAuth token — so it must NOT be 403'd in server mode. With a valid
    session + authorized scope it goes through."""
    from lore import auth
    conn = db.connect()
    db.bootstrap_schema(conn)
    tenancy.bootstrap_tenancy(conn)
    conn.execute("insert into orgs(id,name) values('o-gsrv','G') on conflict do nothing")
    conn.execute("insert into teams(id,org_id,name) values('t-gmail-srv','o-gsrv','G') "
                 "on conflict do nothing")
    uid = auth.upsert_user(conn, "u-gmail-srv", "g@corp.com", "G")
    conn.execute("insert into memberships(user_id,org_id,team_id,role,status) "
                 "values(%s,'o-gsrv','t-gmail-srv','member','active') "
                 "on conflict (user_id,team_id) do update set status='active'", (uid,))
    token = auth.issue_session_jwt(uid)

    monkeypatch.setenv("LORE_SERVER_MODE", "1")
    monkeypatch.setattr(connectors, "gmail_fetch",
                        _fake_gmail([("g-srv", _eml("s@corp.com", "S",
                                     "Bob, ship the thing today."))]))
    r = client.post("/connectors/gmail/sync",
                    json={"tenant_id": "acme", "scope": "team:t-gmail-srv",
                          "access_token": "tok"},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    assert r.json()["processed"] == 1
