# Lore Learn — Design Spec

**Date:** 2026-07-18
**Status:** Approved design, pending implementation plan
**Origin:** Source-level audit of NousResearch/hermes-agent (learning loop, memory, recall, user modeling) + community-sentiment research (123 findings; see ObsidianVault/Wingman/Knowledge/Hermes Agent Deep Dive.md and Hermes Community Sentiment.md).

## 1. Overview

Lore Learn adds a **post-task learning loop** to Lore: after a Claude Code session ends, a bounded review worker examines the transcript and (a) creates or patches **skills** (reusable procedures, agentskills.io `SKILL.md` format), (b) curates **durable memory** (char-budgeted MEMORY/USER docs), (c) makes sessions **recallable** across time, and (d) maintains a synthesized **user profile**. Skills approved by the user land in `~/.claude/skills/`, where Claude Code auto-discovers them — so every consumer (interactive sessions, OpenClaw, h-cli) benefits with zero injection work.

The design steals Hermes Agent's validated pattern (post-task background review; patch-over-create bias; anti-poisoning capture rules; provenance separation; plaintext on disk) while fixing the three failure adjectives its community identified: **unbounded** (→ hard caps in the harness), **self-graded** (→ external-evidence gating), **auto-committing** (→ draft-first staging + human-edit freeze).

### Goals
- Sessions compound: solved problems become skills; learned facts become memory; past work is findable.
- The loop can never damage what the user wrote, never spend unboundedly, never act silently.
- Everything inspectable: plaintext SKILL.md on disk, versioned nodes in Lore, spend log per review.

### Non-goals
- No agentic open-ended review loop (Hermes' 91M-token incident); reviews are fixed-call pipelines.
- No Wingman/SMS integration in v1 (Claude Code-family consumers only).
- No cloud/hosted review; the loop runs against the locally configured LLM provider.
- No auto-approval of new skills in v1 (config flag exists but defaults off).

## 2. Architecture

```
Claude Code session ends (Stop hook)
  └─ lore-capture.js stop  ──POST /learn/enqueue {session_id, transcript_path, cwd}
                                   │ (existing /capture flow unchanged)
                                   ▼
                    core/lore/learn.py  (new module)
                    1. eligibility gate (deterministic, no LLM)
                    2. evidence extraction from transcript JSONL (no LLM)
                    3. review pipeline: ≤3 provider calls via llm_providers.resolve_llm_call
                    4. actions validated → skills (pending) / memory docs / learn_runs spend log
                                   │
        ┌──────────────────────────┼───────────────────────────┐
        ▼                          ▼                           ▼
  skills tables + versions   memory docs (notes)        session notes (existing)
  ~/.lore/skills/pending/    injected via lore-inject   upkeep folding (existing)
        │ user approves (desktop UI / CLI)
        ▼
  ~/.claude/skills/<name>/SKILL.md   ← Claude Code auto-discovers
```

All new server code follows existing conventions: routes inline in `core/lore/api.py` guarded by `_local_token_guard`/`_authorize_write`, DB via the shared conn, LLM via `core/lore/llm_providers.py`, bounded-inference pattern cloned from `core/lore/llm_relations.py` (hash-keyed cache, JSON-schema validation, whitelist guards, confidence thresholds).

## 3. Components

### 3.1 Trigger (hook side)
- Extend `desktop/assets/lore-capture.js` `stop` mode: after the existing `/capture` flush, POST `{session_id, transcript_path, cwd, tenant, owner, scope}` to `POST /learn/enqueue`. Timeout 800 ms, always exit 0 (fail-open: a dead backend never blocks Claude Code shutdown).
- No new hook entries needed — `hooks-installer.js` already registers Stop; bump the materialized script version.

### 3.2 Eligibility gate (deterministic, in `learn.py`)
Runs before any LLM call. Skip (and log the skip reason to `learn_runs`) unless:
- transcript has ≥ N tool-calling iterations (default 10, `LORE_LEARN_MIN_ITERS`) — Hermes' threshold, or an explicit user "remember this / save this as a skill" utterance is detected;
- daily budget not exhausted (`LORE_LEARN_DAILY_REVIEWS` default 20; `LORE_LEARN_DAILY_TOKENS` estimate cap);
- session not already reviewed (keyed by transcript sha256 in `learn_runs`).

### 3.3 Evidence extraction (deterministic, no LLM)
Parse the transcript JSONL into an **evidence digest**:
- tool results: Bash exit codes, test-runner pass/fail lines, error→success transitions;
- user corrections: user messages following assistant actions that reverse/adjust them ("no, don't", "that's wrong", style complaints);
- skill usage: `Skill` tool invocations and hook-visible skill loads (feeds telemetry: `use_count`);
- outcome class per task segment: `verified-success` (exit 0 after failures, tests pass), `unverified` (no observable check), `failed`.

This digest — not the model's self-assessment — is what licenses skill creation. **Rule: skills may only be minted from `verified-success` segments or explicit user requests; `unverified` work can produce memory notes at most.** (Community finding: "it always thinks it did a good job. ALWAYS.")

### 3.4 Review pipeline (≤3 provider calls, hard-capped)
Cloned from the `llm_relations.enrich_relations` shape, using `resolve_llm_call(LORE_LEARN_PROVIDER)` (codex / claude / byok-Together; falls back to skipping, never to another provider — no silent fallbacks):
1. **Call 1 — decide:** input = distilled transcript (capped chars) + evidence digest + current skill index (names + one-liners only) + current MEMORY/USER docs. Output = JSON action list: `[{action: skill_patch|skill_create|memory_add|memory_replace|memory_remove|noop, target, rationale, evidence_ref}]`. Schema-validated; unknown actions/targets dropped; `skill_patch` targets must exist in the index (whitelist guard).
2. **Call 2 (only if a skill action survived) — author:** produce/patch the SKILL.md body. Frontmatter validated (name ≤64 lowercase-kebab class-level, description ≤60 chars, `metadata.created_by: lore-learn`, `metadata.origin_session`). Body ≤ 20k chars.
3. **Call 3 (optional, only on validation failure) — one repair attempt.** Then give up and log.

The review prompt ports Hermes' proven content — patch-over-create preference order (patch loaded skill → patch umbrella → add reference file → create), class-level umbrella naming rules, first-class treatment of user style corrections, and the verbatim anti-poisoning list (no environment-dependent failures, no negative tool claims, no transient errors, no one-off narratives) — **minus all completionist pressure**. "Nothing to save" is framed as a normal outcome, not a missed opportunity (Hermes' "be ACTIVE" line directly caused its worst cost incident).

