# Self-Contained Lore — Zero External Dependencies (Codex-planned)

**Goal:** Opening the Lore desktop app requires **no Docker, no system Python, no Postgres/Qdrant servers**.
Everything is embedded + bundled. The fragility that broke the capture hooks (Docker → PG/Qdrant → backend)
is eliminated at the root.

**Architecture (hybrid, already designed):** the **LOCAL app** uses an **embedded stack**; the **team/enterprise
SERVER** keeps Postgres + Qdrant. One codebase, selected by config — not a fork.

## Three external deps to remove
1. **Qdrant server (Docker)** → **embedded Qdrant** (`QdrantClient(path=…)`).
2. **Postgres (Docker)** → **SQLite** (embedded, file-based).
3. **System Python** → **PyInstaller-frozen sidecar** bundled by electron-builder.

## De-risk result (proven, not assumed)
A live test confirmed **embedded Qdrant local mode supports the exact Lore query**: named `dense`+`bm25`
vectors, `query_points` prefetch, **`Fusion.RRF`**, and payload-filtered ACL search — it correctly excluded
an out-of-scope point. So the vector store is a **config switch**, and we keep hybrid+rerank with no FTS5
fallback. (Codex's #1 risk — sparse/RRF parity in local mode — is retired.)

## Codex design decisions
- **Vector store:** keep one interface `dense candidates + BM25 candidates → RRF → rerank`; embedded Qdrant
  is one implementation behind it. Local app uses `path=` (a lock-held dir in userData); server uses `url=`.
- **Database — SQLite local / Postgres server.** Repositories expose **intent-level operations**, not SQL
  strings shared across both. PG-ism ports: `bigserial`→`integer primary key autoincrement`;
  `timestamptz`→ISO-8601 UTC text; `on conflict do update`→portable (verify target clauses);
  `do $$` migration blocks→explicit **versioned migrations**; `kind = any(%s)`→`kind in (?,?,…)`;
  `returning`→supported; `boolean`→integer `0/1`. Bundled Postgres rejected as too heavy.
- **Python bundling: PyInstaller _onedir_ (NOT onefile)** — onefile breaks ONNX Runtime native libs,
  fastembed/tiktoken model files, cold start, and trips AV. Explicitly bundle `fastapi`, `fastembed`,
  `onnxruntime`, `tiktoken`, model dirs, native DLLs. Ship under electron-builder `extraResources`; spawn
  from `process.resourcesPath` as a **supervised child** (health-check, port pick, logs, clean shutdown).
- **Data migration:** the `.md` vault is source-of-truth → **re-index on first launch** into the embedded
  stores; do NOT migrate PG/Qdrant data. Needs an **index manifest** (vault path, file mtimes/hashes,
  embedding-model version, schema version, last successful build) to make rebuilds incremental + crash-safe.

## Phasing (each phase independently shippable)
1. **Embedded Qdrant** — `QdrantClient(path=…)` behind a config switch (`QDRANT_PATH` env). Removes the Docker
   Qdrant dep. Tests stay on the server via env. *(Proven; smallest, lowest risk — do first.)*
2. **SQLite data layer** — a thin DB adapter (`db.py` → dialect-aware): SQLite for local, Postgres for server.
   Versioned migrations replace the `do $$` blocks. Port the enumerated PG-isms. The big phase.
3. **PyInstaller sidecar** — freeze `lore.api` onedir with the ML deps + models; `main.js` spawns it from
   `resourcesPath` with health-check + supervision (replaces the system-`python -m uvicorn` spawn).
4. **electron-builder packaging + first-run re-index** — `extraResources` the sidecar + embedded store dirs
   in userData; index manifest; first-launch progress UI; signed installer (fast-follow).

## Smallest slice that "opens with no Docker + no system Python"
Phases 1–3 together. Phase 1 alone already removes the Qdrant Docker dependency. The biggest remaining
technical risk: **PyInstaller-packaging the native ML stack (onnxruntime/fastembed)** — validate early with
a minimal frozen build before wiring electron-builder.
