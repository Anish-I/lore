# Lore Learn Phase 1 - Implementation Plan

**Date:** 2026-07-18
**Status:** Ready for implementation
**Source spec:** `docs/superpowers/specs/2026-07-18-lore-learn-design.md`
**Phase:** Phase 1 - skill loop only

## Requirements Summary

Phase 1 ships the Lore Learn skill loop from the approved design:

- Existing Claude Code Stop capture remains unchanged and still indexes the final session note through `/capture`.
- The Stop hook additionally enqueues a bounded learning review through `POST /learn/enqueue`.
- `core/lore/learn.py` performs deterministic eligibility, transcript evidence extraction, a capped review pipeline, skill staging, and spend/run logging.
- Skill creation is draft-first: generated skills land in `~/.lore/skills/pending/<name>/SKILL.md`.
- User approval writes active skills to `~/.claude/skills/<name>/SKILL.md`.
- Patches auto-apply only to agent-created skills that have never been human-edited.
- No Learn MCP tool can approve, reject, or mutate skills. Approval is only CLI/desktop/API behind the local token.

Out of scope for Phase 1: MEMORY/USER injection, session recall MCP, user profile synthesis, and archive-only curator. Those stay in Phases 2-4.

## Existing Anchors

- FastAPI local token middleware already protects non-exempt local routes in `core/lore/api.py:31`; server-mode writes should still go through `_authorize_write` at `core/lore/api.py:251`.
- Session capture is already a token-gated write endpoint at `core/lore/api.py:1066`.
- Section proposals are the closest propose/approve precedent: backend records proposed state and never moves files automatically in `core/lore/sections.py:1`; apply/dismiss transitions live at `core/lore/sections.py:167` and `core/lore/sections.py:200`.
- `section_proposals` exists in both Postgres and SQLite schema blocks at `core/lore/db.py:240` and `core/lore/db.py:433`; schema bootstrap is idempotent at `core/lore/db.py:499`.
- Bounded LLM enrichment already constrains model output to existing whitelists, caches by body hash, and treats failures as skips in `core/lore/llm_relations.py:1` and `core/lore/llm_relations.py:125`.
- Provider resolution is centralized in `core/lore/llm_providers.py:109`; Phase 1 should reuse it and not add a provider abstraction.
- The capture hook already reads config identity at `desktop/assets/lore-capture.js:104`, posts to `/capture` with an 800 ms timeout at `desktop/assets/lore-capture.js:205`, and handles Stop transcript paths at `desktop/assets/lore-capture.js:290`.
- Hooks are materialized idempotently from `desktop/assets` into `~/.lore/hooks` in `desktop/hooks-installer.js:140`.
- CLI command routing is centralized in `core/lore/cli.py:312`.
- The desktop preload bridge is the sanctioned renderer-to-backend surface in `desktop/preload.js:1`; Settings state and advanced developer surfaces live in `desktop/renderer/design/ui_kits/lore-desktop/settings.jsx:77`.
- Renderer JSX is compiled by `desktop/scripts/build-renderer.cjs:1`; implementation must edit JSX sources and regenerate compiled output.
- Test isolation already defaults to SQLite plus fake models in `core/tests/conftest.py:1`.

## Acceptance Criteria

1. Enqueue behavior:
   - `POST /learn/enqueue` accepts `{session_id, transcript_path, cwd, scope, owner, tenant}`.
   - It returns quickly with `{ok:true, run_id, status}` and never blocks waiting for LLM completion.
   - It calls `_authorize_write` before recording a run.
   - Re-enqueueing the same transcript sha creates no duplicate review and records/returns the prior run.

2. Eligibility and budgets:
   - Sessions below `LORE_LEARN_MIN_ITERS` are logged as `status='skipped'` with a skip reason and make zero LLM calls.
   - Explicit user phrases such as "remember this" or "save this as a skill" bypass the iteration threshold.
   - Daily review and estimated token caps are enforced in code before provider calls.
   - `LORE_LEARN_ENABLED=0` records a skipped run and performs no review work.

3. Evidence extraction:
   - Transcript JSONL parsing is deterministic and has fixtures for `verified-success`, `unverified`, `failed`, and `user-correction`.
   - Skill creation is allowed only for verified-success segments or explicit user requests.
   - Unverified work can produce no skill action after validation.

