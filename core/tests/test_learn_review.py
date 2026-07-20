import json

from lore import db, learn as learn_module
from lore.learn import enqueue, review_run


def test_review_stages_verified_skill_with_two_calls(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_HOME", str(tmp_path / ".lore"))
    monkeypatch.setenv("CLAUDE_HOME", str(tmp_path / ".claude"))
    monkeypatch.setenv("LORE_LEARN_MIN_ITERS", "1")
    conn = db._connect_url(f"sqlite:///{tmp_path / 'review.db'}")
    db.bootstrap_schema(conn)
    transcript = tmp_path / "session.jsonl"
    transcript.write_text("\n".join([
        json.dumps({"type": "assistant", "message": {"role": "assistant", "content": "run tests"}}),
        json.dumps({"type": "user", "message": {"role": "user", "content": [
            {"type": "tool_result", "is_error": False, "content": "8 passed; exit code 0"}
        ]}}),
    ]), encoding="utf-8")
    queued = enqueue(conn, session_id="s-review", transcript_path=str(transcript), cwd=str(tmp_path),
                     scope="private", owner="me", tenant="t")
    calls = []

    def fake_llm(prompt):
        calls.append(prompt)
        if len(calls) == 1:
            return json.dumps({"actions": [{"action": "skill_create", "name": "test-workflow",
                "description": "Run the verified test workflow", "evidence_refs": ["e0"]}]})
        body = (
            "---\nname: test-workflow\ndescription: Run the verified test workflow\nmetadata:\n"
            "  created_by: lore-learn\n  origin_session: s-review\n---\n# Steps\n\nRun the tests.\n"
        )
        return json.dumps({"body": body})

    result = review_run(conn, queued["run_id"], str(transcript), llm_call=fake_llm)
    assert result["status"] == "done" and len(calls) == 2
    row = conn.execute(
        "select calls_made,input_chars,est_tokens,status from learn_runs where id=%s",
        (queued["run_id"],),
    ).fetchone()
    assert row[0] == 2 and row[1] > 0 and row[2] > 0 and row[3] == "done"


def test_unverified_actions_are_dropped(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_LEARN_MIN_ITERS", "1")
    conn = db._connect_url(f"sqlite:///{tmp_path / 'drop.db'}"); db.bootstrap_schema(conn)
    transcript = tmp_path / "session.jsonl"
    transcript.write_text(json.dumps(
        {"type": "user", "message": {"role": "user", "content": "finished refactor"}}
    ), encoding="utf-8")
    queued = enqueue(conn, session_id="s-drop", transcript_path=str(transcript), cwd=str(tmp_path),
                     scope="private", owner="me", tenant="t")
    calls = []

    def fake_llm(_prompt):
        calls.append(1)
        return json.dumps({"actions": [{"action": "skill_create", "name": "unsafe-flow",
            "description": "Should be dropped", "evidence_refs": []}]})

    result = review_run(conn, queued["run_id"], str(transcript), llm_call=fake_llm)
    assert result["actions"] == [] and len(calls) == 1
    assert conn.execute("select count(*) from skills").fetchone()[0] == 0


def test_invalid_author_output_gets_one_repair_call(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_HOME", str(tmp_path / ".lore"))
    monkeypatch.setenv("CLAUDE_HOME", str(tmp_path / ".claude"))
    monkeypatch.setenv("LORE_LEARN_MIN_ITERS", "1")
    conn = db._connect_url(f"sqlite:///{tmp_path / 'repair.db'}"); db.bootstrap_schema(conn)
    transcript = tmp_path / "repair.jsonl"
    transcript.write_text("\n".join([
        json.dumps({"type": "assistant", "message": {"role": "assistant", "content": "verify"}}),
        json.dumps({"type": "user", "message": {"role": "user", "content": [
            {"type": "tool_result", "is_error": False, "content": "4 passed; exit code 0"}
        ]}}),
    ]), encoding="utf-8")
    queued = enqueue(conn, session_id="s-repair", transcript_path=str(transcript), cwd=str(tmp_path),
                     scope="private", owner="me", tenant="t")
    calls = []

    def fake_llm(_prompt):
        calls.append(1)
        if len(calls) == 1:
            return json.dumps({"actions": [{"action": "skill_create", "name": "repair-flow",
                "description": "Use repaired model output", "evidence_refs": ["e0"]}]})
        if len(calls) == 2:
            return json.dumps({"body": "invalid"})
        return json.dumps({"body": (
            "---\nname: repair-flow\ndescription: Use repaired model output\nmetadata:\n"
            "  created_by: lore-learn\n  origin_session: s-repair\n---\n# Steps\n\nRun it.\n"
        )})

    result = review_run(conn, queued["run_id"], str(transcript), llm_call=fake_llm)
    assert result["status"] == "done" and len(calls) == 3
    assert conn.execute("select calls_made from learn_runs where id=%s", (queued["run_id"],)).fetchone()[0] == 3


def test_provider_call_obeys_remaining_wall_clock(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_LEARN_MIN_ITERS", "1")
    monkeypatch.setenv("LORE_LEARN_WALL_CLOCK_S", "2")
    conn = db._connect_url(f"sqlite:///{tmp_path / 'deadline.db'}"); db.bootstrap_schema(conn)
    transcript = tmp_path / "deadline.jsonl"
    transcript.write_text("\n".join([
        json.dumps({"type": "assistant", "message": {"role": "assistant", "content": "verify"}}),
        json.dumps({"type": "user", "message": {"role": "user", "content": [
            {"type": "tool_result", "is_error": False, "content": "2 passed; exit code 0"}
        ]}}),
    ]), encoding="utf-8")
    queued = enqueue(conn, session_id="s-deadline", transcript_path=str(transcript), cwd=str(tmp_path),
                     scope="private", owner="me", tenant="t")
    clock = [0.0]
    monkeypatch.setattr(learn_module.time, "monotonic", lambda: clock[0])

    def slow_llm(_prompt, timeout=None):
        assert timeout == 2
        clock[0] = 3.0
        return json.dumps({"actions": []})

    result = review_run(conn, queued["run_id"], str(transcript), llm_call=slow_llm)
    assert result["status"] == "timeout"
    assert conn.execute("select calls_made,status from learn_runs where id=%s", (queued["run_id"],)).fetchone() == (1, "timeout")
