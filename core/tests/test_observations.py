"""Structured observations (#4): deterministic file capture, strict-JSON
garnish with fallback, path-key matching, API round trip."""
import json

from fastapi.testclient import TestClient

from lore import db, observations
from lore.api import app
from lore.learn import load_transcript

client = TestClient(app)


def _conn():
    c = db.connect()
    db.bootstrap_schema(c)
    return c


def _write_transcript(tmp_path, lines):
    p = tmp_path / "session.jsonl"
    p.write_text("\n".join(json.dumps(x) for x in lines), encoding="utf-8")
    return str(p)


def _tu(name, **inp):
    return {"type": "tool_use", "name": name, "input": inp}


def _fixture(tmp_path):
    """A session that reads recall.py, edits sections.py, sees a failure then
    a verified pass — classic bugfix shape."""
    return _write_transcript(tmp_path, [
        {"message": {"role": "user", "content": "fix the auto-apply gate bug"}},
        {"message": {"role": "assistant", "content": [
            _tu("Read", file_path="C:\\repo\\core\\lore\\recall.py"),
            _tu("Grep", path="C:\\repo\\core"),
        ]}},
        {"message": {"role": "user", "content": [
            {"type": "tool_result", "content": "exit code 1\nAssertionError"}]}},
        {"message": {"role": "assistant", "content": [
            _tu("Edit", file_path="C:\\repo\\core\\lore\\sections.py"),
            _tu("Write", file_path="C:/repo/core/tests/test_sections.py"),
            {"type": "tool_use", "name": "Bash", "input": {"command": "pytest"}},
        ]}},
        {"message": {"role": "user", "content": [
            {"type": "tool_result", "content": "32 passed, exit code 0"}]}},
    ])


# ---------------------------------------------------------------------------
# deterministic capture
# ---------------------------------------------------------------------------

def test_tool_use_paths_captured(tmp_path):
    t = load_transcript(_fixture(tmp_path))
    reads, writes = observations.collect_file_activity(t)
    assert "C:\\repo\\core\\lore\\recall.py" in reads
    assert "C:\\repo\\core" in reads                      # Grep dir kept
    assert {"C:\\repo\\core\\lore\\sections.py", "C:/repo/core/tests/test_sections.py"} == set(writes)
    # Bash tool (no file_path) contributes nothing.
    assert all("pytest" not in p for p in reads + writes)


def test_modified_wins_over_read(tmp_path):
    p = _write_transcript(tmp_path, [
        {"message": {"role": "assistant", "content": [
            _tu("Read", file_path="a/b.py"), _tu("Edit", file_path="A\\B.PY")]}},
    ])
    reads, writes = observations.collect_file_activity(load_transcript(p))
    assert reads == [] and len(writes) == 1               # one file, one bucket


def test_malformed_tool_use_tolerated(tmp_path):
    p = _write_transcript(tmp_path, [
        {"message": {"role": "assistant", "content": [
            {"type": "tool_use", "name": "Read"},                       # no input
            {"type": "tool_use", "input": {"file_path": 42}},           # non-str
            {"type": "tool_use", "name": "Edit", "input": {"file_path": "ok.py"}},
        ]}},
    ])
    reads, writes = observations.collect_file_activity(load_transcript(p))
    assert writes == ["ok.py"] and reads == []


def test_path_key_last_two_segments():
    assert observations.path_key("C:\\Users\\x\\repo\\core\\lore\\recall.py") == "lore/recall.py"
    assert observations.path_key("core/lore/recall.py") == "lore/recall.py"
    assert observations.path_key("recall.py") == "recall.py"
    assert observations.path_key("") == ""


# ---------------------------------------------------------------------------
# garnish parsing
# ---------------------------------------------------------------------------

def test_parse_observation_json_strict():
    ok = observations.parse_observation_json(
        'noise {"type":"BugFix","summary":"fixed  the gate","facts":["a","b"],'
        '"concepts":["hooks"]} trailing')
    assert ok == {"type": "bugfix", "summary": "fixed the gate",
                  "facts": ["a", "b"], "concepts": ["hooks"]}
    assert observations.parse_observation_json('{"type":"epic","summary":"x"}') is None
    assert observations.parse_observation_json('{"type":"bugfix"}') is None
    assert observations.parse_observation_json("not json") is None


def test_deterministic_fallback_types():
    ev_fail_then_pass = {"outcome": "verified-success", "tool_exit_codes": [1, 0], "refs": []}
    assert observations.deterministic_observation(ev_fail_then_pass, ["x.py"], "fix it")["type"] == "bugfix"
    ev_clean = {"outcome": "verified-success", "tool_exit_codes": [0], "refs": []}
    assert observations.deterministic_observation(ev_clean, ["x.py"], "tidy")["type"] == "refactor"
    ev_read_only = {"outcome": "unverified", "tool_exit_codes": [], "refs": []}
    assert observations.deterministic_observation(ev_read_only, [], "look around")["type"] == "discovery"


# ---------------------------------------------------------------------------
# store + query + API
# ---------------------------------------------------------------------------

def test_extract_store_and_file_query(tmp_path):
    tenant = "obs-t1"
    conn = _conn()
    result = observations.extract_and_store(
        conn, tenant=tenant, session_id="sess-1",
        transcript_path=_fixture(tmp_path),
        llm_call=lambda prompt: '{"type":"bugfix","summary":"gate fixed",'
                                '"facts":["gate now shared"],"concepts":["hooks"]}')
    assert result["type"] == "bugfix" and result["files_modified"] == 2

    # The hook's exact query shape: ABSOLUTE path from a different machine root
    # still matches via the last-two-segment key.
    hits = observations.for_file(conn, tenant=tenant,
                                 file_path="D:/elsewhere/core/lore/sections.py")
    assert len(hits) == 1
    assert hits[0]["summary"] == "gate fixed"
    assert hits[0]["outcome"] == "verified-success"

    # Read-only files are anchored too.
    assert observations.for_file(conn, tenant=tenant,
                                 file_path="core/lore/recall.py")

    # Unrelated file: nothing.
    assert observations.for_file(conn, tenant=tenant, file_path="zzz/nope.py") == []


def test_llm_garbage_falls_back(tmp_path):
    tenant = "obs-t2"
    conn = _conn()
    result = observations.extract_and_store(
        conn, tenant=tenant, session_id="sess-2",
        transcript_path=_fixture(tmp_path),
        llm_call=lambda prompt: "<observation>fragile xml</observation>")
    assert result["type"] == "bugfix"          # deterministic fallback typed it
    assert result["summary"].startswith("fix the auto-apply")


def test_api_round_trip(tmp_path):
    tenant = "obs-t3"
    conn = _conn()
    observations.extract_and_store(
        conn, tenant=tenant, session_id="sess-3",
        transcript_path=_fixture(tmp_path),
        llm_call=lambda prompt: '{"type":"decision","summary":"api works",'
                                '"facts":[],"concepts":[]}')
    r = client.get("/observations", params={
        "tenant": tenant, "file": "core/lore/sections.py", "limit": 3})
    assert r.status_code == 200
    obs = r.json()["observations"]
    assert len(obs) == 1 and obs[0]["type"] == "decision"

    r = client.get("/observations", params={"tenant": tenant, "session": "sess-3"})
    assert r.status_code == 200 and len(r.json()["observations"]) == 1

    # exactly-one-of guard
    assert client.get("/observations", params={"tenant": tenant}).status_code == 422
    assert client.get("/observations", params={
        "tenant": tenant, "file": "x", "session": "y"}).status_code == 422