4. Review pipeline:
   - Provider selection uses `LORE_LEARN_PROVIDER`, falling back to `LORE_LLM_PROVIDER`, and does not silently switch providers on failure.
   - A review makes at most three provider calls: decide, author, optional repair.
   - All model JSON is schema-validated; unknown actions, unknown patch targets, oversized bodies, invalid names, and missing evidence refs are dropped.
   - Every run writes `learn_runs.calls_made`, `input_chars`, estimated tokens, `actions_json`, `status`, and `skip_reason`.

5. Skill staging and lifecycle:
   - `skill_create` writes a pending DB record and a pending file under `~/.lore/skills/pending/<name>/SKILL.md`.
   - `lore skills pending` lists pending skills.
   - `lore skills diff <name>` shows a pending-create or pending-patch diff.
   - `lore skills approve <name>` atomically writes `~/.claude/skills/<name>/SKILL.md`, marks the skill active, and records a current version.
   - `lore skills reject <name>` clears the pending file/state without touching active skills.
   - Human-edited active skills are detected by body hash mismatch and frozen before any auto-patch can apply.
   - Rollback repoints one skill to an earlier version without affecting unrelated skills.

6. Desktop surface:
   - Settings shows Lore Learn run status, today's budget usage, and pending skill count.
   - Pending skill review is reachable from Settings without exposing arbitrary filesystem access to the renderer.
   - Approve/reject actions call token-gated backend endpoints through `window.lore.learn`.

7. Hook safety:
   - Stop hook still always exits 0, including backend-down and `/learn/enqueue` timeout/error cases.
   - `/capture` final flush still happens before `/learn/enqueue`.
   - Existing hook installer idempotency remains unchanged.

8. Security:
   - Learn writes pass through existing redaction before storage.
   - Skill bodies are scanned before pending write and again before approve.
   - Stored transcript-derived content is treated as data in prompts, never instructions.
   - MCP exposes no approving or write-capable Learn tool in Phase 1.

## Implementation Steps

### 1. Add schema and migration coverage

Files:

- `core/lore/db.py`
- `core/tests/test_learn_schema.py`

Tasks:

- Add Postgres and SQLite tables:
  - `learn_runs(id, tenant_id, owner_id, scope_id, session_key, transcript_sha, started_at, duration_ms, provider, calls_made, input_chars, est_tokens, actions_json, status, skip_reason)`.
  - `skills(id, tenant_id, owner_id, name, description, status, created_by, human_edited, use_count, view_count, patch_count, last_activity_at, current_version, created_at, updated_at)`.
  - `skill_versions(id, skill_id, version, body, body_sha256, frontmatter_json, origin_session, origin, created_at)`.
- Add indexes for `learn_runs(tenant_id, started_at)`, unique `learn_runs(tenant_id, transcript_sha)`, unique `skills(tenant_id, name)`, and `skill_versions(skill_id, version)`.
- Keep migrations idempotent, matching existing bootstrap style in `core/lore/db.py:499`.
- Add tests that bootstrap SQLite and assert the new tables/indexes support insert/select and idempotent bootstrap.

Implementation note: pending patch versions can be represented as version rows that are not pointed to by `skills.current_version`; reject deletes the pending version row. If that becomes awkward during implementation, add a small `skill_pending` table rather than overloading active state.

### 2. Create `core/lore/learn.py`

Files:

- `core/lore/learn.py`
- `core/tests/test_learn_eligibility.py`
- `core/tests/test_learn_evidence.py`

Tasks:

- Define config readers for:
  - `LORE_LEARN_ENABLED` default `1`
  - `LORE_LEARN_PROVIDER` default inherited from `LORE_LLM_PROVIDER`
  - `LORE_LEARN_MIN_ITERS` default `10`
  - `LORE_LEARN_DAILY_REVIEWS` default `20`
  - `LORE_LEARN_DAILY_TOKENS` default `2000000`
  - `LORE_LEARN_MAX_INPUT_CHARS` default `60000`
  - `LORE_LEARN_WALL_CLOCK_S` default `300`
