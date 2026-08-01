"""Correspondence drafts: style-matched, context-grounded email drafting.

Contract (draft_email.py + POST /emails/draft): style samples come from the
owner's in-scope correspondence emails (owner-sent preferred when the address
is known); recipient history is ACL-scoped through people.py; facts come only
from the caller-supplied chunks; the result is a DRAFT — nothing is sent.
"""
import json

from lore import db
from lore.draft_email import (
    DraftError, compose, draft_prompt, parse_draft, style_samples,
)

_SCOPE = "private"
TENANT = "draft-email-t"


def _conn():
    c = db.connect()
    db.bootstrap_schema(c)
    return c


def _email_note(conn, nid, title, body, role="correspondence", scope=_SCOPE):
    conn.execute(
        """insert into notes(id, tenant_id, owner_id, scope_id, title, body,
                             source_type, updated_at)
           values(%s,%s,'me',%s,%s,%s,'email',now()) on conflict (id) do nothing""",
        (nid, TENANT, scope, title, body))
    if role:
        conn.execute(
            "insert into note_tags(note_id, tenant_id, tag, kind, source) "
            "values(%s,%s,%s,'role','llm') on conflict do nothing",
            (nid, TENANT, role))


_SENT = ("From: Donna Hosey <clerk@town.gov>\nTo: Janet <j@aol.com>\n\n"
         "Hi Janet,\n\nHappy to help with this. The license renews in June.\n\n"
         "Warm regards,\nDonna")
_RECEIVED = ("From: Janet Pruett <j@aol.com>\nTo: Donna <clerk@town.gov>\n\n"
             "Thanks Donna! One more question about the kennel permit.")
_BULK = ("From: news@list.com\nTo: Donna <clerk@town.gov>\n\n"
         "WEEKLY DIGEST: ten headlines you missed!")


def test_style_samples_prefer_owner_sent_and_skip_bulk():
    conn = _conn()
    _email_note(conn, "de-sent", "Re: dog license", _SENT)
    _email_note(conn, "de-recv", "dog license question", _RECEIVED)
    _email_note(conn, "de-bulk", "Weekly digest", _BULK, role="bulk")

    samples = style_samples(conn, TENANT, [_SCOPE], owner_email="clerk@town.gov")
    ids = [s["note_id"] for s in samples]
    assert ids[0] == "de-sent"                    # owner-sent ranked first
    assert "de-bulk" not in ids                   # bulk never a style source
    assert "Warm regards" in samples[0]["excerpt"]
    assert "From:" not in samples[0]["excerpt"]   # headers stripped, prose kept

    # scope discipline: nothing leaks from scopes the caller doesn't hold
    assert style_samples(conn, TENANT, ["team:other"]) == []


def test_prompt_carries_style_context_and_json_contract():
    style = [{"note_id": "s1", "title": "Re: fees", "excerpt": "Warm regards,\nDonna"}]
    chunks = [{"title": "Dog Licenses", "text": "Renewals are due June 30 at $8."}]
    p = draft_prompt("reply to Janet about renewing her dog license", style, chunks)
    assert "OWNER'S OWN VOICE" in p
    assert "Warm regards" in p
    assert "due June 30" in p
    assert "STRICT JSON" in p
    assert "[CHECK:" in p                          # missing-fact escape hatch


def test_parse_draft_strict_and_fallback():
    ok = parse_draft('```json\n{"subject":"Dog license","body":"Hi Janet,..."}\n```')
    assert ok == {"subject": "Dog license", "body": "Hi Janet,..."}
    loose = parse_draft("Dear Janet, here is the draft.")
    assert loose["body"].startswith("Dear Janet")
    assert parse_draft("") is None


def test_compose_grounds_and_returns_draft():
    conn = _conn()
    _email_note(conn, "de2-sent", "Re: minutes", _SENT)

    def fake_llm(prompt):
        assert "Renewals are due June 30" in prompt      # context reached the model
        assert "Warm regards" in prompt                  # style reached the model
        return json.dumps({"subject": "Dog license renewal",
                           "body": "Hi Janet,\n\nYour renewal is due June 30.\n\nWarm regards,\nDonna"})

    out = compose(conn, TENANT, [_SCOPE], "reply to Janet about her dog license",
                  [{"title": "Dog Licenses", "text": "Renewals are due June 30 at $8."}],
                  llm_call=fake_llm)
    assert out["subject"] == "Dog license renewal"
    assert "Warm regards" in out["body"]
    assert "de2-sent" in out["style_note_ids"]


def test_compose_without_provider_raises(monkeypatch):
    import lore.draft_email as de
    monkeypatch.setattr(de, "provider_available", lambda p: False)
    conn = _conn()
    try:
        compose(conn, TENANT, [_SCOPE], "write anything", [])
        raise AssertionError("expected DraftError")
    except DraftError:
        pass


def test_endpoint_returns_draft_with_citations(monkeypatch):
    from fastapi.testclient import TestClient
    import lore.draft_email as de
    from lore.api import app

    def fake_resolve(provider=None):
        return (lambda prompt: json.dumps(
            {"subject": "s", "body": "Hi,\n\ndraft body.\n\nWarm regards"})), "fake"
    monkeypatch.setattr(de, "_resolve_llm", fake_resolve)

    conn = _conn()
    _email_note(conn, "de3-sent", "Re: hours", _SENT)
    client = TestClient(app)
    # ingest through the API so the vector collection exists and recall has
    # something to cite (same pattern as test_api.py)
    r = client.post("/ingest", json={
        "source_id": "de3-hours", "title": "Office hours",
        "text": "Town clerk office hours are Monday to Thursday 9am-4pm.",
        "scope": _SCOPE, "owner": "me", "tenant": TENANT})
    assert r.status_code == 200, r.text
    r = client.post("/api/v1/emails/draft", json={
        "ask": "tell Janet the office hours",
        "principal_scopes": [_SCOPE], "tenant_id": TENANT})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["body"].startswith("Hi,")
    assert "citations" in data and "scopes_used" in data
    assert data["engine"] == "fake"
