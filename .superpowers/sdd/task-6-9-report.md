# Task 6-9 Implementation Report

## Per-Task Status

| Task | File(s) | Status |
|------|---------|--------|
| 6 | `core/vault/distill.py`, `core/vault/index.py` | DONE |
| 7 | `core/vault/recall.py`, `core/tests/test_index_recall_e2e.py` | DONE |
| 8 | `core/vault/api.py`, `core/tests/test_api.py` | DONE |
| 9 | `core/vault/watcher.py`, `core/tests/test_watcher.py` | DONE |

## Test Results

```
python -m pytest core/tests/ -v
11 passed in 1.39s
```

Full breakdown:
- test_api.py::test_ask_returns_citations                          PASS
- test_chunker.py::test_chunks_carry_heading_path                  PASS
- test_chunker.py::test_no_chunk_exceeds_token_max                 PASS
- test_contextualize.py::test_short_chunk_needs_context            PASS
- test_contextualize.py::test_selfcontained_chunk_skips_context    PASS
- test_contextualize.py::test_apply_context_prepends_metadata_blurb_without_llm  PASS
- test_db.py::test_bootstrap_creates_tables                        PASS
- test_index_recall_e2e.py::test_index_then_recall_returns_cited_chunk  PASS
- test_index_recall_e2e.py::test_acl_excludes_other_scope          PASS
- test_rrf.py::test_rrf_rewards_agreement                          PASS
- test_watcher.py::test_handle_change_indexes_md                   PASS

## Key Deviations / Implementation Notes

### Qdrant Point ID Handling
The plan uses sha1 hex strings (24 chars) as `chunk_id`, but Qdrant requires point IDs to be either unsigned integers or UUIDs. Implemented exactly as specified:
- `chunk_id` = `hashlib.sha1(...)hexdigest()[:24]` — used as Postgres PK and stored in Qdrant payload
- `qdrant_id` = `str(uuid.uuid5(uuid.NAMESPACE_URL, cid))` — used as the actual Qdrant point ID
- Recall returns `chunk_id` from payload (not the UUID), maintaining consistent identity across PG and Qdrant

### FakeEmbedder Dim
Default dim=8 was sufficient — no ranking instability observed. Both recall tests passed without needing to increase dim to 64.

### ACL Test
`test_acl_excludes_other_scope` passes cleanly — bob-private chunks are filtered at the Qdrant query level via `MatchAny` on `scope_ids`, never reaching the ranking stage.

### Docker Prerequisites
- Qdrant: `localhost:6333` — running (vault-kos-qdrant-1)
- Postgres: `localhost:5433` — running (vault-kos-postgres-1)

## git log --oneline

```
1fbda2a feat(core): watchdog folder watcher with debounce
b3b89b0 feat(core): FastAPI /ask + /reindex with citations
7e243b1 feat(core): hybrid recall (RRF+rerank) + e2e index/recall/ACL tests
e20b0ed feat(core): indexer pipeline note->chunks->embed->PG+Qdrant
0cd6b68 feat(core): qdrant collection + ACL-filtered vector search
dbb044a feat(core): embedder/reranker protocols with fakes + RRF fusion
597fc0a feat(core): selective contextual-retrieval blurb (metadata default + llm hook)
d9e5254 feat(core): markdown AST chunker with heading paths + token budget
e03e9d5 feat(core): scaffold infra, config, postgres schema
ea2e83f Add M1 implementation plan (single-vault loop, 11 TDD tasks)
5834ce9 Resolve runtime: Python core + thin Node API; default LLM/seed for M1
bf7ef97 Add Vault knowledge-OS design spec (walking skeleton)
```
