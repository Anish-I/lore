# Learnings: recall ceiling gap analysis (2026-07-20)

1. **fastembed's `query_embed` is a no-op for BGE models** — `TextEmbedding.query_embed`
   falls through to plain `embed()` (verified in `text_embedding_base.py:46-61` of the
   installed package); the BGE-recommended query instruction is never applied anywhere
   in the package. Any pipeline using fastembed + BGE for retrieval silently loses the
   documented query-side prefix. Fix is prepending the instruction string yourself,
   query-side only.

2. **Benchmark the ceiling at scale, not on the friendly set.** Nightly (46 q) r@5 0.848
   vs LoCoMo full run (1,982 q / 5,882 notes) r@5 0.715 — small live-vault gold sets
   saturate and hide ~2x the headroom. Check `eval/history/locomo.jsonl` before claiming
   recall health.

3. **`bench_locomo.py` drops LoCoMo's question-category labels** (multi-hop / temporal /
   single-hop; line ~130 only skips adversarial). Without the split, losses can't be
   attributed to a lane. When adding a benchmark, always carry the dataset's own strata
   into the report row.

4. **Feature-flag archaeology pays**: `apply_context(..., llm=None)` + `needs_context`'s
   <120-token guard meant "contextual retrieval" was believed on but effectively off for
   most chunks, while the two-stage payload split it feeds was already measured
   (LoCoMo r@1 0.239→0.503). Grep the call sites of a "shipped" mechanism before
   attributing eval numbers to it.

5. **UI gate and runtime gate must be ONE predicate.** Auto-apply sections v1 gated
   the runtime on `cfg.autoApplySections !== false` while the settings switch showed
   `autoApplySections && autoClassify && identityReady` — so with detection off but
   stale proposals present, files would move while the UI said auto-apply was
   off/disabled (Sol's review catch). Fix: a named helper (`autoApplySectionsEnabled`)
   used by every consumer. Whenever a toggle has both a renderer representation and
   a main-process behavior, grep for the second gate before shipping.

6. **Auto-apply needs undo→dismissed.** With proposals auto-applying on every upkeep
   run, an undo that returns state to 'proposed' is re-applied next run — undo must
   transition to a sticky terminal state or the system fights the user.

7. **Bulk indexing had TWO quadratic terms, confirmed by elimination** on the
   insurance 5000-note runs: (a) `qdrant_store.delete_note` — unindexed payload
   scan per note in embedded local mode (18→6 notes/s); after bypassing it the
   curve STILL bent (21→5 notes/s), exposing (b) `index.py:350` rebuilding
   `relations.build_title_index` per ingested note — one compiled regex per
   existing title, all run over each body: ~25M compiles at 5k notes. With both
   bypassed, throughput is FLAT at 21-22 notes/s through 3000+ notes (linear).
   Production fix candidates: fresh-store fast path for (a); api.py-style TTL
   title-index cache shared into index_document for (b). Live G12 evidence —
   the desktop vault pays both on every bulk reconcile.

8. **Token-economics reality check (progressive disclosure #5)**: compact ID-first
   search index beats FULL-NOTE injection 2.7× (search+hydrate-one: 2.0×), but is
   ~even with top-8 CHUNK injection when chunks are small — snippet length is the
   lever. Competitor "10×" claims assume naive full-note injection as baseline.

9. **Enron corpus on Windows: files named `1.` (trailing dot) are INVISIBLE to
   normal Win32 paths** — `stat`/`open` silently strip the dot and miss every
   file, so globs "succeed" with zero results. Fix: `\\?\` extended-length
   prefix on the root path before any pathlib traversal. Also: the CMU tarball
   is ~443MB compressed (the page's "about 1.7Gb" is the unpacked size) — a
   clean curl exit at 443MB is NOT a truncated download.

10. **Real-data validation pattern that worked**: owners' own Enron folders as
   clustering gold (strict precision = lower bound, proposal list for human
   review), known-item queries from corpus-unique verbatim phrase PAIRS with
   title-word exclusion. Results: boundary metric held on real email (160/160),
   pooled r@1 0.913, zero merge proposals across 120 real folders (safe but
   zero healing — the v2 gates are recall-conservative on real data), and the
   no-answer separation NARROWS on real text (0.10 worst case) → G10 threshold
   must be per-corpus calibrated.

11. **Note IDs are a GLOBAL primary key across tenants** — two test files using
   id "g-1" under different tenants silently collide ("on conflict do nothing"
   swallows the second insert) and the failure only appears in full-suite
   order. Prefix every test's note ids with a file-unique slug.

12. **Verify causal attribution before writing it down**: "0 sections
   auto-created" was reported as fragmentation-protection when the actual
   cause was propose_sections' source_path filter (sim notes have no paths).
   The rerun exposed it because the number REFUSED to move when its supposed
   cause was fixed. A metric that doesn't respond to its explanation's removal
   was never explained by it.

13. **PowerShell + git commit -m: embedded double quotes split the message
   into pathspecs** (bit twice this session). Keep commit messages free of
   `"` characters inside @'...'@ here-strings, or the args shatter.

14. **Cowork protocol**: parallel independent gap analyses (Claude audit + Sol
   literature-anchored critique from the same pasted evidence) converged on the same
   top-3 and each contributed uniques (Sol: eval statistical power, LTR framing,
   exact-lane ordering; Claude: LoCoMo-at-scale anchor, fastembed/contextualize
   code verification, latency non-attribution). Paste eval numbers INTO the dispatch —
   Sol's ceiling math (miss counts from rates) was immediately load-bearing.
