# Fix C1 / I1 / I4 Report

## Test command

```
cd C:\Users\ivatu\vault-kos\core
python -m pytest -v
```

## Full pytest summary

```
============================= test session starts =============================
platform win32 -- Python 3.11.0, pytest-8.4.1, pluggy-1.6.0
rootdir: C:\Users\ivatu\vault-kos\core
plugins: anyio-4.13.0, langsmith-0.9.2, asyncio-1.3.0, benchmark-5.2.3

collected 13 items

tests/test_api.py::test_ask_returns_citations PASSED                     [  7%]
tests/test_chunker.py::test_chunks_carry_heading_path PASSED             [ 15%]
tests/test_chunker.py::test_no_chunk_exceeds_token_max PASSED            [ 23%]
tests/test_contextualize.py::test_short_chunk_needs_context PASSED       [ 30%]
tests/test_contextualize.py::test_selfcontained_chunk_skips_context PASSED [ 38%]
tests/test_contextualize.py::test_apply_context_prepends_metadata_blurb_without_llm PASSED [ 46%]
tests/test_db.py::test_bootstrap_creates_tables PASSED                   [ 53%]
tests/test_index_recall_e2e.py::test_index_then_recall_returns_cited_chunk PASSED [ 61%]
tests/test_index_recall_e2e.py::test_acl_excludes_other_scope PASSED     [ 69%]
tests/test_index_recall_e2e.py::test_reindex_removes_stale_chunks PASSED [ 76%]
tests/test_rrf.py::test_rrf_rewards_agreement PASSED                     [ 84%]
tests/test_watcher.py::test_handle_change_indexes_md PASSED              [ 92%]
tests/test_watcher.py::test_handle_change_missing_file_returns_zero PASSED [100%]

============================= 13 passed in 1.98s ==============================
```

## Commit hashes

| Fix | Commit | Message |
|-----|--------|---------|
| C1  | `555456c` | fix(core): delete stale qdrant points on reindex (C1) |
| I1  | `3669ee2` | fix(core): wrap indexer PG writes in a transaction (I1) |
| I4  | `3876d85` | fix(core): watcher ignores delete/missing files (I4) |

## Changes made

### C1 — `core/vault/qdrant_store.py`
Added `delete_note(note_id: str) -> None` that deletes all Qdrant points matching
`payload.note_id`, guarded by a collection-existence check.

### C1 — `core/vault/index.py`
Called `qdrant_store.delete_note(note_id)` after `ensure_collection` and before
the PG transaction / Qdrant upsert.

### C1 — `core/tests/test_index_recall_e2e.py`
Added `test_reindex_removes_stale_chunks`: indexes a two-section note, re-indexes
with the second section removed, asserts the removed section's text is no longer
recalled. Uses a per-run `uuid.uuid4()` suffix on scope/tenant to prevent
cross-run Qdrant contamination.

### I1 — `core/vault/index.py`
Wrapped the note-upsert + delete-chunks + insert-chunks block in
`with conn.transaction():`. The Qdrant upsert remains outside (after) the PG
transaction so PG is committed before vector writes proceed.

### I4 — `core/vault/watcher.py`
- `_Handler.on_any_event`: added `isinstance(e, (FileCreatedEvent, FileModifiedEvent))`
  guard so deleted/moved events are silently ignored.
- `handle_change`: added `os.path.isfile(path)` guard; returns 0 without raising
  when the file is absent or is a directory.

### I4 — `core/tests/test_watcher.py`
Added `test_handle_change_missing_file_returns_zero`: calls `handle_change` with
a non-existent `.md` path and asserts the return value is 0 with no exception.

## Deviations from plan

None. All changes follow the specification exactly.
- The `delete_note` implementation matches the spec verbatim.
- psycopg3 `with conn.transaction():` works correctly with `autocommit=True` connections.
- The C1 test uses `uuid.uuid4()` for scope/tenant isolation (not in spec but necessary
  to prevent cross-run Qdrant contamination — pure correctness improvement, no scope change).
