import json
import threading

from fastapi.testclient import TestClient

from lore import learn
from lore.api import _conn, app


client = TestClient(app)


def _body(name, session):
    return (
        f"---\nname: {name}\ndescription: Review an API-created skill\nmetadata:\n"
        f"  created_by: lore-learn\n  origin_session: {session}\n---\n# Steps\n\nRun it.\n"
    )


def test_enqueue_returns_immediately_and_deduplicates(tmp_path, monkeypatch):
    tenant = "learn-api-enqueue"
    transcript = tmp_path / "session.jsonl"
    transcript.write_text(json.dumps(
        {"type": "user", "message": {"role": "user", "content": "remember this workflow"}}
    ), encoding="utf-8")
    called = threading.Event()
    monkeypatch.setattr(learn, "run_queued", lambda *_args: called.set())
    payload = {"session_id": "api-session", "transcript_path": str(transcript),
               "cwd": str(tmp_path), "scope": "private", "owner": "me", "tenant": tenant}

    first = client.post("/learn/enqueue", json=payload)
    assert first.status_code == 200 and first.json()["status"] == "queued"
    assert called.wait(1)
    second = client.post("/learn/enqueue", json=payload)
    assert second.status_code == 200
    assert second.json()["run_id"] == first.json()["run_id"]
    assert second.json()["duplicate"] is True
    _conn.execute("update learn_runs set status='failed' where id=%s", (first.json()["run_id"],))
    called.clear()
    retry = client.post("/learn/enqueue", json=payload)
    assert retry.status_code == 200 and retry.json()["duplicate"] is True
    assert called.wait(1)


def test_skill_review_endpoints_roundtrip(tmp_path, monkeypatch):
    tenant = "learn-api-skills"
    monkeypatch.setenv("LORE_HOME", str(tmp_path / ".lore"))
    monkeypatch.setenv("CLAUDE_HOME", str(tmp_path / ".claude"))
    action = {"action": "skill_create", "name": "api-flow",
              "description": "Review an API-created skill"}
    learn.stage_skill(_conn, tenant=tenant, owner="me", session_id="api-skill-session",
                      action=action, body=_body("api-flow", "api-skill-session"))

    status = client.get("/learn/status", params={"tenant": tenant})
    assert status.status_code == 200 and status.json()["pending_count"] == 1
    pending = client.get("/learn/skills", params={"tenant": tenant})
    assert pending.status_code == 200 and pending.json()["skills"][0]["name"] == "api-flow"
    diff = client.get("/learn/skills/api-flow/diff", params={"tenant": tenant})
    assert diff.status_code == 200 and "+# Steps" in diff.json()["diff"]

    approved = client.post("/learn/skills/api-flow/approve", json={"tenant": tenant})
    assert approved.status_code == 200 and approved.json()["status"] == "active"
    assert client.post("/learn/skills/api-flow/approve", json={"tenant": tenant}).status_code == 409
    rolled = client.post("/learn/skills/api-flow/rollback",
                         json={"tenant": tenant, "version": 1})
    assert rolled.status_code == 200 and rolled.json()["version"] == 1


def test_learn_endpoints_require_tenant():
    assert client.get("/learn/status").status_code == 422
    assert client.get("/learn/skills").status_code == 422


def test_status_exposes_recent_budget_skip():
    tenant = "learn-api-budget"
    _conn.execute(
        "insert into learn_runs(id,tenant_id,transcript_sha,status,skip_reason) "
        "values('learn-budget-run',%s,'learn-budget-sha','skipped','daily-token-budget')",
        (tenant,),
    )
    body = client.get("/learn/status", params={"tenant": tenant}).json()
    assert body["recent_runs"][0]["skip_reason"] == "daily-token-budget"
    assert "token limit reached" in body["notice"]


def test_server_mode_refuses_host_local_transcript_paths(monkeypatch):
    from lore import auth

    monkeypatch.setenv("LORE_SERVER_MODE", "1")
    monkeypatch.setenv("LORE_JWT_SECRET", "learn-server-test-secret-at-least-32-bytes")
    headers = {"Authorization": f"Bearer {auth.issue_session_jwt('learn-user')}"}
    response = client.post("/learn/enqueue", headers=headers, json={
        "session_id": "remote", "transcript_path": "C:/server/secrets.txt", "cwd": "",
        "scope": "private:learn-user", "owner": "spoofed", "tenant": "t",
    })
    assert response.status_code == 403
    assert response.json()["detail"] == "learn transcript review is local-mode only"
