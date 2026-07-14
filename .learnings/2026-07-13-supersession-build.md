# Learnings: supersession build (2026-07-13)

1. **`db._SqliteCursor` lacked `rowcount`** — any code checking `cur.rowcount` after
   UPDATE/DELETE silently got 0 via `getattr(cur, "rowcount", 0)` on the SQLite lane
   (worked fine on Postgres). Added a psycopg-parity property; if a write-then-check
   pattern misbehaves only on SQLite, suspect wrapper parity first.

2. **Notes too short to chunk have no Qdrant points.** `index_document` returns 0 and
   creates nothing for tiny bodies — payload-flag operations (e.g. `set_superseded`)
   then no-op silently. Test fixtures need bodies long enough to chunk (~2 sentences).

3. **Module-level env gates read at import time.** `supersede.py` constants
   (`LORE_SUPERSEDE_TITLE_MIN` etc.) can't be tuned via `monkeypatch.setenv` in tests —
   monkeypatch the module attributes instead (same as `recall.SUPERSEDED_WEIGHT`).

4. **Cowork-with-Codex protocol:** Sol's shell was broken (PowerShell 8009001d), so he
   wrote defensively (signature introspection, multi-schema query attempts). Giving him
   the exact schema/signatures in the task prompt matters more than file ownership —
   his guessed column names (`src`/`dst` vs `src_note_id`/`dst_note_id`) were the main
   integration cost. Always paste real DDL into delegation prompts.

5. **Eval-metric trap:** a supersedes-wikilink embeds the old note's TITLE inside the
   new note's text — any stale-detection that matches on titles false-positives on the
   current note. Keep fact values out of titles in gold pairs; detect by value strings.
