# Run M1 (single-vault loop)

1. `docker compose up -d`            # starts Qdrant (:6333) + Postgres (:5433)
2. `cd core && pip install -e ".[dev]"`
3. (Optional) set `VOYAGE_API_KEY` in `.env` for real embeddings/rerank. Blank = FakeEmbedder (loop still works).
4. Start the core API:  `python -m uvicorn vault.api:app --port 8099`
5. Index a note:
   ```
   curl -s localhost:8099/reindex -H 'content-type: application/json' \
     -d '{"path":"../sample-vault/acme.md","owner_id":"alice","scope_id":"alice-private","tenant_id":"t1"}'
   ```
6. Ask:
   ```
   curl -s localhost:8099/ask -H 'content-type: application/json' \
     -d '{"question":"why is the Acme renewal at risk?","principal_scopes":["alice-private"],"tenant_id":"t1"}'
   ```
   Expect the top citation to be `Acme Account > Renewal` (champion left).
7. (Optional) Node proxy: `cd api && CORE_URL=http://localhost:8099/ask npm start` then POST the same body to `:3030/ask`.

## Watcher (continuous)
`cd core && python -c "from vault.watcher import run; run('../sample-vault')"` — edits to `.md` files auto-reindex.

## Note
The pytest e2e suite shares the live Qdrant/Postgres and does not isolate per-run; after running tests,
flush before a clean demo:
`python -c "from qdrant_client import QdrantClient; from vault.config import settings; QdrantClient(url=settings.qdrant_url).delete_collection('vault_chunks')"`
and `truncate notes, chunks cascade`. (Test isolation is a tracked hardening item — see M3.)
