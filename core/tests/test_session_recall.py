import uuid

from fastapi.testclient import TestClient

from lore.api import app, get_embedder, get_reranker
from lore.embed import FakeEmbedder
from lore.rerank import FakeReranker


app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
app.dependency_overrides[get_reranker] = lambda: FakeReranker()
client = TestClient(app)


def _seed():
    suffix = uuid.uuid4().hex[:10]
    tenant, scope = f"sessions-{suffix}", f"scope-{suffix}"
    captured = client.post(
        "/capture",
        json={
            "session_id": f"session-{suffix}",
            "title": "Renderer deployment session",
            "text": "# Session\n\nWe fixed renderer deployment by rebuilding compiled assets after JSX changes.\n",
            "scope": scope,
            "owner": "owner",
            "tenant": tenant,
            "mode": "stop",
        },
    )
    assert captured.status_code == 200, captured.text
    ordinary = client.post(
        "/ingest",
        json={
            "source_id": f"ordinary-{suffix}",
            "title": "Renderer deployment handbook",
            "text": "# Handbook\n\nRebuild compiled assets after JSX changes.\n",
            "scope": scope,
            "owner": "owner",
            "tenant": tenant,
        },
    )
    assert ordinary.status_code == 200, ordinary.text
    return tenant, scope, captured.json()["note_id"]


def test_session_recall_browse_and_scroll_only_authorized_sessions():
    tenant, scope, note_id = _seed()
    browse = client.post(
        "/sessions/recall",
        json={"mode": "browse", "tenant": tenant, "scopes": [scope], "limit": 10},
    )
    assert browse.status_code == 200, browse.text
    assert [s["note_id"] for s in browse.json()["sessions"]] == [note_id]

    scroll = client.post(
        "/sessions/recall",
        json={
            "mode": "scroll",
            "tenant": tenant,
            "scopes": [scope],
            "note_id": note_id,
            "offset": 0,
            "limit": 45,
        },
    )
    assert scroll.status_code == 200, scroll.text
    assert scroll.json()["note_id"] == note_id
    assert scroll.json()["next_offset"] == 45
    assert len(scroll.json()["text"]) == 45

    denied = client.post(
        "/sessions/recall",
        json={
            "mode": "scroll",
            "tenant": tenant,
            "scopes": ["other-scope"],
            "note_id": note_id,
        },
    )
    assert denied.status_code == 404


def test_session_discovery_excludes_non_session_notes():
    tenant, scope, note_id = _seed()
    found = client.post(
        "/sessions/recall",
        json={
            "mode": "discovery",
            "tenant": tenant,
            "scopes": [scope],
            "query": "How did we fix renderer deployment?",
            "limit": 5,
        },
    )
    assert found.status_code == 200, found.text
    assert found.json()["sessions"]
    assert all(row["note_id"] == note_id for row in found.json()["sessions"])


def test_session_discovery_returns_each_session_once():
    suffix = uuid.uuid4().hex[:10]
    tenant, scope = f"sessions-{suffix}", f"scope-{suffix}"
    marker = f"TrustedRecall{suffix}"
    captured = client.post(
        "/capture",
        json={
            "session_id": f"session-{suffix}",
            "title": "Multi-part trusted recall session",
            "text": (
                f"# Session\n\n## Decision\n{marker} keeps canonical state user-owned.\n\n"
                f"## Verification\n{marker} requires exact deletion.\n\n"
                f"## Open work\n{marker} still needs cross-model replay.\n"
            ),
            "scope": scope,
            "owner": "owner",
            "tenant": tenant,
            "mode": "stop",
        },
    )
    assert captured.status_code == 200, captured.text
    found = client.post(
        "/sessions/recall",
        json={
            "mode": "discovery",
            "tenant": tenant,
            "scopes": [scope],
            "query": f"What did {marker} establish?",
            "limit": 10,
        },
    )
    assert found.status_code == 200, found.text
    note_ids = [row["note_id"] for row in found.json()["sessions"]]
    assert note_ids == [captured.json()["note_id"]]
