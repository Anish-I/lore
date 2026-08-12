# Lore recall was silently dead for a month — fail-open hooks hide infra death

**Date:** 2026-08-03
**Context:** Lore inject/capture hooks (~/.lore/hooks), backend uvicorn :8099, vault-kos docker-compose (postgres :5433, qdrant :6333)

## Problem

`lore-inject.js` produced zero recall in every Claude Code prompt since ~July 1,
with no visible error. Capture kept writing session .md files, so the system
*looked* alive. Chain of causes:

1. The compose containers had been removed at some point (`docker compose down`
   or a Docker reset) and had **no restart policy**, so nothing recreated them
   on boot.
2. `lore-backend-run.py` ran uvicorn **once**: postgres absent → psycopg crash
   on import → process dead until next boot, where it died again.
3. Both hooks are fail-open by design (any error → exit 0, no output), so the
   outage was invisible — prompts just silently lost recall.

## Fixes applied

- `docker-compose.yml`: `restart: unless-stopped` on postgres and qdrant
  (applied to live containers via `docker compose up -d`).
- `~/.lore/lore-backend-run.py`: wrapped the port-wait + uvicorn run in a
  `while True` retry loop (30s backoff) so a crash is no longer permanent.
- Note: recreating containers under a running backend leaves stale psycopg
  connections → 500s on every request. Kill and relaunch the backend
  (`wscript ~/.lore/lore-backend.vbs`) after any container recreate.

## Debugging gotchas (cost real time)

- The backend has **no `/health` route** — a 404 there means UP, not down.
  Probe `POST /context-pack` instead.
- **PowerShell 5.1 pipes prepend a UTF-8 BOM** to native-process stdin.
  `JSON.parse` throws on the BOM, so piping test JSON into a Node hook from
  PowerShell makes it exit silently — a false negative that mimics the real
  failure. Test Node stdin hooks from bash (or strip `﻿`).
- Fail-open + fail-silent memory infra needs an external liveness signal;
  detection here was luck (user asked). A staleness check on `lore.db` mtime
  or a statusline probe of :8099 would catch the next one.
