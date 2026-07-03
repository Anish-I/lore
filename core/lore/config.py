import os
from dataclasses import dataclass
from dotenv import load_dotenv
load_dotenv()

@dataclass(frozen=True)
class Settings:
    database_url: str = os.environ.get("DATABASE_URL", "postgresql://vault:vault@localhost:5433/vault")
    qdrant_url: str = os.environ.get("QDRANT_URL", "http://localhost:6333")
    voyage_api_key: str = os.environ.get("VOYAGE_API_KEY", "")
    vault_root: str | None = os.environ.get("VAULT_ROOT") or None
    # Colon/`os.pathsep`-separated list of directories that /reindex is allowed to
    # read files from (path-traversal containment). Falls back to VAULT_ROOT when
    # VAULT_ROOTS is unset. Empty => no containment configured (dev/legacy).
    vault_roots: str | None = os.environ.get("VAULT_ROOTS") or os.environ.get("VAULT_ROOT") or None
    tenant_id: str | None = os.environ.get("TENANT_ID") or None
    owner_id: str | None = os.environ.get("OWNER_ID") or None
    scope_id: str | None = os.environ.get("SCOPE_ID") or None

settings = Settings()
