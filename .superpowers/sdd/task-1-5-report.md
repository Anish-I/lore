# Vault M1 Tasks 1–5 Implementation Report

**Branch:** m1-single-vault-loop  
**Date:** 2026-06-25  
**Python:** 3.11.0  
**qdrant-client:** 1.18.0  
**psycopg:** 3.2.3 (psycopg[binary])

---

## Per-Task Status

| Task | Description | Status |
|------|-------------|--------|
| 1 | Scaffold infra, config, Postgres schema | DONE |
| 2 | Markdown AST chunker with heading paths + token budget | DONE |
| 3 | Selective contextual-retrieval blurb | DONE |
| 4 | Embedder/Reranker protocols with Fakes + RRF fusion | DONE |
| 5 | Qdrant store (collection + ACL-filtered vector search) | DONE |

---

## Test Commands & Output

### Task 1 – Schema bootstrap

**Failing run (before db.py):**
```
ERROR tests/test_db.py
ImportError: cannot import name 'db' from 'vault'
1 error during collection
```

**Passing run (after db.py):**
```
tests/test_db.py::test_bootstrap_creates_tables PASSED
1 passed in 0.52s
```

### Task 2 – Markdown chunker

**Failing run (before chunker.py):**
```
ERROR tests/test_chunker.py
ModuleNotFoundError: No module named 'vault.chunker'
1 error during collection
```

**Passing run (after chunker.py):**
```
tests/test_chunker.py::test_chunks_carry_heading_path PASSED
tests/test_chunker.py::test_no_chunk_exceeds_token_max PASSED
2 passed in 0.87s
```

### Task 3 – Contextual retrieval blurb

**Failing run (before contextualize.py):**
```
ERROR tests/test_contextualize.py
ModuleNotFoundError: No module named 'vault.contextualize'
1 error during collection
```

**Passing run (after contextualize.py):**
```
tests/test_contextualize.py::test_short_chunk_needs_context PASSED
tests/test_contextualize.py::test_selfcontained_chunk_skips_context PASSED
tests/test_contextualize.py::test_apply_context_prepends_metadata_blurb_without_llm PASSED
3 passed in 0.10s
```

### Task 4 – Embedder/Reranker + RRF

**Failing run (before fusion.py):**
```
ERROR tests/test_rrf.py
ModuleNotFoundError: No module named 'vault.fusion'
1 error during collection
```

**Passing run (after fusion.py, embed.py, rerank.py):**
```
tests/test_rrf.py::test_rrf_rewards_agreement PASSED
1 passed in 0.01s
```

### Task 5 – Qdrant store (import check)

```
python -c "import vault.qdrant_store; print('import OK')"
import OK
```

### Full suite (Tasks 1–4)

```
tests/test_db.py::test_bootstrap_creates_tables PASSED             [ 14%]
tests/test_chunker.py::test_chunks_carry_heading_path PASSED        [ 28%]
tests/test_chunker.py::test_no_chunk_exceeds_token_max PASSED       [ 42%]
tests/test_contextualize.py::test_short_chunk_needs_context PASSED  [ 57%]
tests/test_contextualize.py::test_selfcontained_chunk_skips_context PASSED [ 71%]
tests/test_contextualize.py::test_apply_context_prepends_metadata_blurb_without_llm PASSED [ 85%]
tests/test_rrf.py::test_rrf_rewards_agreement PASSED                [100%]

7 passed in 0.28s
```

---

## Deviations from Plan

### 1. `models.py` — `has_context` field and `has_context_text()` merged into single dataclass

The plan split models.py across Task 2 (basic Chunk) and Task 3 (adds `has_context` and `has_context_text()`). To avoid a test import error when test_contextualize runs, `has_context: bool = False` and `has_context_text()` were included in the initial `models.py` write. This is faithful to the final spec; it just happened in one step rather than two.

### 2. `qdrant_store.py` — `query_points` instead of `search`

`_client.search()` was removed in qdrant-client 1.7+. The installed version (1.18.0) no longer has it; `query_points` is the supported API. The public `qdrant_store.search(vector, allowed_scope_ids, tenant_id, limit)` signature is unchanged. ACL filter (tenant_id MatchValue + scope_ids MatchAny) is applied inside the `query_points` call as required. Return format is identical: list of `{"score": ..., **payload}` dicts.

### 3. Port mapping unchanged

Port 6333 was free (checked via `docker ps`). No port remapping needed.

---

## Commit Hashes

```
0cd6b68 feat(core): qdrant collection + ACL-filtered vector search
dbb044a feat(core): embedder/reranker protocols with fakes + RRF fusion
597fc0a feat(core): selective contextual-retrieval blurb (metadata default + llm hook)
d9e5254 feat(core): markdown AST chunker with heading paths + token budget
e03e9d5 feat(core): scaffold infra, config, postgres schema
```
