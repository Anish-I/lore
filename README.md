# Lore 📖

**Your company's lore — the stuff people "just know," made searchable.**

Lore is an enterprise knowledge OS. A local agent watches each employee's files, distills them into linked
Markdown, and indexes everything into a permissioned, recall-obsessed retrieval engine. Each person's **vault**
becomes queryable; teams ask across vaults within their **scope**. Ask anything; know everything.

```
$ lore ask "why'd we drop the Acme renewal?"
```

## Why Lore
- **Permissioned by design** — every note carries a scope (private / team / circle / enterprise); retrieval is
  filtered *inside* the query, so you only ever see what you're allowed to. Verified: 210 adversarial cross-scope
  probes, **zero leakage**.
- **Recall you can trust** — hybrid dense (BGE) + BM25 sparse + cross-encoder rerank + query-adaptive fusion, plus
  a dedicated exact-match lane. On a 46k-note simulated insurer: **exact-ID recall@1 = 100%**, semantic ~75–83%.
- **Runs on your hardware** — local models (fastembed BGE + cross-encoder, Ollama for answers). No API keys, no
  data leaving the building. Voyage is a pluggable option, not a dependency.
- **Knowledge survives people** — when someone leaves, re-tag their notes to the team. Transfer is just a label.

## Architecture
- **Python core** (`core/lore/`, FastAPI) — ingestion, indexing, recall. `lore.api` on `:8099`.
- **Node proxy** (`api/`) — thin `/ask` forwarder.
- **Qdrant** — vector + BM25 retrieval (ACL filter in-query). **Postgres** — source of truth + scopes + graph.
- Models: BGE-small-en-v1.5 (dense) · Qdrant/bm25 (sparse) · ms-marco-MiniLM-L-6-v2 (rerank) · gemma4 (answers).

## Quick start
```
docker compose up -d                      # Qdrant :6333 + Postgres :5433
cd core && pip install -e ".[dev,local]"  # local = offline models
python -m uvicorn lore.api:app --port 8099
# open http://localhost:8099/  (live retrieval pipeline visualizer)
```

## Demo & tests
- `sim/generate_company.py` — generate a 46k-note simulated car-insurance company (Apex Auto Insurance).
- `sim/benchmark.py` — accuracy (recall@1/@3/MRR). `sim/audit_scopes.py` — per-scope adversarial ACL audit.
- `eval/run_eval.py` — multi-domain semantic eval. `pytest` in `core/` — unit + integration suite.

See `docs/superpowers/specs/` for the design spec and `docs/BACKLOG.md` for the roadmap.
