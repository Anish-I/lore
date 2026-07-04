"""ask_history — the main chat's persisted threads (mirror of the wizard chat
shape + thread_id + source). Roundtrip, thread index, delete, validation."""
from fastapi.testclient import TestClient

from lore import db
from lore.api import app

client = TestClient(app)

TENANT = "ask-history-test"


def _append(thread_id, role, text, **kw):
    r = client.post("/ask-history", json={
        "tenant": TENANT, "thread_id": thread_id, "role": role, "text": text, **kw})
    assert r.status_code == 200 and r.json()["ok"] is True
    return r.json()["id"]


def test_roundtrip_one_thread_in_order():
    db.bootstrap_schema(db.connect())
    _append("t1", "user", "what is the kalshi pair sizing?", source="private")
    _append("t1", "assistant", "Pair sizing is configured in ...",
            sources=[{"note_id": "n1", "title": "Pair sizing", "scope": "private"}],
            source="private")
    _append("t1", "user", "and for fed markets?", source="private")

    msgs = client.get("/ask-history", params={"tenant": TENANT, "thread_id": "t1"}).json()["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant", "user"]
    assert msgs[0]["text"] == "what is the kalshi pair sizing?"
    assert msgs[0]["source"] == "private"
    # Assistant turn keeps its citations (JSON roundtrip) incl. per-citation scope.
    assert msgs[1]["sources"][0]["scope"] == "private"
    assert all(m["thread_id"] == "t1" for m in msgs)
    assert all(m["created_at"] for m in msgs)


def test_threads_index_and_cross_thread_listing():
    _append("t2", "user", "summarize the wingman roadmap", source="team")
    _append("t2", "assistant", "The roadmap covers ...", source="team")

    threads = client.get("/ask-history/threads", params={"tenant": TENANT}).json()["threads"]
    ids = [t["thread_id"] for t in threads]
    assert "t1" in ids and "t2" in ids
    t2 = next(t for t in threads if t["thread_id"] == "t2")
    assert t2["title"] == "summarize the wingman roadmap"  # first user question
    assert t2["count"] == 2
    assert ids[0] == "t2"  # newest first

    # No thread_id → recent messages across threads, oldest first.
    msgs = client.get("/ask-history", params={"tenant": TENANT}).json()["messages"]
    assert len(msgs) >= 5
    assert msgs[-1]["thread_id"] == "t2"


def test_delete_removes_only_that_thread():
    r = client.post("/ask-history/delete", json={"tenant": TENANT, "thread_id": "t2"}).json()
    assert r["ok"] is True and r["deleted"] == 2
    threads = client.get("/ask-history/threads", params={"tenant": TENANT}).json()["threads"]
    assert [t["thread_id"] for t in threads] == ["t1"]
    assert client.get("/ask-history", params={"tenant": TENANT, "thread_id": "t2"}).json()["messages"] == []


def test_validation():
    assert client.get("/ask-history").status_code == 422                  # tenant required
    assert client.get("/ask-history/threads").status_code == 422
    r = client.post("/ask-history", json={"tenant": TENANT, "thread_id": "tv",
                                          "role": "robot", "text": "x"})
    assert r.status_code == 422                                           # bad role
    r = client.post("/ask-history", json={"tenant": TENANT, "thread_id": "",
                                          "role": "user", "text": "x"})
    assert r.status_code == 422                                           # empty thread
