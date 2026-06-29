import os, time
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileCreatedEvent, FileModifiedEvent
from .index import index_note
from .config import settings
from . import db
from .embed import FakeEmbedder, VoyageEmbedder

def handle_change(path, embedder, conn, owner_id=None, scope_id=None, tenant_id=None):
    if not path.endswith(".md"):
        return 0
    if not os.path.isfile(path):
        return 0
    owner = owner_id or settings.owner_id
    scope = scope_id or settings.scope_id
    tenant = tenant_id or settings.tenant_id
    missing = [
        name for name, value in (("owner_id", owner), ("scope_id", scope), ("tenant_id", tenant))
        if not value
    ]
    if missing:
        raise ValueError(f"{', '.join(missing)} required before indexing")
    return index_note(path, embedder, conn,
                      owner, scope, tenant)

class _Handler(FileSystemEventHandler):
    def __init__(self, embedder, conn): self.embedder, self.conn, self._last = embedder, conn, {}
    def on_any_event(self, e):
        if e.is_directory: return
        if not isinstance(e, (FileCreatedEvent, FileModifiedEvent)): return
        if not str(e.src_path).endswith(".md"): return
        now = time.time()
        if now - self._last.get(e.src_path, 0) < 2: return
        self._last[e.src_path] = now
        try:
            handle_change(str(e.src_path), self.embedder, self.conn)
        except ValueError as exc:
            print(f"[watcher] {exc}")

def run(vault_root=None):
    root = vault_root or settings.vault_root
    if not root:
        raise ValueError("vault_root required before watching")
    conn = db.connect(); db.bootstrap_schema(conn)
    embedder = VoyageEmbedder(settings.voyage_api_key) if settings.voyage_api_key else FakeEmbedder()
    obs = Observer(); obs.schedule(_Handler(embedder, conn), root, recursive=True)
    obs.start()
    try:
        while True: time.sleep(1)
    finally:
        obs.stop(); obs.join()
