"""Mailbox connector: .eml parsing + idempotent sync into the to-dos pipeline.

No LLM and no OAuth — the heuristic extractor runs under VAULT_FAKE, and the
source is a local folder of .eml files, so the whole enterprise "email → to-dos"
path is exercised end-to-end here.
"""
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


def test_mailbox_sync_endpoint_404_on_missing_folder():
    r = client.post("/connectors/mailbox/sync",
                    json={"tenant_id": "acme", "folder": "/no/such/folder/here",
                          "scope": "team:t-eng"})
    assert r.status_code == 404


def test_mailbox_sync_endpoint_422_without_scope():
    r = client.post("/connectors/mailbox/sync",
                    json={"tenant_id": "acme", "folder": "/tmp", "scope": ""})
    assert r.status_code == 422
