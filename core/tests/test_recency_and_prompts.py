"""Recency lane (/trace temporal questions) + /recent-prompts mining."""
import os
from fastapi.testclient import TestClient

os.environ.setdefault("VAULT_FAKE", "1")
from lore.api import app  # noqa: E402

client = TestClient(app)
TENANT = "recency-test"


def _seed():
    for i, (title, body) in enumerate([
        ("Old note", "Ancient decision about infra."),
        ("Fresh note", "Yesterday we changed the pair sizing config."),
    ]):
        client.post("/ingest", json={
            "source_id": f"rc-{i}", "tenant": TENANT, "owner": "me",
            "scope": "engineering", "title": title, "text": body,
        })
    # a captured session note with Prompt sections (what /recent-prompts mines)
    client.post("/ingest", json={
        "source_id": "rc-sess", "tenant": TENANT, "owner": "me",
        "scope": "engineering", "title": "Lore Session abc", "source_type": "claude-session",
        "text": "## Prompt [2026-07-03T10:00:00Z]\n\nHow does the recall pipeline rank results?\n",
    })


def test_temporal_question_takes_the_recency_lane():
    _seed()
    r = client.post("/trace", json={
        "question": "summarize my most recent notes",
        "principal_scopes": ["engineering"], "tenant_id": TENANT,
    })
    assert r.status_code == 200
    d = r.json()
    assert d["classification"] == "recency"
    assert len(d["citations"]) >= 1
    assert all(c["scope"] == "engineering" for c in d["citations"])
    # newest first
    titles = [c["title"] for c in d["citations"]]
    assert "Lore Session abc" in titles or "Fresh note" in titles


def test_semantic_question_does_not_take_recency_lane():
    _seed()
    r = client.post("/trace", json={
        "question": "what did we decide about infra",
        "principal_scopes": ["engineering"], "tenant_id": TENANT,
    })
    assert r.json().get("classification") != "recency"


def test_recent_prompts_returns_session_prompt_texts():
    _seed()
    r = client.get("/recent-prompts", params={"tenant": TENANT})
    assert r.status_code == 200
    prompts = r.json()["prompts"]
    assert any("recall pipeline" in p for p in prompts)
    # no tenant → empty, never cross-tenant
    assert client.get("/recent-prompts").json()["prompts"] == []


def test_digest_style_prompt_instructs_synthesis_not_refusal():
    from lore.llm import _grounded_prompt
    chunks = [{"title": "Fresh note (updated 2026-07-03)", "text": "changed pair sizing"}]
    digest = _grounded_prompt("what did I work on this week?", chunks, style="digest")
    assert "do NOT say the context lacks a summary" in digest
    assert "bullet points" in digest
    plain = _grounded_prompt("what did we decide?", chunks)
    assert "say so plainly" in plain
