# Vault M1 Progress Ledger

Plan: docs/superpowers/plans/2026-06-25-vault-m1-single-vault-loop.md
Branch: m1-single-vault-loop

Task 1: complete (commit e03e9d5, verified 7 passed incl schema)
Task 2: complete (commit d9e5254, chunker tests pass)
Task 3: complete (commit 597fc0a, contextualize tests pass)
Task 4: complete (commit dbb044a, RRF + fakes tests pass)
Task 5: complete (commit 0cd6b68, qdrant_store imports; query_points adaptation for qdrant-client 1.18)
Task 6: complete (commit e20b0ed, indexer)
Task 7: complete (commit 7e243b1, recall + e2e + ACL gate verified)
Task 8: complete (commit b3b89b0, FastAPI /ask+/reindex)
Task 9: complete (commit 1fbda2a, watcher)
Note: Qdrant point ids use uuid5(NAMESPACE_URL, chunk_id); chunk_id kept in payload + PG PK.
