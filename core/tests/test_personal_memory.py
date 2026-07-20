import uuid

from fastapi.testclient import TestClient

from lore.api import app, get_embedder, get_reranker
from lore.embed import FakeEmbedder
from lore.rerank import FakeReranker


app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
app.dependency_overrides[get_reranker] = lambda: FakeReranker()
client = TestClient(app)


def _identity():
    suffix = uuid.uuid4().hex[:10]
    return f"memory-{suffix}", f"owner-{suffix}", f"scope-{suffix}"


def _put(kind, tenant, owner, scope, text, session="session-1"):
    return client.put(
        f"/learn/memory/{kind}",
        json={
            "tenant": tenant,
            "owner": owner,
            "scope": scope,
            "text": text,
            "origin_session": session,
        },
    )


def test_personal_memory_is_versioned_and_exactly_rollbackable(conn):
    tenant, owner, scope = _identity()
    first = "I prefer concise release notes with verification evidence."
    second = "I prefer a short summary followed by verification evidence."

    r1 = _put("user", tenant, owner, scope, first)
    assert r1.status_code == 200, r1.text
    assert r1.json()["version"] == 1
    r2 = _put("user", tenant, owner, scope, second, "session-2")
    assert r2.status_code == 200, r2.text
    assert r2.json()["version"] == 2

    current = client.get(
        "/learn/memory",
        params={"tenant": tenant, "owner": owner, "scopes": scope},
    )
    assert current.status_code == 200, current.text
    assert current.json()["documents"][0]["text"] == second

    history = client.get(
        "/learn/memory/user/history",
        params={"tenant": tenant, "owner": owner, "scope": scope},
    )
    assert [v["version"] for v in history.json()["versions"]] == [2, 1]
    assert history.json()["versions"][0]["origin_session"] == "session-2"

    rolled = client.post(
        "/learn/memory/user/rollback",
        json={"tenant": tenant, "owner": owner, "scope": scope, "version": 1},
    )
    assert rolled.status_code == 200, rolled.text
    assert rolled.json()["version"] == 3
    assert rolled.json()["text"] == first

    row = conn.execute(
        "select body, source_type from notes where id=%s", (rolled.json()["note_id"],)
    ).fetchone()
    assert row == (first, "learn-memory")


def test_personal_memory_enforces_kind_budget_and_identity_isolation():
    tenant, owner, scope = _identity()
    too_large = _put("user", tenant, owner, scope, "x" * 1376)
    assert too_large.status_code == 422

    ok = _put("memory", tenant, owner, scope, "Working context that belongs only to this owner.")
    assert ok.status_code == 200, ok.text
    other = client.get(
        "/learn/memory",
        params={"tenant": tenant, "owner": "someone-else", "scopes": scope},
    )
    assert other.status_code == 200
    assert other.json()["documents"] == []


def test_personal_memory_delete_purges_current_document_and_history(conn):
    tenant, owner, scope = _identity()
    created = _put("memory", tenant, owner, scope, "Temporary working context to forget.")
    assert created.status_code == 200, created.text
    note_id = created.json()["note_id"]

    deleted = client.request(
        "DELETE",
        "/learn/memory/memory",
        json={"tenant": tenant, "owner": owner, "scope": scope},
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["deleted"] is True
    assert conn.execute("select 1 from notes where id=%s", (note_id,)).fetchone() is None
    assert conn.execute(
        "select 1 from memory_versions where note_id=%s", (note_id,)
    ).fetchone() is None

