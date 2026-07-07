"""M3: agent memory bus — /memory self-provisioning writes, scope isolation,
write caps, /feedback into ranking signals, auto-journal upkeep step."""
import os

from fastapi.testclient import TestClient

from lore.api import app, get_embedder, get_reranker, _note_signals_provider
from lore.embed import FakeEmbedder
from lore.rerank import FakeReranker

app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
app.dependency_overrides[get_reranker] = lambda: FakeReranker()
client = TestClient(app)

TENANT = "bus-tenant"


def test_memory_write_self_provisions_agent(conn):
    r = client.post("/memory", json={
        "agent": "wingman", "tenant": TENANT,
        "text": "Decision: the Kalshi bot uses pair sizing with a two percent cap per market.",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["scope"] == "agent:wingman"
    assert body["note_id"].startswith("agent:wingman:")

    # Registry row exists (zero-friction signup; human claims later).
    row = conn.execute(
        "select writes, claimed_by from agents where tenant_id=%s and name=%s",
        (TENANT, "wingman")).fetchone()
    assert row is not None and row[0] >= 1 and row[1] is None

    # The note is typed as agent memory.
    mt = conn.execute(
        "select memory_type, scope_id from notes where id=%s", (body["note_id"],)).fetchone()
    assert mt == ("agent", "agent:wingman")


def test_memory_write_key_upserts(conn):
    r1 = client.post("/memory", json={
        "agent": "h-cli", "tenant": TENANT, "session_id": "pref-1",
        "text": "User prefers short scannable answers in Telegram messages always.",
    })
    r2 = client.post("/memory", json={
        "agent": "h-cli", "tenant": TENANT, "session_id": "pref-1",
        "text": "UPDATED preference: user prefers short answers with bullet points in Telegram.",
    })
    assert r1.json()["note_id"] == r2.json()["note_id"]
    body = conn.execute("select body from notes where id=%s", (r1.json()["note_id"],)).fetchone()[0]
    assert "UPDATED preference" in body


def test_memory_scope_isolation():
    # Agent A's memory is invisible to searches scoped to agent B.
    client.post("/memory", json={
        "agent": "agent-a", "tenant": TENANT,
        "text": "Secret alpha fact about the ZORB-777 project configuration details.",
    })
    r = client.post("/search", json={
        "query": "ZORB-777 project", "scopes": ["agent:agent-b"], "tenant_id": TENANT, "k": 5,
    })
    hits = r.json().get("results", [])
    assert not any("ZORB-777" in str(h.get("text", "")) for h in hits), "ACL leak across agent scopes"
    # ...but visible in its own scope.
    r2 = client.post("/search", json={
        "query": "ZORB-777 project", "scopes": ["agent:agent-a"], "tenant_id": TENANT, "k": 5,
    })
    assert any("ZORB-777" in str(h.get("text", "")) for h in r2.json().get("results", []))


def test_memory_bad_agent_name_rejected():
    r = client.post("/memory", json={"agent": "Bad Name!", "tenant": TENANT, "text": "x" * 40})
    assert r.status_code == 422


def test_memory_write_cap(monkeypatch, conn):
    import lore.api as api_mod
    monkeypatch.setattr(api_mod, "_AGENT_WRITE_CAP", 3)
    for i in range(3):
        r = client.post("/memory", json={
            "agent": "capped", "tenant": TENANT,
            "text": f"Fact number {i} with enough words to become an indexed chunk today.",
        })
        assert r.status_code == 200
    r = client.post("/memory", json={
        "agent": "capped", "tenant": TENANT,
        "text": "One more fact that should be refused by the hourly write cap now.",
    })
    assert r.status_code == 429


def test_feedback_feeds_ranking_signals(conn):
    client.post("/ingest", json={
        "source_id": "fb-note", "title": "Feedback Note",
        "text": "# Feedback Note\n\nA note that the user finds consistently useful in answers.\n",
        "scope": "s", "owner": "o", "tenant": TENANT,
    })
    for _ in range(3):
        assert client.post("/feedback", json={
            "tenant": TENANT, "note_id": "fb-note", "vote": 1}).status_code == 200
    provider = _note_signals_provider(TENANT, "anything")
    sig = provider({"fb-note"})
    assert sig["fb-note"]["feedback_net"] == 3

    from lore import recall
    final = {"c1": 0.5, "c2": 0.5}
    by_id = {"c1": {"note_id": "fb-note"}, "c2": {"note_id": "other"}}
    recall._apply_note_signals(final, by_id, "q", {
        "fb-note": {**sig["fb-note"]},
        "other": {"importance": 0, "age_days": None, "memory_type": "durable",
                  "superseded": False, "entity_hit": False, "feedback_net": -3},
    })
    assert final["c1"] > 0.5 > final["c2"], f"feedback boost/demotion missing: {final}"


def test_auto_journal_materializes_daily_note(conn):
    from lore.upkeep import run_upkeep
    jt = "journal-tenant"
    for i in range(3):
        client.post("/ingest", json={
            "source_id": f"jn-{i}", "title": f"Journal Source {i}",
            "text": f"# Journal Source {i}\n\nWork item {i} touched today with details.\n",
            "scope": "s", "owner": "o", "tenant": jt,
        })
    stats = run_upkeep(conn, FakeEmbedder(), jt, scope="s", auto_journal=True)
    assert stats.get("journal") == 1, stats
    import datetime
    jid = f"journal:{jt}:{datetime.date.today().isoformat()}"
    row = conn.execute("select title, source_type, body from notes where id=%s", (jid,)).fetchone()
    assert row is not None
    title, source_type, body = row
    assert source_type == "journal" and title.startswith("Journal ")
    assert "Journal Source 0" in body
    # Journal notes must NOT be ephemeral (upkeep would fold its own journal).
    from lore.upkeep import _is_ephemeral
    assert not _is_ephemeral(title, source_type)


def test_memory_refused_in_server_mode():
    os.environ["LORE_SERVER_MODE"] = "1"
    try:
        r = client.post("/memory", json={"agent": "x1", "tenant": TENANT, "text": "y" * 40})
        assert r.status_code == 403
    finally:
        os.environ.pop("LORE_SERVER_MODE", None)