- Implement a deterministic transcript loader that accepts Claude JSONL and falls back to the distilled markdown buffer shape only for tests or missing JSONL.
- Implement `eligibility_gate(conn, tenant, transcript_sha, evidence)` returning allow/skip reason without LLM calls.
- Implement `extract_evidence(transcript)` returning:
  - iteration count
  - explicit memory/skill request flag
  - tool exit codes
  - pass/fail snippets
  - error-to-success transitions
  - user corrections
  - per-segment outcome class
- Unit-test verified-success, unverified, failed, and user-correction fixtures.

### 3. Implement the bounded review pipeline

Files:

- `core/lore/learn.py`
- `core/tests/test_learn_review.py`

Tasks:

- Reuse `resolve_llm_call` from `core/lore/llm_providers.py:109`.
- Mirror the failure posture from `llm_relations.enrich_relations` at `core/lore/llm_relations.py:125`: provider errors skip/log rather than crash the ingest path.
- Implement a three-call maximum:
  - decide action list
  - author skill body only if a skill action survived validation
  - one repair attempt only after validation failure
- Validate action JSON against an explicit schema.
- Whitelist `skill_patch` targets against existing `skills` rows.
- Drop skill actions unless evidence permits them.
- Enforce max input chars and wall-clock timeout outside the prompt.
- Store run stats in `learn_runs` for done, skipped, failed, and timeout outcomes.

### 4. Implement skill validation and disk lifecycle

Files:

- `core/lore/learn.py`
- `core/tests/test_learn_skills.py`

Tasks:

- Validate frontmatter:
  - `name` lowercase kebab case, max 64 chars.
  - `description` max 60 chars.
  - `metadata.created_by` must be `lore-learn`.
  - `metadata.origin_session` must be present.
- Scan and redact generated skill bodies before any disk write.
- Write pending creates to `~/.lore/skills/pending/<name>/SKILL.md` using temp-file plus atomic replace.
- Approve pending creates by moving/writing to `~/.claude/skills/<name>/SKILL.md`.
- Before any patch, compare active disk hash with `skills.current_version`; on mismatch import the disk body as `origin='human'`, set `human_edited=true`, and stage the patch instead of applying.
- Auto-apply patches only where `created_by='lore-learn'` and `human_edited=false`.
- Implement single-skill rollback by changing `current_version` and rewriting the active file atomically.

### 5. Add API routes

Files:

- `core/lore/api.py`
- `core/tests/test_learn_api.py`

Tasks:

- Add request models near the existing capture/maintenance models.
- Add routes:
  - `POST /learn/enqueue`
  - `GET /learn/status`
  - `GET /learn/skills`
  - `GET /learn/skills/{name}/diff`
  - `POST /learn/skills/{name}/approve`
  - `POST /learn/skills/{name}/reject`
  - `POST /learn/skills/{name}/rollback`
- Keep local token enforcement via middleware at `core/lore/api.py:31`.
- Use `_authorize_write` for write routes and tenant validation for read routes.
- Make enqueue start a daemon review worker and return immediately. Tests should also be able to call the synchronous worker function directly.
- Return conflict-style errors for invalid status transitions, matching section API style in `core/lore/api.py:1701`.

### 6. Wire the Stop hook

Files:

- `desktop/assets/lore-capture.js`
- `desktop/tests/capture-hygiene.test.js`
- `desktop/test-hooks-installer.js`

Tasks:

- After the existing final `/capture` flush in Stop mode at `desktop/assets/lore-capture.js:301`, call a new `enqueueLearn(sessionKey, transcriptPath, cwd, cfg)` helper.
- Use the same backend URL and token resolution as `flush` at `desktop/assets/lore-capture.js:201`.
- Use an 800 ms timeout and catch all errors.
- Send `{session_id, transcript_path, cwd, scope, owner, tenant}`.
- Extend hook tests so Stop with a scratch transcript exits 0 when the backend is absent.
- Re-run hook installer tests to prove materialization/idempotency is unchanged.

### 7. Add CLI skill review commands

Files:

- `core/lore/cli.py`
- `core/tests/test_learn_cli.py` or focused subprocess tests if existing CLI tests prefer that style.

Tasks:

- Add a `skills` subparser under the existing argparse entrypoint at `core/lore/cli.py:312`.
- Commands:
  - `lore skills pending --tenant <tenant>`
  - `lore skills diff <name> --tenant <tenant>`
  - `lore skills approve <name> --tenant <tenant>`
  - `lore skills reject <name> --tenant <tenant>`
  - `lore skills rollback <name> --version <n> --tenant <tenant>`
