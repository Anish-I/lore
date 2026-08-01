"""Personal-mode zero-param ingest (2026-07-28 spec, Phase B)."""
from fastapi.testclient import TestClient

import lore.api as api

client = TestClient(api.app)


def _mk_key(user, tenant, role="member"):
    r = client.post("/api/v1/keys", json={
        "user_id": user, "label": "t", "role": role, "tenant": tenant})
    assert r.status_code == 200, r.text
    return r.json()["key"]


def test_zero_param_ingest_lands_in_private_scope(monkeypatch):
    key = _mk_key("erin", "t-personal")
    monkeypatch.setenv("LORE_API_KEYS", "1")
    hdr = {"Authorization": f"Bearer {key}"}
    r = client.post("/api/v1/ingest", json={
        "source_id": "pm-note-1", "title": "Meeting notes",
        "text": "Talked to the assessor about the mill rate for next year."}, headers=hdr)
    assert r.status_code == 200, r.text
    assert r.json()["note_id"] == "pm-note-1"
    r = client.get("/api/v1/notes/pm-note-1", headers=hdr)
    assert r.status_code == 200, r.text
    note = r.json()
    assert note["scope"] == "private:erin"
    assert "mill rate" in note["body"]


def test_zero_param_ask_and_search(monkeypatch):
    key = _mk_key("finn", "t-personal2")
    monkeypatch.setenv("LORE_API_KEYS", "1")
    hdr = {"Authorization": f"Bearer {key}"}
    r = client.post("/api/v1/ingest", json={
        "source_id": "pm-ask-1", "title": "Budget",
        "text": "The board approved the fire department budget increase."}, headers=hdr)
    assert r.status_code == 200, r.text
    r = client.post("/api/v1/ask", json={"question": "what did the board approve?"},
                    headers=hdr)
    assert r.status_code == 200, r.text
    r = client.post("/api/v1/search", json={"query": "fire department budget"},
                    headers=hdr)
    assert r.status_code == 200, r.text


def test_service_mode_ingest_requires_identity(monkeypatch):
    monkeypatch.setenv("LORE_API_KEYS", "1")
    r = client.post("/api/v1/ingest", json={
        "source_id": "pm-note-2", "title": "x", "text": "y"})
    assert r.status_code == 401


def test_local_mode_still_requires_explicit_fields():
    r = client.post("/api/v1/ingest", json={
        "source_id": "pm-note-3", "title": "x", "text": "y"})
    assert r.status_code == 422
    r = client.post("/api/v1/ingest", json={
        "source_id": "pm-note-3", "title": "x", "text": "local legacy path body",
        "scope": "private", "owner": "me", "tenant": "t-local"})
    assert r.status_code == 200
