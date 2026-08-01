import os
import sys
from dataclasses import dataclass
from pathlib import Path
from dotenv import load_dotenv
load_dotenv()


def data_dir() -> Path:
    """Lore's per-user data directory — the one place the engine owns.

    Deliberately NOT a temp/cache location: everything under here must survive
    OS housekeeping. Override with LORE_HOME.
    """
    env = os.environ.get("LORE_HOME")
    if env:
        return Path(env)
    if sys.platform == "win32":
        root = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~\\AppData\\Local")
        return Path(root) / "Lore"
    if sys.platform == "darwin":
        return Path(os.path.expanduser("~/Library/Application Support/Lore"))
    root = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    return Path(root) / "lore"


def model_cache_dir() -> Path:
    """Where the ONNX embedding/rerank models live.

    fastembed's default is %TEMP%/fastembed_cache, which Windows temp cleanup
    half-deletes: the snapshot directory survives without its .onnx, fastembed
    sees the directory and skips the re-download, and onnxruntime then NoSuchFile's
    on every /reindex (see doctor.check_model_cache — this install has hit it).

    A Lore-owned per-user directory also means ONE copy of the weights shared by
    every app on the machine instead of one per app.
    """
    return data_dir() / "models"


def ensure_model_cache() -> str:
    """Point fastembed at our cache dir unless the caller chose one. Idempotent;
    called at import so it lands before any model is constructed."""
    os.environ.setdefault("FASTEMBED_CACHE_PATH", str(model_cache_dir()))
    return os.environ["FASTEMBED_CACHE_PATH"]


ensure_model_cache()

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