Caps enforced in code, not prompt: max 3 calls, `LORE_LEARN_MAX_INPUT_CHARS` (default 60k), wall clock 300 s, thread killed on timeout.

### 3.5 Skills: storage, staging, lifecycle
- **Data model (new tables, added to `db.py` bootstrap):**
  - `skills(id, tenant_id, owner_id, name UNIQUE, description, status: pending|active|archived, created_by: user|lore-learn, human_edited bool, use_count, view_count, patch_count, last_activity_at, current_version, created_at, updated_at)`
  - `skill_versions(id, skill_id, version, body, frontmatter_json, origin_session, origin: create|patch|human, created_at)` — single-skill rollback = repoint `current_version`.
  - Each active skill is also indexed as a note (`source_type='skill'`, `memory_type='durable'`) so hybrid search finds skills; provenance edge `origin='capture'` from skill note → origin session note.
- **Staging (draft-first, the `section_proposals` pattern):** `skill_create` → status `pending`, body written to `~/.lore/skills/pending/<name>/SKILL.md`. Surfaced in the desktop app (badge + diff view) and CLI (`lore skills pending|diff|approve|reject`). On approve → status `active`, atomically written to `~/.claude/skills/<name>/SKILL.md`.
- **Patches:** auto-apply ONLY when target is `created_by='lore-learn'` AND `human_edited=false`; new version recorded; disk file updated. Otherwise the patch is staged as pending-diff for approval.
- **Human-edit freeze:** on every review, disk body hash is compared with `current_version`; mismatch ⇒ `human_edited=true` forever (the disk edit is imported as an `origin='human'` version first, so nothing is lost). Frozen skills are never auto-patched.
- **Curator:** a new budgeted upkeep step (`upkeep.py`), archive-only (status → `archived`, disk file moved to `~/.lore/skills/archive/`), acting only on `created_by='lore-learn'` skills with zero activity for `LORE_LEARN_STALE_DAYS` (default 45). Max K archives per pass (default 3). Never deletes, never consolidates in v1.

