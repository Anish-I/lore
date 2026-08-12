# Ellington demo: server state must survive restarts, or "once-ever" flows replay

**Date:** 2026-08-02
**Context:** lore-ellington-demo BFF (FastAPI, embedded Qdrant)

## Problem

The demo's bootstrap sequence (discovery → index → organize inbox → generate
task list) is a once-per-corpus event, but it replayed on every BFF restart.
Two independent causes:

1. `PROGRESS` (bootstrap done-flag + derived tasks) lived only in process
   memory. Every server restart — which happens every time an endpoint is
   added — reset `done` to false, so the UI re-ran the loading screen.
2. The frontend had no session memory: it always walked
   signin → setup → loading → mfa on page load.

## Fix pattern (applies to any "run once, ever" demo state)

- Persist the completed state to a JSON file at the moment of completion
  (`data/bootstrap-state.json`), reload it at module import.
- Belt-and-braces inference at startup: if the durable stores prove the work
  happened (notes table has rows) but the state file is missing, reconstruct
  the state silently (re-derive tasks, mark done, save) instead of replaying
  the user-visible flow. Cheap derivations can rerun; user-visible ceremonies
  must not.
- Frontend: a localStorage flag set on setup completion + a status check on
  mount jumps straight to the working UI; Log out clears the flag.

## Rule of thumb

In this demo every piece of engine output already had a file-backed cache
(drafts.json, workflow.json, confirmations.json...) EXCEPT the bootstrap
progress itself — the one thing gating the whole first-run UX. When adding
in-memory state to the BFF, ask: "does anything user-visible depend on this
surviving a restart?" If yes, give it a JSON file + load-on-start like the
others, or infer it from durable stores.
