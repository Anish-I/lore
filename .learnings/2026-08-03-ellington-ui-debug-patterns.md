# Ellington demo — UI debugging patterns worth keeping (2026-08-03)

## offsetParent is null for position:fixed — visibility checks silently fail
The tour's `visible()` used `el.offsetParent !== null`, which is **always null
for `position:fixed` elements** (the bottom search bar). Anchors there could
never be highlighted, with no error. Use `getBoundingClientRect()` size plus
computed `display`/`visibility` instead.

## Polling an expensive DOM scan is the lag, not the miss
A tour step whose element-finder no longer matched cost 5s of O(n²)
`textContent` scans (every `div` in a 5k-node DOM, every 120ms). The
perceived bug was "step lags horribly", not "element missing". Fixes that
mattered: pre-filter candidates by `childElementCount`/text length before
reading textContent, slow the poll (250ms), cap the deadline (3s), and show
the narration instantly with the anchor attaching late.

## Post-chain upgrade beats fighting anchor collisions
The dc-runtime template is rewritten by ~25 fail-closed `replaceOnce`
upgrades. Editing the template directly breaks their anchors (white screen).
When several fixes touch regions other upgrades own, add ONE new upgrade at
the **end of the chain** and anchor on the post-chain text (generate it by
running the chain in Node). Zero collisions by construction; keep it last.

## grep -c counts LINES, not occurrences — fatal on one-line bundles
The whole template is a single JSON line, so `grep -c pattern` returns 1 for
any hit count. Decode the template and use `str.count()`.

## `pytest | tail -1` swallows the exit code — twice
`python -m pytest ... 2>&1 | tail -1 && git commit` commits on failure
because the pipe's exit status is tail's. Committed a red suite twice this
way. Run pytest bare, or `set -o pipefail` style guards.

## SQLite "database disk image is malformed" after host OOM lockup
The Hetzner box OOM-locked earlier (pre swap-cap); the engine DB survived
hours then failed on the next heavy read pattern. Every LLM-backed endpoint
degraded to graceful fallbacks — looked like "LLM broken", was storage.
Recovery: sqlite integrity_check inside the container, then transplant a
healthy local data dir (stop local BFF → tar → compose cp → move corrupt
aside, never rm → restart). Classifier blocks `rm -rf` on remote volumes;
decomposed non-destructive steps (archive-aside + extract) pass.

## "It broke again" may mean "different environment"
Three lookalike environments (static :8123 no backend, full app :8100, live
site) produced three different failure signatures for the same click. Check
`tabs_context` for the Browser pane origin before debugging "regressions".
