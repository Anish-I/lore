"""The index is bound to the model that built it.

A Qdrant collection records dimension only, so two DIFFERENT models of the SAME
dimension (bge-small / all-MiniLM-L6 / e5-small are all 384) are indistinguishable
to the store: swap one in and every query silently returns plausible garbage — no
error, no crash, just worse recall you'd blame on the ranker. Setting
VOYAGE_API_KEY on a machine with a local index does exactly this swap.

So the engine records WHICH model produced the vectors and refuses to mix.
"""
import pytest

from lore import embed_identity as ei
from lore.embed import FakeEmbedder, LocalEmbedder, VoyageEmbedder


class _Stub:
    """An embedder that reports a given model_id."""
    def __init__(self, model_id, dim=384):
        self.model_id = model_id
        self.dim = dim

    def embed(self, texts):
        return [[0.0] * self.dim for _ in texts]


# ---------------------------------------------------------------------------
# identity
# ---------------------------------------------------------------------------

def test_every_embedder_reports_a_model_id():
    """model_id must not be the class name — two fastembed models share a class."""
    assert FakeEmbedder().model_id == "fake"
    assert LocalEmbedder.DEFAULT_MODEL in ei.local_model_id(LocalEmbedder.DEFAULT_MODEL)
    assert ei.local_model_id("BAAI/bge-small-en-v1.5") != \
        ei.local_model_id("sentence-transformers/all-MiniLM-L6-v2")


def test_identity_of_reads_the_embedder(conn):
    ident = ei.identity_of(_Stub("fastembed:bge-small"), dim=384)
    assert ident.model_id == "fastembed:bge-small" and ident.dim == 384


def test_provider_namespaces_never_collide():
    """A local model and a hosted one with the same name are different spaces."""
    assert ei.local_model_id("shared-name") != ei.voyage_model_id("shared-name")
    assert ei.voyage_model_id(VoyageEmbedder.DEFAULT_MODEL).startswith("voyage:")


# ---------------------------------------------------------------------------
# recording
# ---------------------------------------------------------------------------

def test_record_then_read_back(conn):
    ei.record(conn, ei.EmbedIdentity("m1", 384), collection="c-rec")
    got = ei.recorded(conn, collection="c-rec")
    assert got == ei.EmbedIdentity("m1", 384)


def test_unrecorded_collection_reads_as_none(conn):
    assert ei.recorded(conn, collection="c-never-written") is None


def test_record_is_idempotent(conn):
    ei.record(conn, ei.EmbedIdentity("m1", 384), collection="c-idem")
    ei.record(conn, ei.EmbedIdentity("m1", 384), collection="c-idem")
    assert ei.recorded(conn, collection="c-idem").model_id == "m1"


# ---------------------------------------------------------------------------
# enforcement
# ---------------------------------------------------------------------------

def test_first_use_records_and_allows(conn):
    ei.enforce(conn, ei.EmbedIdentity("m-first", 384), collection="c-first")
    assert ei.recorded(conn, collection="c-first").model_id == "m-first"


def test_matching_model_passes(conn):
    ei.enforce(conn, ei.EmbedIdentity("m-same", 384), collection="c-same")
    ei.enforce(conn, ei.EmbedIdentity("m-same", 384), collection="c-same")  # no raise


def test_same_dim_different_model_is_refused(conn):
    """THE silent-corruption case: 384 == 384, but the vector spaces are unrelated."""
    ei.enforce(conn, ei.EmbedIdentity("fastembed:BAAI/bge-small-en-v1.5", 384),
               collection="c-swap")
    with pytest.raises(ei.IndexIdentityMismatch) as e:
        ei.enforce(conn, ei.EmbedIdentity("fastembed:intfloat/e5-small-v2", 384),
                   collection="c-swap")
    assert "bge-small" in str(e.value) and "e5-small" in str(e.value)
    assert "rebuild" in str(e.value).lower(), "the error must say how to fix it"


def test_dimension_change_is_refused(conn):
    ei.enforce(conn, ei.EmbedIdentity("m-dim", 384), collection="c-dim")
    with pytest.raises(ei.IndexIdentityMismatch):
        ei.enforce(conn, ei.EmbedIdentity("m-dim", 1024), collection="c-dim")


def test_rebind_replaces_the_recorded_identity(conn):
    """After a real rebuild the new model becomes the collection's identity."""
    ei.enforce(conn, ei.EmbedIdentity("m-old", 384), collection="c-rebind")
    ei.rebind(conn, ei.EmbedIdentity("m-new", 1024), collection="c-rebind")
    ei.enforce(conn, ei.EmbedIdentity("m-new", 1024), collection="c-rebind")  # no raise
    assert ei.recorded(conn, collection="c-rebind").dim == 1024


def test_fake_embedder_never_binds_the_index(conn):
    """VAULT_FAKE runs (tests, CI) must not stamp an identity onto a real index."""
    ei.enforce(conn, ei.identity_of(FakeEmbedder(), dim=8), collection="c-fake")
    assert ei.recorded(conn, collection="c-fake") is None


# ---------------------------------------------------------------------------
# the write path binds it
# ---------------------------------------------------------------------------




@pytest.fixture
def _quiet_store(monkeypatch):
    """Stub the vector store so these tests exercise the identity gate only."""
    from lore import index as index_mod
    monkeypatch.setattr(index_mod.qdrant_store, "ensure_collection", lambda *a, **k: None)
    monkeypatch.setattr(index_mod.qdrant_store, "delete_note", lambda *a, **k: None)
    monkeypatch.setattr(index_mod.qdrant_store, "upsert", lambda *a, **k: None)
    return index_mod


