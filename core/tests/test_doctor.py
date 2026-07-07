"""Tests for lore.doctor checks and the GET /doctor endpoint (M1-B).

The model-cache check encodes a real production failure: Windows temp cleanup
half-deleted %TEMP%/fastembed_cache (snapshot dir survived, .onnx gone) and
every /reindex 500'd while the model looked installed.
"""
import os
from pathlib import Path

from fastapi.testclient import TestClient

from lore.api import app, get_embedder, get_reranker
from lore.embed import FakeEmbedder
from lore.rerank import FakeReranker
from lore import doctor

app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
app.dependency_overrides[get_reranker] = lambda: FakeReranker()
client = TestClient(app)


# ---------------------------------------------------------------------------
# check_model_cache
# ---------------------------------------------------------------------------

def _mk_model(root: Path, name: str, with_onnx: bool):
    snap = root / name / "snapshots" / "abc123"
    snap.mkdir(parents=True)
    (snap / "config.json").write_text("{}")
    if with_onnx:
        (snap / "model_optimized.onnx").write_text("fake-onnx")


def test_model_cache_missing_dir_is_ok(tmp_path):
    r = doctor.check_model_cache(tmp_path / "nope")
    assert r["ok"] is True
    assert "download on first use" in r["detail"]


def test_model_cache_healthy(tmp_path):
    _mk_model(tmp_path, "models--qdrant--bge-small-en-v1.5-onnx-q", with_onnx=True)
    r = doctor.check_model_cache(tmp_path)
    assert r["ok"] is True


def test_model_cache_half_deleted_snapshot_fails(tmp_path):
    # The exact failure mode: onnx-model dir exists, .onnx removed.
    _mk_model(tmp_path, "models--qdrant--bge-small-en-v1.5-onnx-q", with_onnx=False)
    r = doctor.check_model_cache(tmp_path)
    assert r["ok"] is False
    assert "bge-small" in r["detail"]
    assert r["fix"]


def test_model_cache_bm25_without_onnx_is_healthy(tmp_path):
    # Qdrant/bm25 is tokenizer+IDF only — no .onnx even when healthy.
    _mk_model(tmp_path, "models--Qdrant--bm25", with_onnx=False)
    r = doctor.check_model_cache(tmp_path)
    assert r["ok"] is True


# ---------------------------------------------------------------------------
# check_index_counts / check_upkeep_backlog
# ---------------------------------------------------------------------------

def test_index_counts_empty_tenant_fails(conn):
    r = doctor.check_index_counts(conn, "doctor-empty-tenant")
    assert r["ok"] is False
    assert "EMPTY" in r["detail"]


def test_index_counts_populated(conn):
    tenant = "doctor-pop-tenant"
    client.post("/ingest", json={
        "source_id": "doc-note-1", "title": "Doctor Note",
        "text": "# Doctor Note\n\nBody text for the doctor check.\n",
        "scope": "alice-private", "owner": "alice", "tenant": tenant,
    })
    r = doctor.check_index_counts(conn, tenant)
    assert r["ok"] is True
    assert "1 notes" in r["detail"]


def test_upkeep_backlog_counts_ephemeral(conn):
    tenant = "doctor-backlog-tenant"
    client.post("/ingest", json={
        "source_id": "doc-eph-1", "title": "2026-07-06 session dump",
        "text": "# 2026-07-06\n\nEphemeral capture body.\n",
        "scope": "alice-private", "owner": "alice", "tenant": tenant,
    })
    r = doctor.check_upkeep_backlog(conn, tenant)
    assert "1 ephemeral" in r["detail"]


# ---------------------------------------------------------------------------
# /doctor endpoint
# ---------------------------------------------------------------------------

def test_doctor_endpoint_local_mode():
    r = client.get("/doctor", params={"tenant": "doctor-endpoint-tenant"})
    assert r.status_code == 200
    body = r.json()
    names = [c["name"] for c in body["checks"]]
    for expected in ("model-cache", "qdrant", "index", "upkeep", "llm", "auth"):
        assert expected in names
    assert all({"name", "ok", "detail", "fix"} <= set(c) for c in body["checks"])


def test_doctor_endpoint_refused_in_server_mode():
    os.environ["LORE_SERVER_MODE"] = "1"
    try:
        r = client.get("/doctor")
        assert r.status_code == 403
    finally:
        os.environ.pop("LORE_SERVER_MODE", None)
