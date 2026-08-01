"""Rebuild the index, and own the model cache.

Two loose ends the embedding-identity guard exposed:

  * The guard tells you to rebuild, so a rebuild has to exist. It re-embeds every
    note from `notes.body` (the relational store is the source of truth; vectors
    are derived and rebuildable) and rebinds the collection to the live model.
  * fastembed's default cache is %TEMP%/fastembed_cache — doctor.py already calls
    that "exactly the fragile location" (Windows temp cleanup half-deletes it, the
    snapshot dir survives without its .onnx, and every /reindex 500s). Nothing was
    moving off it.
"""
import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import lore.api as api
from lore import config, db, doctor, embed_identity as ei, index as index_mod

client = TestClient(api.app)


class _Stub:
    def __init__(self, model_id, dim=8):
        self.model_id = model_id
        self.dim = dim

    def embed(self, texts):
        return [[0.1] * self.dim for _ in texts]


@pytest.fixture
def store(tmp_path, monkeypatch):
    """An isolated relational store + a stubbed vector store.

    Isolated on purpose: rebuild deletes every chunk row and drops the whole
    collection, so it must never run against the shared session fixture.
    """
    conn = db._connect_url(f"sqlite:///{tmp_path / 'rebuild.db'}")
    db.bootstrap_schema(conn)
    monkeypatch.setattr(index_mod.qdrant_store, "COLLECTION", "c-rebuild")
    monkeypatch.setattr(index_mod.qdrant_store, "ensure_collection", lambda *a, **k: None)
    monkeypatch.setattr(index_mod.qdrant_store, "delete_note", lambda *a, **k: None)
    monkeypatch.setattr(index_mod.qdrant_store, "upsert", lambda *a, **k: None)
    monkeypatch.setattr(index_mod.qdrant_store, "drop_collection", lambda *a, **k: None)
    yield conn
    conn.close()


def _seed(conn, embedder, n=3):
    for i in range(n):
        index_mod.index_document(
            source_id=f"n{i}", title=f"Note {i}",
            text=f"# Note {i}\n\nProse about subject number {i} and its backends.\n",
            scope_id="s", owner_id="o", tenant_id="t", embedder=embedder, conn=conn)


# ---------------------------------------------------------------------------
# rebuild
# ---------------------------------------------------------------------------

def test_rebuild_reindexes_every_note(store):
    _seed(store, _Stub("model-old"), n=3)
    out = index_mod.rebuild_index(store, _Stub("model-old"))
    assert out["notes"] == 3 and out["chunks"] > 0


def test_rebuild_rebinds_the_index_to_the_live_model(store):
    """The recovery path the mismatch error promises: a swapped model is refused
    by a normal write, and accepted through a rebuild."""
    _seed(store, _Stub("model-old"), n=2)
    assert ei.recorded(store, collection="c-rebuild").model_id == "model-old"

    with pytest.raises(ei.IndexIdentityMismatch):
        _seed(store, _Stub("model-new"), n=1)

    index_mod.rebuild_index(store, _Stub("model-new"))
    assert ei.recorded(store, collection="c-rebuild").model_id == "model-new"


def test_rebuild_drops_the_old_vectors_before_writing(store, monkeypatch):
    """Rebinding without clearing would leave the OLD model's vectors in place —
    the exact corruption the guard exists to prevent, self-inflicted."""
    calls = []
    monkeypatch.setattr(index_mod.qdrant_store, "drop_collection",
                        lambda *a, **k: calls.append("drop"))
    monkeypatch.setattr(index_mod.qdrant_store, "upsert",
                        lambda *a, **k: calls.append("upsert"))
    _seed(store, _Stub("model-old"), n=2)
    calls.clear()
    index_mod.rebuild_index(store, _Stub("model-new"))
    assert calls and calls[0] == "drop", f"first action must be the drop: {calls[:3]}"
    assert "upsert" in calls


def test_rebuild_on_an_empty_store_is_a_no_op(store):
    out = index_mod.rebuild_index(store, _Stub("model-x"))
    assert out["notes"] == 0


def test_rebuild_endpoint_requires_explicit_confirmation():
    r = client.post("/admin/rebuild-index", json={})
    assert r.status_code == 400
    assert "confirm" in r.text.lower()


def test_rebuild_endpoint_is_not_in_the_v1_contract():
    """Destructive admin surface stays root-only until deliberately promoted."""
    paths = {r.path for r in api.app.router.routes}
    assert "/admin/rebuild-index" in paths
    assert "/api/v1/admin/rebuild-index" not in paths


def test_rebuild_endpoint_requires_an_admin_key_in_service_mode(monkeypatch):
    monkeypatch.setenv("LORE_API_KEYS", "1")
    r = client.post("/admin/rebuild-index", json={"confirm": True})
    assert r.status_code == 401


def test_rebuild_runs_even_while_the_identity_gate_is_refusing(monkeypatch):
    """The whole point: when every other request is 503ing on a model mismatch,
    the fix must not itself be blocked by the mismatch."""
    monkeypatch.setattr(api, "_FAKE", False)  # settings is frozen; no Voyage key in tests
    monkeypatch.setattr(api, "LocalEmbedder", lambda *a, **k: _Stub("fastembed:live"))
    monkeypatch.setattr(api.qdrant_store, "drop_collection", lambda *a, **k: True)
    ei.record(api._conn, ei.EmbedIdentity("fastembed:other", 384))
    try:
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as gated:
            api.get_embedder()               # normal path: refused
        assert gated.value.status_code == 503
        assert api._build_embedder().model_id == "fastembed:live"   # rebuild path: allowed
    finally:
        api._conn.execute("delete from index_identity where collection=%s",
                          (api.qdrant_store.COLLECTION,))


# ---------------------------------------------------------------------------
# model cache
# ---------------------------------------------------------------------------

def test_model_cache_dir_is_not_in_the_system_temp():
    """The whole point: %TEMP% gets swept, taking half the model with it."""
    cache = Path(config.model_cache_dir())
    assert Path(tempfile.gettempdir()) not in cache.parents
    assert cache != Path(tempfile.gettempdir())


def test_model_cache_dir_is_per_user_and_named_for_lore():
    assert "lore" in str(config.model_cache_dir()).lower()


def test_ensure_model_cache_sets_the_env(monkeypatch):
    monkeypatch.delenv("FASTEMBED_CACHE_PATH", raising=False)
    config.ensure_model_cache()
    assert Path(os.environ["FASTEMBED_CACHE_PATH"]) == Path(config.model_cache_dir())


def test_an_explicit_cache_path_wins(monkeypatch, tmp_path):
    monkeypatch.setenv("FASTEMBED_CACHE_PATH", str(tmp_path / "mine"))
    config.ensure_model_cache()
    assert os.environ["FASTEMBED_CACHE_PATH"] == str(tmp_path / "mine")


def test_doctor_checks_the_dir_lore_actually_uses(monkeypatch):
    """doctor's health check and the engine must never disagree about where the
    models live — that was how the half-deleted cache stayed invisible."""
    monkeypatch.delenv("FASTEMBED_CACHE_PATH", raising=False)
    config.ensure_model_cache()
    assert doctor._cache_root() == Path(config.model_cache_dir())