def _index(index_mod, conn, source_id, embedder, body="pooling and backends"):
    # Distinct body per note: identical text is deduped BEFORE embedding, which
    # would skip the identity gate for the wrong reason.
    return index_mod.index_document(
        source_id=source_id, title="Title", text=f"# Title\n\nProse about {body}.\n",
        scope_id="s", owner_id="o", tenant_id="t", embedder=embedder, conn=conn)


def test_indexing_binds_the_identity(conn, monkeypatch, _quiet_store):
    monkeypatch.setattr(_quiet_store.qdrant_store, "COLLECTION", "c-write")
    _index(_quiet_store, conn, "n-ident", _Stub("fastembed:real-model"))
    assert ei.recorded(conn, collection="c-write").model_id == "fastembed:real-model"


def test_indexing_refuses_a_swapped_model(conn, monkeypatch, _quiet_store):
    monkeypatch.setattr(_quiet_store.qdrant_store, "COLLECTION", "c-write2")
    _index(_quiet_store, conn, "n-a", _Stub("model-a"), body="connection pooling")
    with pytest.raises(ei.IndexIdentityMismatch):
        _index(_quiet_store, conn, "n-b", _Stub("model-b"), body="cache invalidation")


# ---------------------------------------------------------------------------
# the read path refuses too — a query embedded by the wrong model returns
# confident nonsense, which is worse than an error
# ---------------------------------------------------------------------------

def test_check_read_passes_on_an_unbound_index(conn):
    ei.check_read(conn, _Stub("anything"), collection="c-unbound")


def test_check_read_refuses_a_swapped_model(conn):
    ei.record(conn, ei.EmbedIdentity("model-a", 384), collection="c-read")
    with pytest.raises(ei.IndexIdentityMismatch):
        ei.check_read(conn, _Stub("model-b"), collection="c-read")


def test_check_read_ignores_dimension(conn):
    """The read path can't know the live dim without embedding something; dim is
    the write path's job. Model identity alone settles compatibility."""
    ei.record(conn, ei.EmbedIdentity("model-a", 384), collection="c-read-dim")
    ei.check_read(conn, _Stub("model-a", dim=1024), collection="c-read-dim")


def test_get_embedder_refuses_when_the_index_belongs_to_another_model(monkeypatch):
    """Every retrieval endpoint depends on get_embedder, so gating there covers
    ask / search / context-pack / trace / reindex at once."""
    from fastapi import HTTPException

    import lore.api as api

    monkeypatch.setattr(api, "_FAKE", False)   # settings is frozen; no Voyage key in tests
    monkeypatch.setattr(api, "LocalEmbedder", lambda *a, **k: _Stub("fastembed:live"))
    ei.record(api._conn, ei.EmbedIdentity("fastembed:other", 384))
    try:
        with pytest.raises(HTTPException) as e:
            api.get_embedder()
        assert e.value.status_code == 503
        assert "rebuild" in str(e.value.detail).lower()
    finally:
        api._conn.execute("delete from index_identity where collection=%s",
                          (api.qdrant_store.COLLECTION,))


# ---------------------------------------------------------------------------
# surfaced, so an app can see it before it trusts the engine
# ---------------------------------------------------------------------------

def test_health_reports_the_index_identity():
    from fastapi.testclient import TestClient

    import lore.api as api
    body = TestClient(api.app).get("/api/v1/health").json()
    assert "index" in body
    assert set(body["index"]) >= {"model_id", "dim"}


def test_config_retrieval_reports_what_the_index_was_built_with(conn):
    from fastapi.testclient import TestClient

    import lore.api as api
    ei.record(api._conn, ei.EmbedIdentity("fastembed:indexed-with", 384))
    try:
        body = TestClient(api.app).get("/config/retrieval").json()
        assert body["indexedWith"] == {"model_id": "fastembed:indexed-with", "dim": 384}
        assert "embeddingModel" in body   # live resolution, unchanged
        # VAULT_FAKE has no real live model, so no mismatch may be CLAIMED.
        assert body["indexMismatch"] is False
    finally:
        api._conn.execute("delete from index_identity where collection=%s",
                          (api.qdrant_store.COLLECTION,))


def test_config_retrieval_flags_a_real_mismatch(conn, monkeypatch):
    from fastapi.testclient import TestClient

    import lore.api as api
    monkeypatch.setattr(api, "_FAKE", False)   # settings is frozen; no Voyage key in tests
    ei.record(api._conn, ei.EmbedIdentity("fastembed:some-other-model", 384))
    try:
        body = TestClient(api.app).get("/config/retrieval").json()
        assert body["indexMismatch"] is True
        assert body["indexedWith"]["model_id"] == "fastembed:some-other-model"
    finally:
        api._conn.execute("delete from index_identity where collection=%s",
                          (api.qdrant_store.COLLECTION,))


def test_doctor_flags_a_mismatched_index(conn):
    from lore import doctor
    ei.record(conn, ei.EmbedIdentity("fastembed:built-with", 384),
              collection="c-doctor")
    check = doctor.check_index_identity(conn, _Stub("fastembed:running"),
                                        collection="c-doctor")
    assert check["ok"] is False
    assert "built-with" in check["detail"] and check["fix"]


def test_doctor_ok_when_identities_agree(conn):
    from lore import doctor
    ei.record(conn, ei.EmbedIdentity("m", 384), collection="c-doctor-ok")
    assert doctor.check_index_identity(conn, _Stub("m"),
                                       collection="c-doctor-ok")["ok"] is True
