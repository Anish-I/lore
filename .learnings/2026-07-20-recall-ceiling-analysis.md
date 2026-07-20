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

9. **Cowork protocol**: parallel independent gap analyses (Claude audit + Sol
   literature-anchored critique from the same pasted evidence) converged on the same
   top-3 and each contributed uniques (Sol: eval statistical power, LTR framing,
   exact-lane ordering; Claude: LoCoMo-at-scale anchor, fastembed/contextualize
   code verification, latency non-attribution). Paste eval numbers INTO the dispatch —
   Sol's ceiling math (miss counts from rates) was immediately load-bearing.
