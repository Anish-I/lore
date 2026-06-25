# Vault Backlog (deferred from M1 review)

Findings from the M1 whole-branch review that are correctly out of M1 scope.

## M3 (recall quality)
- **I2 — real hybrid recall.** M1's "lexical lane" only re-ranks the dense candidate set (term-overlap over raw payload text), so it cannot surface docs dense missed, and "Contextual BM25" (context prepended to the sparse index) is not implemented. Replace with real Qdrant sparse vectors (BM25/SPLADE) as an independent lane; normalize + stopword the lexical terms. This is where the documented recall lift actually lands.
- **Test isolation.** pytest e2e shares the live Qdrant/Postgres with no per-run isolation. Use an ephemeral collection + unique tenant per test run (or testcontainers). Also fixes Fake(8-dim) vs Voyage(~2048-dim) collection-dim clashes.
- **Eval harness.** Stand up recall@20 gold-set eval; A/B contextualization vs naive (gate before locking).
- **PG as read source.** Recall returns Qdrant payload text; `chunks` table is written but never read. Decide: payload is the read path (fast) vs hydrate from PG (true source of truth).

## M4 (scopes + cross-person)
- **I3 — authn.** `/ask` trusts client-supplied `principal_scopes`/`tenant_id`. Bind principal → scopes server-side before multi-person scopes ship. Hard gate for M4.

## M2 (ingestion breadth)
- **I4 follow-up.** Watcher now ignores deletes; add real de-index on delete/rename (remove PG + Qdrant rows).
- Chunker: split single paragraphs that exceed target_max; implement small-chunk merge (target_min currently unused).

## Later
- `synthesize()` is a deterministic template, not an LLM NL answer (spec §4.5) — swap in LLM generation behind the existing seam.
- Connection pool instead of one shared psycopg connection in api.py.