### 3.6 Memory docs (Phase 2)
- Two per-owner durable notes, Hermes-style: `MEMORY` (agent working notes, 2,200-char budget) and `USER` (who the user is, 1,375-char budget), stored as notes (`source_type='learn-memory'`), edited only through `memory_*` actions with server-side budget enforcement (reject + require `memory_replace`/`remove` when over).
- **Injection:** extend `desktop/assets/lore-inject.js` (UserPromptSubmit) to prepend the two docs once per session (frozen per session for cache stability), inside the existing `<lore-memory-context>` fencing that `lore-capture.js` already strips from captures (echo-loop protection already exists).

### 3.7 Session recall (Phase 3)
- Captures already exist (`claude-session` notes). Add `lore_recall_sessions` MCP tool (in `mcp_server.py`) with Hermes' three inferred modes: **discovery** (query → hybrid search restricted to session/`claude-session` notes, hits returned with surrounding context), **scroll** (page within one session note), **browse** (recent sessions). Zero LLM cost. Upkeep's folding continues untouched; folded topic nodes remain the durable layer.

### 3.8 User profile (Phase 4)
- New upkeep step: synthesize/refresh a `USER-PROFILE` durable note (one bounded LLM call, hash-cached — skip if underlying facts unchanged) from `USER` doc + people/topic nodes.
- New MCP tool `lore_profile_query(question)`: retrieval scoped to profile + user-fact notes, extractive by default, optional single LLM call. This is the local, private answer to Hermes' Honcho dialectic.

### 3.9 Spend visibility
- `learn_runs(id, session_key, transcript_sha, started_at, duration_ms, provider, calls_made, input_chars, est_tokens, actions_json, status: done|skipped|failed|timeout, skip_reason)`.
- `GET /learn/status` returns today's run count, estimated spend, and the last 20 runs; the desktop settings page displays it. Daily-budget exhaustion is never silent: the run is recorded with `skip_reason='budget'` and the UI shows a visible notice.

## 4. Security
- All Learn writes go through existing redaction (`redact.py`) before storage; skill bodies additionally scanned before disk write, and scanned again at approve time.
- Provenance tags on every stored artifact (`created_by`, `origin_session`, origin edges). Stored content interpolated into review prompts only inside structural delimiters with an explicit "data, not instructions" preamble (Hermes closed this as not-planned; we do it from day one).
- Approval is user-only: desktop UI and CLI. The MCP surface exposes read/list of pending skills but **no approve tool** — an agent must never approve its own learning.
- `/learn/*` routes sit behind `X-Lore-Token` like everything else; localhost bind unchanged.

## 5. Error handling
- Hook side: 800 ms timeout, always exit 0.
- Review worker: any provider error/timeout → `learn_runs.status='failed'`, no retry storm (next session retriggers naturally); no cross-provider fallback.
- Validation failure after repair call → drop actions, log.
- Disk writes atomic (temp + rename), matching hooks-installer conventions.

## 6. Testing
- Unit: eligibility gate, evidence extractor (fixture JSONLs: verified-success / unverified / user-correction), budget enforcement, frontmatter validation, human-edit freeze, version rollback.
- Golden-transcript tests: fixture transcripts → assert decide-call JSON (patch-vs-create-vs-noop) against a stubbed provider.
- E2E (following existing `e2e-*.js` style): fake session → enqueue → pending skill on disk → approve via CLI → file in `~/.claude/skills/` → new session's skill list contains it; plus a rollback E2E.
- Eval-gate friendly: `learn_runs` gives the nightly eval lane a hook to assert "no review exceeded caps."

## 7. Phasing
1. **Phase 1 — skill loop:** hook trigger, eligibility, evidence extraction, review pipeline, skills tables/staging/approval CLI + desktop badge, spend log. Ships alone; immediately useful.
2. **Phase 2 — memory docs:** MEMORY/USER budgeted docs + lore-inject injection.
3. **Phase 3 — recall:** `lore_recall_sessions` MCP tool.
4. **Phase 4 — profile + curator:** profile synthesis + `lore_profile_query` + archive-only curator in upkeep.

## 8. Config summary (all env, defaults in parens)
`LORE_LEARN_ENABLED` (1) · `LORE_LEARN_PROVIDER` (inherits `LORE_LLM_PROVIDER`) · `LORE_LEARN_MIN_ITERS` (10) · `LORE_LEARN_DAILY_REVIEWS` (20) · `LORE_LEARN_DAILY_TOKENS` (2,000,000 est) · `LORE_LEARN_MAX_INPUT_CHARS` (60,000) · `LORE_LEARN_WALL_CLOCK_S` (300) · `LORE_LEARN_AUTO_APPROVE` (0; reserved, no-op in v1) · `LORE_LEARN_STALE_DAYS` (45)
