# File-Anchored Recall — Structured Observations (#4) + Pre-Read History Hook (#3)

**Date:** 2026-07-21 · **Status:** In progress
**Origin:** claude-mem competitive analysis, joint Claude/Sol recommendation
(#3 "most differentiating for the dev persona", #4 "the enabling investment").
**Split:** Claude — schema, extraction, API, tests (touches db/learn internals);
Sol — the PreToolUse hook script + installer wiring (self-contained, contract below);
cross-review both ways per the standing workflow.

## #4 — Structured observations (the enabler)

**What:** typed, per-session work records with machine-readable anchors:

```
observation = {
  id, tenant_id, session_id, ts,
  type:      bugfix | discovery | decision | refactor | workaround | config,
  summary:   1-2 lines, human-readable,
  facts:     [string],          # atomic claims worth recalling
  concepts:  [string],          # tags for filtered search
  files_read:     [repo-relative or absolute paths],
  files_modified: [paths],
  origin_note_id,               # the captured session note
  outcome:   verified-success | failed | unverified   # from learn.extract_evidence
}
```

**Design decisions:**
1. **Deterministic core, model garnish** (learn.py's existing philosophy).
   `files_read` / `files_modified` come straight from `tool_use` blocks in the
   transcript (Read/Glob/Grep→read; Edit/Write/MultiEdit/NotebookEdit→modified) —
   no LLM involved, can't hallucinate paths. `type`/`summary`/`facts`/`concepts`
   are LLM-proposed under learn.py's provider/budget/wall-clock guards with
   STRICT JSON output (their XML parser fragility is the anti-pattern we're
   avoiding); on provider-unavailable, a deterministic fallback emits a single
   observation typed from evidence signals (outcome + correction/fail regexes)
   with summary = first user ask, facts = [].
2. `load_transcript` currently DROPS tool_use blocks — extended to collect
   `{tool, file_path}` pairs (paths only; arguments/content never stored).
3. Storage: new `observations` table (PG + SQLite lanes), ADD-only, plus a
   `observation_files(observation_id, path_norm)` join table — `path_norm` is
   casefolded, forward-slashed, and indexed: this IS the `files_touched` lane.
4. Each observation also indexes as a small note (`source_type='observation'`,
   memory_type 'agent') so lore_search/lore_get find them organically.
5. Extraction rides the existing learn queue (same enqueue → run_queued path,
   same daily budgets); one extraction pass per captured session.

**API:**
- `GET /observations?tenant=&file=<path>&limit=5` — newest-first observations
  whose `observation_files.path_norm` suffix-matches the normalized query path
  (suffix match: hook sends absolute paths, sessions may store relative).
  Response: `{observations:[{ts, type, summary, outcome, session_id, files_modified}]}`.
- `GET /observations?tenant=&session=<id>` — per-session listing (UI later).

**Gates:** unit tests for tool_use path capture (incl. absent/malformed blocks),
strict-JSON parse fallback, suffix matching; suite stays green; extraction on a
real captured session note from this repo produces sane output (manual check).

## #3 — Pre-read file history hook

**What:** PreToolUse hook (matcher: Read) that asks the local API for past
observations about the file and, when any exist, emits additionalContext:

```
Lore: you've worked on this file before —
  · 7/20 bugfix (verified): auto-apply sections gate mismatch fixed (session …)
  · 7/18 decision: L6 reranker made the local default (session …)
```

**Contract (Sol's workstream — lore-file-history.js):**
- stdin: Claude Code PreToolUse JSON `{tool_name, tool_input:{file_path}, session_id, cwd}`.
- Gate order, all local: (1) tool_name must be Read; (2) skip if file_path under
  node_modules/.git/dist/build or a temp dir; (3) per-session dedup — keep a seen
  set in `%TEMP%/lore-file-history-<session_id>.json`, one injection per file per
  session; (4) `GET http://localhost:<port>/observations?file=...&limit=3` with
  X-Lore-Token from the same config discovery lore-capture.js uses; timeout 800ms;
  (5) on ANY failure/empty → exit 0 silently (never block a Read, never emit noise).
- Output: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"…"}}`
  ≤ 400 tokens, newest first, dates humanized, outcome tag only when verified/failed.
- Installer: add PreToolUse entry (matcher "Read") to hooks-installer.js using the
  existing entry shape + _lore tagging + additive merge; uninstall path removes it.

**Gates:** desktop vitest for the gating/dedup/formatting logic (factor pure
functions); end-to-end smoke against the local API; hook failure can never
break a Read (exit-0 guarantee).

## Non-goals this cycle
- No UI surface (What Lore Knows panel for observations = follow-up).
- No SessionStart digest change (#2 waits for real-vault token telemetry).
- No retro-extraction backfill over historical sessions (opt-in job later).