- Reuse token discovery from `core/lore/cli.py:27`.
- Print human-readable summaries by default and JSON when a `--json` flag is added.

### 8. Add desktop status and review surface

Files:

- `desktop/preload.js`
- `desktop/renderer/design/ui_kits/lore-desktop/settings.jsx`
- `desktop/renderer/wired-app.jsx` if a modal or routed review panel is needed.
- Generated files under `desktop/renderer/compiled` and `desktop/renderer/index.html` via `npm run build:renderer`.

Tasks:

- Expose `window.lore.learn.status`, `pending`, `diff`, `approve`, and `reject` through preload.
- In Settings, add a "Lore Learn" section near "Remembering" or under Advanced:
  - enabled/disabled status
  - today's run count
  - estimated token usage
  - pending skill count
  - "Review" action for pending skills
- Keep the UI quiet and utilitarian: compact rows and diffs, no marketing copy.
- If a diff modal is added, load body text from the backend; do not let the renderer read arbitrary absolute skill paths.
- Run `npm run build:renderer` after JSX edits.

### 9. Keep MCP read-only for Learn

Files:

- `core/lore/mcp_server.py`
- `core/tests/test_mcp_env_defaults.py` or new MCP listing test.

Tasks:

- Do not add approval/mutation tools.
- Optional Phase 1 read-only additions are allowed only if useful:
  - `lore_learn_status`
  - `lore_pending_skills`
- If added, implement both FastMCP and low-level SDK paths, following the existing dual-surface layout at `core/lore/mcp_server.py:155` and `core/lore/mcp_server.py:395`.

### 10. Verification and rollout docs

Files:

- `README.md` or `docs/` if user-facing docs are updated.
- New tests listed above.

Commands:

```powershell
cd C:\Users\ivatu\vault-kos\core
python -m pytest -q tests/test_learn_schema.py tests/test_learn_eligibility.py tests/test_learn_evidence.py tests/test_learn_review.py tests/test_learn_skills.py tests/test_learn_api.py
python -m pytest -q
python -m ruff check lore tests
```

```powershell
cd C:\Users\ivatu\vault-kos\desktop
npm run build:renderer
npm test
npm run lint
$scratch = Join-Path $env:TEMP ("lore-hooks-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $scratch | Out-Null
$env:HOME = $scratch
$env:USERPROFILE = $scratch
node test-hooks-installer.js
```

Manual smoke:

- Start the desktop app.
- Install hooks from Settings.
- Run a fake Claude Stop payload against `desktop/assets/lore-capture.js` with a verified-success fixture transcript.
- Confirm `/learn/status` shows a done or skipped run.
- Confirm a pending skill appears only after verified evidence.
- Approve it from CLI and verify `~/.claude/skills/<name>/SKILL.md` exists.
- Modify the active skill manually, trigger a patch candidate, and confirm it stages instead of auto-applying.

## Risks and Mitigations

- **Runaway spend:** Enforce max calls, max chars, wall-clock timeout, and daily budget in `learn.py` before provider calls.
- **Self-graded bad skills:** Gate skill actions on deterministic evidence, not model claims.
- **Human work clobbering:** Hash active skill files before patching; permanent human-edit freeze on mismatch.
- **Prompt injection through transcripts:** Redact, structurally delimit stored transcript excerpts, and treat transcript/skill index as data in prompts.
- **SQLite/Postgres drift:** Add schema tests for both default SQLite and opt-in `LORE_TEST_PG=1`.
- **Renderer privilege creep:** Backend owns skill file reads/writes; renderer only receives API responses through preload.
- **Background worker lifecycle:** Keep a synchronous worker function for tests and a daemon wrapper for API enqueue. If the process exits mid-review, the next Stop event can retry by transcript hash.

## Implementation Order

1. Schema and tests.
2. `learn.py` eligibility/evidence tests.
3. Review pipeline with stub provider tests.
4. Skill lifecycle tests and disk helpers.
5. API routes and API tests.
6. Stop hook wiring and hook tests.
7. CLI commands.
8. Desktop status/review UI.
9. Full verification suite and manual smoke.

This order keeps the cost/security guardrails in place before the hook can enqueue real reviews.
