"""Validation gate for the auto-apply patch path (SkillOpt-style no-regression check).

The gate is the only thing standing between an autonomously-authored patch and a
live skill file. It must be conservative: when in doubt it downgrades to human
review, and it never auto-applies something that is staged today.
"""
from lore import db
from lore.learn import (
    approve_skill,
    evaluate_gate,
    gate_patch,
    probe_coverage,
    stage_skill,
    _probe_terms,
)


# --- pure decision core -----------------------------------------------------

def _cfg(**over):
    base = {"gate": True, "gate_strict": False, "gate_min_probes": 3}
    base.update(over)
    return base


def test_disabled_gate_always_passes():
    verdict = evaluate_gate(baseline=1.0, candidate=0.0, probes=0, cfg=_cfg(gate=False))
    assert verdict["pass"] is True
    assert verdict["reason"] == "disabled"


def test_insufficient_probes_fails_safe_to_human():
    # Too few probes to judge -> do NOT auto-apply; route to a human.
    verdict = evaluate_gate(baseline=0.5, candidate=0.9, probes=2, cfg=_cfg(gate_min_probes=3))
    assert verdict["pass"] is False
    assert verdict["reason"] == "insufficient-probes"


def test_no_regression_mode_accepts_equal_coverage():
    verdict = evaluate_gate(baseline=0.6, candidate=0.6, probes=5, cfg=_cfg(gate_strict=False))
    assert verdict["pass"] is True
    assert verdict["reason"] == "no-regression"


def test_no_regression_mode_rejects_lower_coverage():
    verdict = evaluate_gate(baseline=0.8, candidate=0.5, probes=5, cfg=_cfg(gate_strict=False))
    assert verdict["pass"] is False
    assert verdict["reason"] == "regression"
    assert verdict["delta"] < 0


def test_strict_mode_requires_strict_improvement():
    equal = evaluate_gate(baseline=0.6, candidate=0.6, probes=5, cfg=_cfg(gate_strict=True))
    assert equal["pass"] is False
    better = evaluate_gate(baseline=0.6, candidate=0.7, probes=5, cfg=_cfg(gate_strict=True))
    assert better["pass"] is True


# --- lexical scorer (v1 seam) ----------------------------------------------

def test_probe_coverage_is_fraction_of_terms_present():
    terms = ["deploy", "migrate", "rollback", "checkpoint"]
    assert probe_coverage("we deploy and migrate", terms) == 0.5
    assert probe_coverage("nothing relevant here", terms) == 0.0
    assert probe_coverage("deploy migrate rollback checkpoint", terms) == 1.0


def test_probe_coverage_empty_terms_is_zero():
    assert probe_coverage("anything", []) == 0.0


def test_probe_terms_drawn_from_evidence_refs_dedup_and_filtered():
    evidence = {"refs": [
        {"id": "e0", "kind": "tool-result", "text": "database migration rollback verified"},
        {"id": "e1", "kind": "user-correction", "text": "no, the checkpoint step is required"},
    ]}
    terms = _probe_terms(evidence)
    assert "database" in terms and "checkpoint" in terms
    # short/stopword tokens are filtered; terms are unique
    assert all(len(t) >= 4 for t in terms)
    assert len(terms) == len(set(terms))


# --- gate_patch orchestration ----------------------------------------------

def _evidence(text):
    return {"refs": [{"id": "e0", "kind": "tool-result", "text": text}], "skill_allowed": True}


def test_gate_patch_passes_when_candidate_retains_coverage():
    ev = _evidence("deploy migrate database rollback checkpoint verified")
    current = "old body: deploy migrate database rollback checkpoint"
    candidate = "new body: deploy migrate database rollback checkpoint plus extras"
    verdict = gate_patch(candidate, current, evidence=ev, cfg=_cfg())
    assert verdict["pass"] is True


def test_gate_patch_fails_when_candidate_drops_coverage():
    ev = _evidence("deploy migrate database rollback checkpoint verified")
    current = "old body: deploy migrate database rollback checkpoint verified"
    candidate = "new body: totally unrelated content about something else"
    verdict = gate_patch(candidate, current, evidence=ev, cfg=_cfg())
    assert verdict["pass"] is False
    assert verdict["reason"] == "regression"


# --- integration with stage_skill auto-apply path ---------------------------

def _conn(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_HOME", str(tmp_path / ".lore"))
    monkeypatch.setenv("CLAUDE_HOME", str(tmp_path / ".claude"))
    conn = db._connect_url(f"sqlite:///{tmp_path / 'skills.db'}")
    db.bootstrap_schema(conn)
    return conn


def _body(name, session, extra=""):
    return (
        "---\n"
        f"name: {name}\n"
        "description: Reuse a verified workflow\n"
        "metadata:\n"
        "  created_by: lore-learn\n"
        f"  origin_session: {session}\n"
        "---\n"
        f"# Workflow\n\ndeploy migrate database rollback checkpoint verified {extra}\n"
    )


def _bad_body(name, session):
    return (
        "---\n"
        f"name: {name}\n"
        "description: Reuse a verified workflow\n"
        "metadata:\n"
        "  created_by: lore-learn\n"
        f"  origin_session: {session}\n"
        "---\n"
        "# Workflow\n\ntotally unrelated content about something else entirely\n"
    )


def _setup_active(conn):
    action = {"action": "skill_create", "name": "flow", "description": "Reuse a verified workflow"}
    stage_skill(conn, tenant="t", owner="me", session_id="s1", action=action, body=_body("flow", "s1"))
    approve_skill(conn, "t", "flow")


def test_regressing_patch_is_downgraded_to_pending(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch)
    _setup_active(conn)
    active = tmp_path / ".claude" / "skills" / "flow" / "SKILL.md"
    before = active.read_text(encoding="utf-8")

    patch = {"action": "skill_patch", "name": "flow", "description": "Reuse a verified workflow"}
    ev = _evidence("deploy migrate database rollback checkpoint verified")
    out = stage_skill(conn, tenant="t", owner="me", session_id="s2", action=patch,
                      body=_bad_body("flow", "s2"), evidence=ev, cfg=_cfg())

    assert out["status"] == "pending_patch"
    assert out.get("auto_applied") is not True
    assert active.read_text(encoding="utf-8") == before  # live file untouched
    assert out["gate"]["pass"] is False


def test_clean_patch_still_auto_applies_when_gate_passes(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch)
    _setup_active(conn)
    active = tmp_path / ".claude" / "skills" / "flow" / "SKILL.md"

    patch = {"action": "skill_patch", "name": "flow", "description": "Reuse a verified workflow"}
    ev = _evidence("deploy migrate database rollback checkpoint verified")
    out = stage_skill(conn, tenant="t", owner="me", session_id="s2", action=patch,
                      body=_body("flow", "s2", extra="and more detail"), evidence=ev, cfg=_cfg())

    assert out["auto_applied"] is True
    assert "and more detail" in active.read_text(encoding="utf-8")


def test_gate_off_preserves_todays_auto_apply(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch)
    _setup_active(conn)

    # gate disabled: even a regressing patch auto-applies exactly like today
    patch = {"action": "skill_patch", "name": "flow", "description": "Reuse a verified workflow"}
    ev = _evidence("deploy migrate database rollback checkpoint verified")
    out = stage_skill(conn, tenant="t", owner="me", session_id="s2", action=patch,
                      body=_bad_body("flow", "s2"), evidence=ev, cfg=_cfg(gate=False))

    assert out["auto_applied"] is True
