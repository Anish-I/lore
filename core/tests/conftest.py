"""Test isolation: force Fake models, an isolated Qdrant collection, and offline LLM.
Env must be set BEFORE vault.* modules import (conftest loads before test modules)."""
import os
os.environ.setdefault("VAULT_FAKE", "1")
os.environ.setdefault("QDRANT_COLLECTION", "vault_test")  # never touch the live vault_chunks

import pytest

@pytest.fixture(scope="session", autouse=True)
def _clean_test_collection():
    from qdrant_client import QdrantClient
    from lore.config import settings
    try:
        QdrantClient(url=settings.qdrant_url).delete_collection("vault_test")
    except Exception:
        pass
    yield
