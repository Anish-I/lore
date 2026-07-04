"""/trace follow-up contract: accepts optional `history`, returns `citations`
where every entry carries the source note's title + scope (the chat's
per-citation "PairStrategy · Private" labels), and answers even without a
sparse model (VAULT_FAKE fallback) instead of dead-ending."""
from fastapi.testclient import TestClient

from lore import db, llm
from lore.api import app

client = TestClient(app)


def _seed(tenant, tmp_path):
    for fname, scope, body in [
        ("pair-strategy.md", "private", "# PairStrategy\n\nKalshi pair sizing strategy and limits.\n"),
        ("roadmap.md", "team", "# Roadmap\n\nTeam roadmap for the pair strategy rollout.\n"),
    ]:
        p = tmp_path / fname
        p.write_text(body, encoding="utf-8")
        r = client.post("/reindex", json={"path": str(p), "owner_id": "me",
                                          "scope_id": scope, "tenant_id": tenant})
        assert r.status_code == 200


def test_trace_accepts_history_and_answers(tmp_path):
    tenant = "trace-history"
    db.bootstrap_schema(db.connect())
    _seed(tenant, tmp_path)

    r = client.post("/trace", json={
        "question": "what are the limits for that strategy?",
        "principal_scopes": ["private", "team"], "tenant_id": tenant,
        "history": [
            {"role": "user", "text": "tell me about the pair strategy"},
            {"role": "assistant", "text": "PairStrategy sizes Kalshi pairs ..."},
        ],
    })
    assert r.status_code == 200
    body = r.json()
    assert "error" not in body
    assert body["answer"]
    assert body["scopes_asked"] == ["private", "team"]
    assert isinstance(body["final"], list) and body["final"]


def test_trace_citations_carry_note_scope_and_title(tmp_path):
    tenant = "trace-citations"
    _seed(tenant, tmp_path)

    body = client.post("/trace", json={
        "question": "pair strategy sizing", "principal_scopes": ["private", "team"],
        "tenant_id": tenant}).json()
    cites = body["citations"]
    assert cites, "trace must return citations"
    for c in cites:
        assert c["note_id"]
        assert c["title"]
        assert c["scope"] in ("private", "team")
    by_title = {c["title"]: c["scope"] for c in cites}
    if "PairStrategy" in by_title:
        assert by_title["PairStrategy"] == "private"
    if "Roadmap" in by_title:
        assert by_title["Roadmap"] == "team"
    # Note-level scope is stamped back onto the trace's final rows too.
    scoped = {f["note_id"]: f.get("scope") for f in body["final"]}
    for c in cites:
        assert scoped.get(c["note_id"]) == c["scope"]


def test_trace_without_history_unchanged(tmp_path):
    tenant = "trace-nohistory"
    _seed(tenant, tmp_path)
    body = client.post("/trace", json={
        "question": "pair strategy", "principal_scopes": ["private", "team"],
        "tenant_id": tenant}).json()
    assert body["answer"] and "citations" in body


def test_llm_history_block_keeps_last_six_turns():
    turns = [{"role": "user", "text": f"q{i}"} for i in range(10)]
    block = llm._history_block(turns)
    assert "q9" in block and "q4" in block and "q3" not in block
    assert llm._history_block(None) == ""
    assert llm._history_block([]) == ""
