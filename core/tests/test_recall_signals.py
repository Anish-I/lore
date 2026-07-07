"""M2: note-level ranking signals — memory-type axis, importance, temporal
intent, entity boost, supersedes demotion — and the /context-pack endpoint."""
from fastapi.testclient import TestClient

from lore.api import app, get_embedder, get_reranker
from lore.embed import FakeEmbedder
from lore.rerank import FakeReranker
from lore import recall

app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
app.dependency_overrides[get_reranker] = lambda: FakeReranker()
client = TestClient(app)


# ---------------------------------------------------------------------------
# temporal intent
# ---------------------------------------------------------------------------

def test_temporal_intent_classification():
    assert recall.temporal_intent("what is the current status of the migration") == "current"
    assert recall.temporal_intent("what am I working on right now") == "current"
    assert recall.temporal_intent("what did I decide about auth in March") == "past"
    assert recall.temporal_intent("what did we originally plan") == "past"
    assert recall.temporal_intent("how does chunking work") == "none"


# ---------------------------------------------------------------------------
# _apply_note_signals
# ---------------------------------------------------------------------------

def _fixture():
    final = {"c1": 0.5, "c2": 0.5, "c3": 0.5, "c4": 0.5}
    by_id = {c: {"note_id": "n" + c[-1]} for c in final}
    return final, by_id


def test_memory_type_axis_demotes_sessions():
    final, by_id = _fixture()
    signals = {
        "n1": {"memory_type": "durable", "importance": 0, "age_days": None, "superseded": False, "entity_hit": False},
        "n2": {"memory_type": "session", "importance": 0, "age_days": None, "superseded": False, "entity_hit": False},
        "n3": {"memory_type": "agent", "importance": 0, "age_days": None, "superseded": False, "entity_hit": False},
    }
    recall._apply_note_signals(final, by_id, "how does chunking work", signals)
    assert final["c1"] > final["c3"] > final["c2"], f"durable > agent > session violated: {final}"
    assert final["c4"] == 0.5  # no signal -> untouched


def test_importance_and_entity_boost():
    final, by_id = _fixture()
    signals = {
        "n1": {"memory_type": "durable", "importance": 1.0, "age_days": None, "superseded": False, "entity_hit": False},
        "n2": {"memory_type": "durable", "importance": 0.0, "age_days": None, "superseded": False, "entity_hit": False},
        "n3": {"memory_type": "durable", "importance": 0.0, "age_days": None, "superseded": False, "entity_hit": True},
    }
    recall._apply_note_signals(final, by_id, "how does chunking work", signals)
    assert final["c1"] > final["c2"], "importance boost missing"
    assert final["c3"] > final["c2"], "entity boost missing"


def test_recency_boost_follows_temporal_intent():
    def run(query):
        final, by_id = _fixture()
        signals = {
            "n1": {"memory_type": "durable", "importance": 0, "age_days": 1.0, "superseded": False, "entity_hit": False},
            "n2": {"memory_type": "durable", "importance": 0, "age_days": 400.0, "superseded": False, "entity_hit": False},
        }
        recall._apply_note_signals(final, by_id, query, signals)
        return final
    cur = run("what is the current status")
    assert cur["c1"] > cur["c2"], "current intent must favor recent notes"
    past = run("what did I decide in March")
    assert past["c1"] == past["c2"], "past intent must not apply a recency boost"


def test_superseded_notes_are_demoted():
    final, by_id = _fixture()
    signals = {
        "n1": {"memory_type": "durable", "importance": 0, "age_days": None, "superseded": True, "entity_hit": False},
        "n2": {"memory_type": "durable", "importance": 0, "age_days": None, "superseded": False, "entity_hit": False},
    }
    recall._apply_note_signals(final, by_id, "policy limit", signals)
    assert final["c1"] < final["c2"], "superseded note not demoted"


# ---------------------------------------------------------------------------
# memory_type lands on ingest + /context-pack
# ---------------------------------------------------------------------------

def test_ingest_sets_memory_type(conn):
    tenant = "mtype-tenant"
    client.post("/ingest", json={
        "source_id": "mt-1", "title": "Durable Note",
        "text": "# Durable Note\n\nA real knowledge note with plenty of body text for chunking.\n",
        "scope": "s", "owner": "o", "tenant": tenant,
    })
    client.post("/capture", json={
        "session_id": "mt-sess", "title": "Session capture",
        "text": "captured session content with enough words to be indexed as a chunk here",
        "scope": "s", "owner": "o", "tenant": tenant,
    })
    rows = dict(conn.execute(
        "select id, memory_type from notes where tenant_id=%s", (tenant,)).fetchall())
    assert rows.get("mt-1") == "durable"
    session_rows = [v for k, v in rows.items() if k != "mt-1"]
    assert session_rows and all(v == "session" for v in session_rows), rows


def test_context_pack_respects_budget():
    tenant = "pack-tenant"
    for i in range(4):
        client.post("/ingest", json={
            "source_id": f"pk-{i}", "title": f"Pack Note {i}",
            "text": f"# Pack Note {i}\n\n" + (f"Fact {i} about the widget pipeline. " * 40),
            "scope": "s", "owner": "o", "tenant": tenant,
        })
    r = client.post("/context-pack", json={
        "task": "widget pipeline facts", "scopes": ["s"], "tenant_id": tenant, "budget": 300,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["tokens_total"] <= body["budget"] + 50  # small tokenizer slack
    assert body["items"], "pack must contain at least one cited item"
    for it in body["items"]:
        assert it["note_id"] and it["tokens"] > 0
    assert body["pack"].startswith("### ")
