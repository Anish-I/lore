"""Health checks behind GET /doctor (and unit-testable on their own).

Each check returns {"name", "ok", "detail", "fix"} — `ok` is a hard boolean,
`detail` says what was observed, `fix` is the one action that clears it.

These encode real failure modes this install has already hit:
  - the fastembed model cache half-deleted by Windows temp cleanup (snapshot
    dir survives, .onnx gone → every /reindex 500s while the model "exists");
  - an empty index behind a healthy-looking backend (silent 401s upstream).
"""
import os
import tempfile
from pathlib import Path


# ---------------------------------------------------------------------------
# model cache
# ---------------------------------------------------------------------------

# Cache dirs that must contain an .onnx file when downloaded. The BM25 sparse
# model (Qdrant/bm25) is tokenizer+IDF only — no .onnx even when healthy — so
# the check is scoped to dirs that are actually ONNX models by name.
_ONNX_DIR_MARKERS = ("onnx", "minilm", "marco", "bge")


def _cache_root() -> Path:
    """fastembed's cache dir: FASTEMBED_CACHE_PATH env, else the library default
    (%TEMP%/fastembed_cache) — the default is exactly the fragile location."""
    env = os.environ.get("FASTEMBED_CACHE_PATH")
    if env:
        return Path(env)
    return Path(tempfile.gettempdir()) / "fastembed_cache"


def check_model_cache(cache_root: Path = None) -> dict:
    """Verify every downloaded ONNX-model snapshot actually contains an .onnx.

    A snapshot directory WITHOUT its .onnx is the half-deleted-cache failure:
    fastembed sees the dir, skips the download, then onnxruntime NoSuchFile's.
    A model that hasn't been downloaded at all is fine (first use fetches it).
    """
    root = Path(cache_root) if cache_root else _cache_root()
    if not root.exists():
        return {
            "name": "model-cache",
            "ok": True,
            "detail": f"no cache at {root} yet — models download on first use",
            "fix": None,
        }
    broken = []
    present = 0
    for model_dir in sorted(root.glob("models--*")):
        low = model_dir.name.lower()
        needs_onnx = any(m in low for m in _ONNX_DIR_MARKERS)
        if not needs_onnx:
            present += 1
            continue
        if list(model_dir.rglob("*.onnx")):
            present += 1
        else:
            broken.append(model_dir.name)
    if broken:
        return {
            "name": "model-cache",
            "ok": False,
            "detail": f"{len(broken)} model snapshot(s) missing their .onnx: {', '.join(broken)}",
            "fix": f"delete {root} and reindex once — the models re-download",
        }
    return {
        "name": "model-cache",
        "ok": True,
        "detail": f"{present} model(s) cached at {root}",
        "fix": None,
    }


# ---------------------------------------------------------------------------
# vector store
# ---------------------------------------------------------------------------

def check_qdrant() -> dict:
    from . import qdrant_store
    mode = "embedded" if os.environ.get("QDRANT_PATH") else (
        "memory" if os.environ.get("QDRANT_URL", "") == ":memory:" else "server")
    try:
        names = [c.name for c in qdrant_store._client.get_collections().collections]
        if qdrant_store.COLLECTION not in names:
            return {
                "name": "qdrant",
                "ok": False,
                "detail": f"collection '{qdrant_store.COLLECTION}' missing ({mode} mode)",
                "fix": "reindex — the collection is created on first ingest",
            }
        points = qdrant_store._client.count(qdrant_store.COLLECTION, exact=True).count
        return {
            "name": "qdrant",
            "ok": True,
            "detail": f"{mode} mode, {points} points in '{qdrant_store.COLLECTION}'",
            "fix": None,
        }
    except Exception as e:  # pragma: no cover - depends on live store
        return {
            "name": "qdrant",
            "ok": False,
            "detail": f"vector store unreachable: {e}",
            "fix": "check QDRANT_PATH/QDRANT_URL; restart the backend",
        }


# ---------------------------------------------------------------------------
# index counts / upkeep backlog / llm / auth
# ---------------------------------------------------------------------------

def check_index_counts(conn, tenant: str) -> dict:
    notes = conn.execute(
        "select count(*) from notes where tenant_id=%s", (tenant,)).fetchone()[0]
    chunks = conn.execute(
        "select count(*) from chunks c join notes n on c.note_id=n.id where n.tenant_id=%s",
        (tenant,)).fetchone()[0]
    edges = conn.execute(
        "select count(*) from edges where tenant_id=%s", (tenant,)).fetchone()[0]
    folded = conn.execute(
        "select count(*) from folded_paths where tenant_id=%s", (tenant,)).fetchone()[0]
    if notes == 0:
        return {
            "name": "index",
            "ok": False,
            "detail": f"index is EMPTY for tenant '{tenant}' (0 notes)",
            "fix": "run a reindex/scan — if scans 'succeed' but stay empty, check the token and model-cache checks",
        }
    return {
        "name": "index",
        "ok": True,
        "detail": f"{notes} notes · {chunks} chunks · {edges} edges · {folded} folded",
        "fix": None,
    }


def check_upkeep_backlog(conn, tenant: str, threshold: int = 25) -> dict:
    from .upkeep import _is_ephemeral
    rows = conn.execute(
        "select title, source_type from notes where tenant_id=%s", (tenant,)).fetchall()
    backlog = sum(1 for title, st in rows if _is_ephemeral(title or "", st or ""))
    ok = backlog < threshold
    return {
        "name": "upkeep",
        "ok": ok,
        "detail": f"{backlog} ephemeral note(s) awaiting fold" if backlog else "no upkeep backlog",
        "fix": None if ok else "run upkeep (desktop: Tidy up / POST /upkeep/run)",
    }


def check_llm(conn, tenant: str) -> dict:
    from . import llm
    up = llm.is_ollama_up()
    llm_edges = conn.execute(
        "select count(*) from edges where tenant_id=%s and origin='llm'", (tenant,)).fetchone()[0]
    detail = f"ollama {'up' if up else 'DOWN'} · {llm_edges} llm-origin edges"
    fix = None
    if up and llm_edges == 0:
        fix = "run /enrich once to add reasoned relations to the graph"
    if not up:
        fix = "start Ollama for local answers/enrichment (Ask falls back to extractive)"
    # Ollama being down is a degradation, not a failure — ok stays True.
    return {"name": "llm", "ok": True, "detail": detail, "fix": fix}


def check_auth() -> dict:
    enforced = bool(os.environ.get("LORE_LOCAL_TOKEN"))
    return {
        "name": "auth",
        "ok": True,
        "detail": "local token enforcement ON" if enforced else "local token enforcement OFF (raw backend)",
        "fix": None if enforced else "launch through the desktop app (it sets LORE_LOCAL_TOKEN)",
    }


def run_checks(conn, tenant: str) -> dict:
    checks = [
        check_model_cache(),
        check_qdrant(),
        check_index_counts(conn, tenant),
        check_upkeep_backlog(conn, tenant),
        check_llm(conn, tenant),
        check_auth(),
    ]
    return {"ok": all(c["ok"] for c in checks), "checks": checks}
