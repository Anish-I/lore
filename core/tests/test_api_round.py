"""Round API surface: file upload, bulk export, context-pack personal mode."""
import io

from fastapi.testclient import TestClient

import lore.api as api

client = TestClient(api.app)
TENANT = "t-round"


def _key(user, role="member"):
    r = client.post("/api/v1/keys", json={
        "user_id": user, "label": user, "role": role, "tenant": TENANT})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['key']}"}


def test_file_upload_extracts_and_indexes(monkeypatch):
    key = _key("rd-alice", role="admin")
    monkeypatch.setenv("LORE_API_KEYS", "1")
    md = b"# Road Bond\n\nThe council approved the road bond referendum for November.\n"
    r = client.post("/api/v1/files",
                    files={"file": ("road-bond.md", io.BytesIO(md), "text/markdown")},
                    data={"source_id": "rd-file-1"}, headers=key)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["note_id"] == "rd-file-1" and body["chunks"] >= 1
    n = client.get("/api/v1/notes/rd-file-1", headers=key)
    assert n.status_code == 200 and "referendum" in n.json()["body"]
    assert n.json()["scope"] == "private:rd-alice"


def test_file_upload_rejects_bad_type_and_needs_auth(monkeypatch):
    key = _key("rd-bob")
    monkeypatch.setenv("LORE_API_KEYS", "1")
    r = client.post("/api/v1/files",
                    files={"file": ("evil.exe", io.BytesIO(b"MZ"), "application/x-msdownload")},
                    headers=key)
    assert r.status_code == 422
    r = client.post("/api/v1/files",
                    files={"file": ("x.md", io.BytesIO(b"# hi"), "text/markdown")})
    assert r.status_code == 401


def test_bulk_export_is_scoped_to_caller(monkeypatch):
    alice = _key("rd-carol", role="admin")
    outsider = _key("rd-dan")
    monkeypatch.setenv("LORE_API_KEYS", "1")
    r = client.post("/api/v1/ingest", json={
        "source_id": "rd-exp-1", "title": "Secret",
        "text": "Carol's private budget memo."}, headers=alice)
    assert r.status_code == 200, r.text
    got = client.get("/api/v1/export", headers=alice).json()
    assert any(n["id"] == "rd-exp-1" for n in got["notes"])
    assert all(n["scope"].startswith(("private:rd-carol", "s:", "team:"))
               for n in got["notes"])
    got = client.get("/api/v1/export", headers=outsider).json()
    assert not any(n["id"] == "rd-exp-1" for n in got["notes"])


def test_context_pack_personal_mode(monkeypatch):
    key = _key("rd-erin")
    monkeypatch.setenv("LORE_API_KEYS", "1")
    r = client.post("/api/v1/ingest", json={
        "source_id": "rd-cp-1", "title": "Fee schedule",
        "text": "Recording fee is $60 for the first page and $5 each additional."},
        headers=key)
    assert r.status_code == 200, r.text
    r = client.post("/api/v1/context-pack",
                    json={"task": "answer a question about recording fees"},
                    headers=key)
    assert r.status_code == 200, r.text
