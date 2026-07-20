from pathlib import Path

from lore import db
from lore.learn import (
    approve_skill,
    list_skills,
    reject_skill,
    rollback_skill,
    skill_diff,
    stage_skill,
    sync_human_edits,
)


def _conn(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_HOME", str(tmp_path / ".lore"))
    monkeypatch.setenv("CLAUDE_HOME", str(tmp_path / ".claude"))
    conn = db._connect_url(f"sqlite:///{tmp_path / 'skills.db'}")
    db.bootstrap_schema(conn)
    return conn


def _body(name, session, marker="v1"):
    return (
        "---\n"
        f"name: {name}\n"
        "description: Reuse a verified workflow\n"
        "metadata:\n"
        "  created_by: lore-learn\n"
        f"  origin_session: {session}\n"
        "---\n"
        f"# Workflow\n\nRun {marker}.\n"
    )


def test_pending_create_diff_approve_and_rollback(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch)
    action = {"action": "skill_create", "name": "verified-flow", "description": "Reuse a verified workflow"}
    out = stage_skill(conn, tenant="t", owner="me", session_id="s1", action=action,
                      body=_body("verified-flow", "s1"))
    assert out["status"] == "pending"
    assert list_skills(conn, "t", pending_only=True)[0]["name"] == "verified-flow"
    assert "+# Workflow" in skill_diff(conn, "t", "verified-flow")["diff"]

    approved = approve_skill(conn, "t", "verified-flow")
    active = Path(tmp_path / ".claude" / "skills" / "verified-flow" / "SKILL.md")
    assert approved["status"] == "active" and active.exists()
    assert conn.execute(
        "select origin from skill_versions where skill_id=%s and version=1", (list_skills(conn, "t")[0]["id"],)
    ).fetchone()[0] == "create"

    patch = {"action": "skill_patch", "name": "verified-flow", "description": "Reuse a verified workflow"}
    auto = stage_skill(conn, tenant="t", owner="me", session_id="s2", action=patch,
                       body=_body("verified-flow", "s2", "v2"))
    assert auto["auto_applied"] is True and "v2" in active.read_text(encoding="utf-8")
    assert conn.execute(
        "select origin from skill_versions where skill_id=%s and version=2", (list_skills(conn, "t")[0]["id"],)
    ).fetchone()[0] == "patch"
    assert rollback_skill(conn, "t", "verified-flow", 1)["version"] == 1
    assert "v1" in active.read_text(encoding="utf-8")


def test_human_edit_freezes_patch_for_review(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch)
    create = {"action": "skill_create", "name": "guarded-flow", "description": "Reuse a verified workflow"}
    stage_skill(conn, tenant="t", owner="me", session_id="s1", action=create,
                body=_body("guarded-flow", "s1"))
    approve_skill(conn, "t", "guarded-flow")
    active = tmp_path / ".claude" / "skills" / "guarded-flow" / "SKILL.md"
    active.write_text(active.read_text(encoding="utf-8") + "\nHuman note.\n", encoding="utf-8")
    assert sync_human_edits(conn, "t", "s-review") == 1
    assert conn.execute(
        "select origin from skill_versions where skill_id=%s order by version desc limit 1",
        (list_skills(conn, "t")[0]["id"],),
    ).fetchone()[0] == "human"

    patch = {"action": "skill_patch", "name": "guarded-flow", "description": "Reuse a verified workflow"}
    out = stage_skill(conn, tenant="t", owner="me", session_id="s2", action=patch,
                      body=_body("guarded-flow", "s2", "candidate"))
    assert out["status"] == "pending_patch"
    row = list_skills(conn, "t", pending_only=True)[0]
    assert row["human_edited"] is True
    assert "Human note" in active.read_text(encoding="utf-8")
    assert reject_skill(conn, "t", "guarded-flow")["status"] == "rejected"
    assert list_skills(conn, "t", pending_only=True) == []
