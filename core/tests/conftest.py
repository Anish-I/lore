"""Test isolation: force Fake models, an isolated Qdrant collection, and offline LLM.
Env must be set BEFORE lore.* modules import (conftest loads before test modules).

Backend lanes:
  default        → SQLite (temp file; WAL needs a real file, not :memory:) +
                   EMBEDDED Qdrant (temp dir via QDRANT_PATH) — no servers needed.
  LORE_TEST_PG=1 → opt-in Postgres/Qdrant-server parity lane (uses DATABASE_URL /
                   QDRANT_URL from the environment, i.e. the pre-existing behavior).
"""
import os
import tempfile

os.environ.setdefault("VAULT_FAKE", "1")
os.environ.setdefault("QDRANT_COLLECTION", "vault_test")  # never touch the live vault_chunks

_TEST_PG = os.environ.get("LORE_TEST_PG") == "1"
if not _TEST_PG:
    # Per-run temp stores. setdefault so an explicitly exported DATABASE_URL /
    # QDRANT_PATH still wins. Must happen before lore.config / lore.qdrant_store
    # import (they read the env at module load).
    _tmp = tempfile.mkdtemp(prefix="lore-test-")
    os.environ.setdefault("QDRANT_PATH", os.path.join(_tmp, "qdrant"))
    os.environ.setdefault("DATABASE_URL", f"sqlite:///{os.path.join(_tmp, 'lore-test.db')}")

import pytest


@pytest.fixture(scope="session", autouse=True)
def _clean_test_collection():
    if _TEST_PG:
        # Server lane: the collection persists across runs — delete it up front.
        from qdrant_client import QdrantClient
        from lore.config import settings
        try:
            QdrantClient(url=settings.qdrant_url).delete_collection("vault_test")
        except Exception:
            pass
    # Embedded lane: QDRANT_PATH points at a fresh per-run temp dir — nothing to clean.
    yield


@pytest.fixture(scope="session")
def conn():
    """Bootstrapped store connection for the selected backend (SQLite by default).
    Session-scoped: tests use idempotent upserts and shared seed IDs, mirroring the
    persistent-server semantics the ACL tests were written against."""
    from lore import db, tenancy
    c = db.connect()
    db.bootstrap_schema(c)
    tenancy.bootstrap_tenancy(c)
    yield c
    c.close()
