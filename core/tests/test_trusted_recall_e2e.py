import uuid

from fastapi.testclient import TestClient
from qdrant_client.http import models as qm

from lore import qdrant_store
from lore.api import app, get_embedder, get_reranker
from lore.embed import FakeEmbedder
from lore.rerank import FakeReranker


app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
app.dependency_overrides[get_reranker] = lambda: FakeReranker()
client = TestClient(app)


def _identity():
    suffix = uuid.uuid4().hex[:12]
    return f"trusted-{suffix}", f"owner-{suffix}", f"scope-{suffix}", suffix


def _put(kind, tenant, owner, scope, text, session):
    response = client.put(
        f"/learn/memory/{kind}",
        json={
            "tenant": tenant,
            "owner": owner,
            "scope": scope,
            "text": text,
            "origin_session": session,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def _vector_payloads(note_id):
    selector = qm.Filter(must=[
        qm.FieldCondition(key="note_id", match=qm.MatchValue(value=note_id)),
    ])
    points, _ = qdrant_store._client.scroll(
        qdrant_store.COLLECTION,
        scroll_filter=selector,
        limit=100,
        with_payload=True,
    )
    return [point.payload for point in points]


def test_trusted_recall_lifecycle_exports_rolls_back_and_purges_derived_data(conn):
    tenant, owner, scope, marker = _identity()
    session = f"session-{marker}"
    first = f"TrustedRecall{marker} milestone is precise, user-controlled recall."
    second = f"TrustedRecall{marker} milestone is cross-model trusted recall."
    user_text = "Prefer concise decisions with verification evidence."

    original = _put("memory", tenant, owner, scope, first, session)
    updated = _put("memory", tenant, owner, scope, second, f"{session}-2")
    profile = _put("user", tenant, owner, scope, user_text, session)
    assert _vector_payloads(updated["note_id"])
    assert _vector_payloads(profile["note_id"])

    exported = client.get(
        "/learn/memory/export",
        params={"tenant": tenant, "owner": owner, "scope": scope},
    )
    assert exported.status_code == 200, exported.text
    bundle = exported.json()
    assert bundle["schema"] == "lore-personal-memory/v1"
    assert bundle["identity"] == {"tenant": tenant, "owner": owner, "scope": scope}
    by_kind = {document["kind"]: document for document in bundle["documents"]}
    assert by_kind["memory"]["current"]["text"] == second
    assert [row["text"] for row in by_kind["memory"]["history"]] == [second, first]
    assert by_kind["user"]["current"]["text"] == user_text

    other_owner = client.get(
        "/learn/memory/export",
        params={"tenant": tenant, "owner": "other-owner", "scope": scope},
    )
    assert other_owner.status_code == 200
    assert other_owner.json()["documents"] == []

    rolled = client.post(
        "/learn/memory/memory/rollback",
        json={
            "tenant": tenant,
            "owner": owner,
            "scope": scope,
            "version": original["version"],
        },
    )
    assert rolled.status_code == 200, rolled.text
    assert rolled.json()["text"] == first

    for kind, note_id in (("memory", updated["note_id"]), ("user", profile["note_id"])):
        deleted = client.request(
            "DELETE",
            f"/learn/memory/{kind}",
            json={"tenant": tenant, "owner": owner, "scope": scope},
        )
        assert deleted.status_code == 200, deleted.text
        assert deleted.json()["deleted"] is True
        assert conn.execute("select 1 from notes where id=%s", (note_id,)).fetchone() is None
        assert conn.execute("select 1 from chunks where note_id=%s", (note_id,)).fetchone() is None
        assert conn.execute(
            "select 1 from memory_versions where note_id=%s", (note_id,)
        ).fetchone() is None
        assert _vector_payloads(note_id) == []


def test_trusted_recall_explains_session_and_context_pack_results():
    tenant, owner, scope, marker = _identity()
    session_id = f"trusted-session-{marker}"
    decision = f"Decision TrustedRecall{marker}: serving caches stay disposable."
    captured = client.post(
        "/capture",
        json={
            "session_id": session_id,
            "title": "Trusted recall boundary decision",
            "text": f"# Session\n\n{decision}\n\nOpen action: verify complete deletion.\n",
            "scope": scope,
            "owner": owner,
            "tenant": tenant,
            "mode": "stop",
        },
    )
    assert captured.status_code == 200, captured.text

    discovered = client.post(
        "/sessions/recall",
        json={
            "mode": "discovery",
            "tenant": tenant,
            "scopes": [scope],
            "query": f"What did we decide for TrustedRecall{marker}?",
            "limit": 5,
        },
    )
    assert discovered.status_code == 200, discovered.text
    result = discovered.json()["sessions"][0]
    assert result["note_id"] == captured.json()["note_id"]
    assert result["heading_path"]
    assert result["why"]

    memory = _put(
        "memory",
        tenant,
        owner,
        scope,
        f"TrustedRecall{marker} requires replaceable models and exact deletion.",
        session_id,
    )
    packed = client.post(
        "/context-pack",
        json={
            "task": f"Explain TrustedRecall{marker}",
            "scopes": [scope],
            "tenant_id": tenant,
            "budget": 600,
        },
    )
    assert packed.status_code == 200, packed.text
    item = next(row for row in packed.json()["items"] if row["note_id"] == memory["note_id"])
    assert item["why"]
    assert item["title"] == "What Lore remembers"

