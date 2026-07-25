# Learnings: doc-tree municipal build (2026-07-24)

1. **`## Page N` markers are load-bearing outside ocr.py** — the eval harness
   recovers per-page provenance by regex-splitting note BODIES on
   `^## Page (\d+)$` (`eval/scenarios/run_onboard_directory.py`,
   `reconstruct_ocr_metrics`). Any ingest step that rewrites extracted markdown
   must preserve page-marker lines verbatim (level may deepen: regex is now
   `^#+ Page (\d+)$`). Grep for the marker pattern before touching extraction
   output format.

2. **Dataclass attribute stashing dies at rebuild sites.** Side-channel data
   attached to a dataclass instance (`page.textract_headings`) is silently
   dropped wherever the pipeline REBUILDS instances instead of mutating
   (`strip_running_lines` returns new `PageText` objects). If you stash, audit
   every constructor call site downstream — or the loss is invisible until an
   end-to-end test catches an empty result.

3. **`pytest | tail` in a `&&` chain commits red states.** The pipe's exit code
   is `tail`'s, so `pytest -q | tail -3 && git commit` commits even when tests
   fail. Keep test-run and commit as separate tool calls, or use
   `python -m pytest -q; if [ ${PIPESTATUS[0]} ... ]`.

4. **`git add <file>` on a file with pre-session uncommitted mods sweeps them
   into your commit.** ocr.py and run_onboard_directory.py carried in-progress
   changes from before the session (visible in opening git status `M` lines);
   adding the whole file folded them into feature commits. Check
   `git diff HEAD <file>` vs your own edits before adding files that were
   already dirty at session start.

5. **ccb codex (Sol) ask path can fail while ping succeeds** — 4/4 heavy asks
   exited 1 with empty output while `ccb_ping_codex` returned healthy
   (codex-cli 0.125.0). Fallback per debate-panel workflow: Kimi K3 via
   `~/.claude/tools/kimi.mjs` — but pass long prompts via STDIN, not argv:
   >40KB argv fails with `Argument list too long` (exit 0 from the wrapper
   chain, empty output file — check the `.err` file).

6. **Alphabetical `--limit N` eval subsets can be structurally blind.** The
   first 50 municipal PDFs are all 1-2-page lighting-committee agendas — zero
   numbered headings, so a doc-tree run produces zero nodes and looks like a
   no-op. `builder_version` stamping is what distinguishes "ran and honestly
   found nothing" from "didn't run." Gate structured-ingest features on a
   CONTENT-STRATIFIED subset (budgets/ordinances/audits), not a filename-order
   prefix.

7. **Kimi/Moonshot API fails on large POST bodies from node fetch** (25-42KB
   chat completions die with `fetch failed` while an authed GET returns 200 and
   a ~5KB completion succeeds). Chunk review payloads to <~15KB or review
   file-by-file.

8. **Reusing a review flag as a structure gate over-blocks numeric corpora.**
   `numeric_content` (≥4 numeric tokens/page) exists to mean "don't trust OCR'd
   NUMBERS arithmetically," but `clears_confidence` treats any review reason as
   non-clearing — so 8/8 real budget/audit PDFs got zero structural nodes even
   where OCR confidence was fine. When borrowing an existing quality flag for a
   new gate, re-derive what the flag is evidence OF; a numbers-untrustworthy
   page can still have trustworthy heading text. (Tracked as a gated follow-up,
   not hot-fixed: loosening a safety guard goes through the eval gate.)

9. **Textract LAYOUT is guard-compatible structure for scanned pages.**
   `LAYOUT_TITLE`/`LAYOUT_SECTION_HEADER` blocks reference CHILD LINE blocks,
   so node titles are OBSERVED page text (never generated) — they satisfy the
   doc-tree "observed-only" confidence rule where local heuristics have nothing
   to work with. Cost-route: only escalate pages RapidOCR scored below
   `_REVIEW_CONF`; native pages get structure free from PyMuPDF.
