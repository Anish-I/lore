import json

from lore.learn import extract_evidence, load_transcript


def _write(tmp_path, events):
    path = tmp_path / "session.jsonl"
    path.write_text("\n".join(json.dumps(event) for event in events), encoding="utf-8")
    return load_transcript(path)


def test_extract_evidence_verified_success_after_failure(tmp_path):
    transcript = _write(tmp_path, [
        {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": "running tests"}]}},
        {"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "is_error": True, "content": "1 failed; exit code 1"}]}},
        {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": "fixed it"}]}},
        {"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "is_error": False, "content": "12 passed; exit code 0"}]}},
    ])
    evidence = extract_evidence(transcript)
    assert evidence["outcome"] == "verified-success"
    assert evidence["error_to_success"] is True
    assert evidence["skill_allowed"] is True
    assert evidence["tool_exit_codes"] == [1, 0]


def test_extract_evidence_unverified_and_failed(tmp_path):
    unverified = _write(tmp_path, [
        {"type": "user", "message": {"role": "user", "content": "please refactor this"}},
        {"type": "assistant", "message": {"role": "assistant", "content": "done"}},
    ])
    assert extract_evidence(unverified)["outcome"] == "unverified"
    assert extract_evidence(unverified)["skill_allowed"] is False

    failed = _write(tmp_path, [
        {"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "is_error": True, "content": "build failed"}]}},
    ])
    assert extract_evidence(failed)["outcome"] == "failed"


def test_explicit_request_and_user_correction(tmp_path):
    transcript = _write(tmp_path, [
        {"type": "user", "message": {"role": "user", "content": "No, do not use that. Save this as a skill."}},
    ])
    evidence = extract_evidence(transcript)
    assert evidence["explicit_request"] is True
    assert evidence["skill_allowed"] is True
    assert evidence["user_corrections"]

