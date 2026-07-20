import json
from pathlib import Path

from lore import db
from lore.learn import approve_skill, enqueue, list_skills, review_run


def _transcript(path: Path, prompt: str, *, result: str | None = None) -> Path:
    events = [
        {"type": "user", "message": {"role": "user", "content": prompt}},
        {"type": "assistant", "message": {"role": "assistant", "content": "Working on it."}},
    ]
    if result is not None:
        events.append({
            "type": "user",
            "message": {"role": "user", "content": [
                {"type": "tool_result", "is_error": False, "content": result},
            ]},
        })
    path.write_text("\n".join(json.dumps(event) for event in events), encoding="utf-8")
    return path


def _skill_body(session_id: str, instruction: str) -> str:
    return (
        "---\n"
        "name: renderer-verification\n"
        "description: Verify renderer changes before reporting success\n"
        "metadata:\n"
        "  created_by: lore-learn\n"
        f"  origin_session: {session_id}\n"
        "---\n"
        "# Renderer verification\n\n"
        f"{instruction}\n"
    )


def _queue(conn, transcript: Path, session_id: str):
    return enqueue(
        conn,
        session_id=session_id,
        transcript_path=str(transcript),
        cwd=str(transcript.parent),
        scope="private",
        owner="tester",
        tenant="cross-session",
    )


def test_distinct_prompts_before_and_after_skill_approval(tmp_path, monkeypatch):
    """A learned skill is invisible before approval and active in later sessions."""
    monkeypatch.setenv("LORE_HOME", str(tmp_path / ".lore"))
    monkeypatch.setenv("CLAUDE_HOME", str(tmp_path / ".claude"))
    monkeypatch.setenv("LORE_LEARN_MIN_ITERS", "1")
    conn = db._connect_url(f"sqlite:///{tmp_path / 'cross-session.db'}")
    db.bootstrap_schema(conn)
    active = tmp_path / ".claude" / "skills" / "renderer-verification" / "SKILL.md"

    # Ask 1: an ordinary prompt before learning creates no skill.
    before = _transcript(
        tmp_path / "before.jsonl",
        "How should I check a renderer change before I say it is finished?",
    )
    before_prompts = []

    def no_action(prompt):
        before_prompts.append(prompt)
        return json.dumps({"actions": []})

    before_run = _queue(conn, before, "session-before")
    assert review_run(conn, before_run["run_id"], str(before), llm_call=no_action)["actions"] == []
    assert "How should I check a renderer change" in before_prompts[0]
    assert list_skills(conn, "cross-session") == []
    assert not active.exists()

    # Ask 2: a different, explicit request with verified evidence stages a draft.
    learning = _transcript(
        tmp_path / "learning.jsonl",
        "Remember this as a skill: rebuild the renderer, lint it, then run desktop tests.",
        result="renderer build succeeded; lint passed; 47 tests passed; exit code 0",
    )
    learning_calls = []

    def create_skill(prompt):
        learning_calls.append(prompt)
        if len(learning_calls) == 1:
            return json.dumps({"actions": [{
                "action": "skill_create",
                "name": "renderer-verification",
                "description": "Verify renderer changes before reporting success",
                "evidence_refs": ["e0"],
            }]})
        return json.dumps({"body": _skill_body(
            "session-learning",
            "Run the renderer build, lint, and desktop tests in that order.",
        )})

    learning_run = _queue(conn, learning, "session-learning")
    result = review_run(conn, learning_run["run_id"], str(learning), llm_call=create_skill)
    assert result["actions"][0]["result"]["status"] == "pending"
    assert len(learning_calls) == 2
    assert not active.exists(), "pending skills must not affect later prompts before approval"

    # Approval is the exact before/after boundary for Claude Code discovery.
    approved = approve_skill(conn, "cross-session", "renderer-verification")
    assert approved["status"] == "active"
    assert active.exists()
    assert "build, lint, and desktop tests" in active.read_text(encoding="utf-8")

    # Ask 3: a later, differently-worded verified session patches the agent-owned skill.
    after = _transcript(
        tmp_path / "after.jsonl",
        "For UI work, also verify the generated renderer output has no stale files.",
        result="compiled output checked; 47 tests passed; exit code 0",
    )
    after_calls = []

    def patch_skill(prompt):
        after_calls.append(prompt)
        if len(after_calls) == 1:
            return json.dumps({"actions": [{
                "action": "skill_patch",
                "name": "renderer-verification",
                "description": "Verify renderer changes before reporting success",
                "evidence_refs": ["e0"],
            }]})
        assert "Current body for patching" in prompt
        return json.dumps({"body": _skill_body(
            "session-after",
            "Build, lint, test, and inspect generated renderer output for stale files.",
        )})

    after_run = _queue(conn, after, "session-after")
    patched = review_run(conn, after_run["run_id"], str(after), llm_call=patch_skill)
    assert patched["actions"][0]["result"]["auto_applied"] is True
    assert "stale files" in active.read_text(encoding="utf-8")

    # Ask 4: a human edit is detected on the next eligible review even with no patch action.
    active.write_text(active.read_text(encoding="utf-8") + "\nHuman-owned exception.\n", encoding="utf-8")
    later = _transcript(
        tmp_path / "later.jsonl",
        "Check an unrelated backend migration and keep existing human instructions intact.",
        result="migration tests passed; exit code 0",
    )
    later_run = _queue(conn, later, "session-later")
    review_run(conn, later_run["run_id"], str(later), llm_call=lambda _prompt: '{"actions":[]}')
    skill = list_skills(conn, "cross-session")[0]
    assert skill["human_edited"] is True
    assert "Human-owned exception" in active.read_text(encoding="utf-8")
