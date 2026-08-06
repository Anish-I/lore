# Lore Dev — Platform Design

**Date:** 2026-08-06
**Status:** Draft for review
**Repo:** this repo (vault-kos) is repurposed as `lore-dev`, the product repo.
**Engine:** consumed from `Anish-I/lore-arch` exclusively via the frozen `/api/v1`
contract + `LoreClient` SDK. No engine code ships here. Engine gaps discovered
during implementation are closed in lore-arch behind the contract, never worked
around here.

This design adopts the **Municipal Cloud E2E board framework** (Data pipeline ·
Learning loops · Operations · Governance · Reference) as Lore Dev's architecture,
with dev-specific seats swapped in.

---

## Identity

**Lore Dev is "lore for software work" — a developer memory layer.** Every
Claude Code session, prompt, and decision is auto-captured per-repo; `.lore/`
directories carry that memory in git; a GitHub layer lets teams review the AI
trail alongside code; teams share live brains hosted from a member's PC. A tool
factory keeps everything built during sessions organized and reusable.

### Locked decisions

| Decision | Choice |
|---|---|
| Core identity | Dev memory layer (tool factory is a capability, not the center) |
| Repo home | vault-kos repurposed as `lore-dev`; engine stays in lore-arch |
| `.lore` files | A committed `.lore/` directory per repo — human-readable markdown, the reviewable AI trail |
| Claude Code hookup | Hooks for deterministic capture + MCP for recall |
| Teams reach | `lore host` = engine server mode + secure tunnel; join code = **single-use, short-TTL**, exchanged on accept for a per-member API key (engine `/keys`) |
| Build strategy | Big-bang platform, **contract-first**: Phase 0 lands every required engine addition in lore-arch (see "Engine work required"), then one coordinated lore-dev push |
| Tenancy surface | **No organizations anywhere.** Hierarchy is `you → teams → projects`, mapped directly onto the engine's org-free team surface (`/teams`, `/teams/{id}/invites`, `/invites/{id}/accept`). Org tables are never touched. |
| Projects | **Projects ARE GitHub repos** (`owner/name`), never freeform scopes. A repo without a remote is keyed by local path until pushed, then adopts its GitHub identity. |

---

## Architecture overview

```
Claude Code ──hooks (capture)──> lore-dev ──writes──> .lore/   (committed, human-readable)
Claude Code <──MCP (recall)───── lore-dev <──/api/v1── lore engine (:8099, lore-arch)
GitHub PR   <── .lore/ diffs + Action-rendered session summaries
Teammate ───join code──> tunnel ──> host's engine (server mode, team ACL)
Tool factory ──capture/reuse loops──> tools registry (indexed in brain)
```

Repo layout:

```
lore-dev/
  cli/        # single entry point: lore dev init|status|host|join|review|tools
  capture/    # Claude Code hook scripts (SessionStart, UserPromptSubmit, Stop)
  mcp/        # recall MCP server — thin proxy over /api/v1
  spec/       # .lore/ format spec + validator (the platform's one sacred contract)
  github/     # GitHub Action: render session records as PR check summaries
  teams/      # host / tunnel / join-code logic
  factory/    # tool registry + capture/reuse loops
  skills/     # kept from vault-kos — seeds the factory registry
  tools/      # kept from vault-kos — seeds the factory registry
  eval/       # kept — nightly gate harness (Loop 2)
```

Gutted from vault-kos: the archived engine copy (`core/`, `api/`), `desktop/`.

---

## 1. Data pipeline — a session's journey from prompt to reviewable memory

Same 17-step spine as the board; dev sources and stores swapped in.

### Sources (step 1)

- **Claude Code sessions** — via hooks (the "collector tray" seat).
- **`.lore/` directories** — in every initialized repo; also the ingest path for
  records written by teammates and pulled via git.
- **GitHub events** — PR/issue links (post-v1 enrichment, see GitHub layer).

### Capture seats (steps 2–5)

Three Claude Code hooks, all deterministic — capture is never at the model's
discretion:

1. **SessionStart** — opens a working record in `.lore/.local/`, stamps branch +
   HEAD sha. **Orphan recovery:** if a prior session's working record was left
   unfolded (crash, kill, interrupt — Stop is not guaranteed to fire), fold it
   now before opening the new one. Capture loss is the platform's worst silent
   failure; this is the backstop.
2. **UserPromptSubmit** — appends each user prompt verbatim to the working
   record.
3. **Stop** — the fold:
   - diff HEAD to find commits made and files touched during the session;
   - distill Intent / What-was-done via the local engine's LLM seat (Ollama
     Gemma; **extractive fallback if Ollama is down — degrade to less detail,
     never lose data**);
   - run the **redaction backstop** (secret patterns, key-shaped strings, .env
     content) **before anything is written to a committed file or embedded**.
     Redaction is defense-in-depth, never a single scanner: an independent
     gitleaks-class scan also runs as a pre-push hook and as a PR check, so one
     false negative does not reach GitHub;
   - write the final markdown session record to `.lore/sessions/`;
   - POST the record to the engine for indexing (chunk → contextualize → embed,
     the engine's existing path — markdown with frontmatter needs no new engine
     code).

### The `.lore/` format (the managed-store boundary)

```
.lore/
  lore.toml          # project id (owner/name), engine binding, capture level, scrub rules, team scope
  sessions/          # one file per session — the review trail
    2026-08-06-a1b2c3-fix-auth-races.md
  decisions/         # durable records folded out of sessions (or written explicitly)
    2026-08-06-tunnel-over-lan.md
  .local/            # GITIGNORED: raw transcripts, working records, cache
```

Session record:

```markdown
---
id: a1b2c3
date: 2026-08-06T14:02:11Z
tool: claude-code          # extensible: cursor, copilot, ...
branch: dev
commits: [abc1234]         # shas made during the session — treated as HINTS (see Loop 1)
patch_ids: [f3e9...]       # git patch-id per commit — the stable join key that
                           # survives rebase and squash-merge
files_touched: [core/auth.py, tests/test_auth.py]
---
# Fix auth token race

## Intent          — what the human wanted, distilled
## Prompts         — the user's prompts, VERBATIM (the review artifact)
## What was done   — distilled actions and outcomes, with file references
## Decisions       — links into decisions/, e.g. [[tunnel-over-lan]]
```

Properties:

- **Frontmatter carries Stop-time facts only.** Anything unknowable at Stop
  time (did this ship? did it survive review?) is NOT in the file — it lives as
  engine feedback events (`/feedback/event`) and is rendered by the GitHub
  Action. Committed records are never rewritten after the fact.
- **One file per session, append-only** → no merge conflicts, clean PR diffs.
- **Verbatim prompts, distilled everything else.** Raw transcripts stay in
  `.local/` (gitignored) — size and secrecy both demand it.
- **Default capture level: `full` (verbatim prompts committed).** Prompt review
  IS the product; a default that hides prompts guts it. The safety valve is the
  layered redaction above, plus a documented `capture_level = distilled` in
  `lore.toml` for sensitive repos (prompts then stay in `.local/`, only
  distilled Intent/What-was-done is committed).
- **`sessions/` → `decisions/` mirrors engine upkeep** (ephemeral → durable
  fold), surfaced as reviewable git files.
- `spec/` ships a validator; the format is versioned (`lore.toml` carries
  `format_version`). Records are forward-readable: unknown frontmatter keys are
  preserved, never dropped.

### Stores (step 6) — git is the Box

The board's "Box boundary" maps to **git**: the committed `.lore/` layer is the
managed source of truth for session/decision records. Engine **note content**
(notes/chunks + Qdrant vectors) is derived and rebuildable from `.lore/` +
personal notes. **Accepted loss on rebuild** (engine-local state that is NOT in
git, stated explicitly): feedback events, ask_history, query_log, and folded
graph/fold state. Expand-context reads the repo itself as truth. Deletes
propagate: folding or deleting a record tombstones it in the engine
(`folded_paths`) and purges vectors downstream on next sync. Because git can
delete files without a "save" event (pull, rebase, branch switch), the watcher
alone is insufficient — **a reconcile pass (indexed paths vs directory listing)
runs on every upkeep tick** to detect removals; cross-brain deletes propagate
via git and each engine reconciles independently.

### Retrieval lane (steps 7–17, minus the cut seats)

Served unchanged from the engine: classify → hybrid (dense + BM25, **ACL inside
each lane**) → RRF → cross-encoder → blend → note signals → exact-ID lane
(commit shas, issue numbers, file paths jump the queue) → adaptive k → expand
context. Answers carry a **GREEN / AMBER / RED confidence stamp** derived from
retrieval score distribution — Claude is told when memory is thin instead of
being handed false certainty. Stamp thresholds are **versioned with the eval
harness** and mandatorily recalibrated when the pending EmbeddingGemma +
MiniLM-L-12 swap ships — score distributions are model-specific. (The board's
NLI fact-check seat is cut from v1 — see Cuts.) Exact-ID matching of commit
shas / file paths / issue numbers is a Phase 0 verify item — the engine lane
may match note ids only today.

### Recall surface (MCP)

The engine already ships its own MCP stdio transport; for single-brain recall
it would suffice. The lore-dev MCP server exists for exactly two reasons —
**multi-brain federation** (below) and the **factory registry tools** — and is
a thin proxy over `/api/v1` for everything else.

One MCP server, three tools:

| Tool | Job |
|---|---|
| `lore_recall` | hybrid search over this project's brain + personal brain + joined team brains |
| `lore_context_pack` | session-start briefing: recent decisions, open threads on this branch (engine `/context-pack`) |
| `lore_tools_find` | "do I already have a tool that does X?" — searches the factory registry |

Plus a `UserPromptSubmit` injection hook (opt-in per repo via `lore.toml`) that
prepends a small recall block to prompts — the pattern already proven by the
existing personal-lore hook.

Scope layering for recall: **project brain → personal brain → joined team
brains**, ACL-filtered in-query.

**Federation semantics (owned by the lore-dev MCP proxy, not the engine):**
remote brains are separate engines; nothing in the engine queries another
engine. The proxy fans out **in parallel with a hard per-brain deadline
(~400 ms)**; a brain that misses the deadline is reported as `timed-out`, never
silently dropped. Confidence is computed **per brain by its own engine**;
results are merged as **labeled per-brain lists — cross-engine score blending
is forbidden** (cross-encoder distributions from different engines are not
comparable, so a blended stamp would be numerically meaningless).

---

## 2. Learning loops

**Loop 1 — the merge is the grade.** The board's "sent vs draft diff" becomes
*what the AI did vs what survived review and merge*. Grading is by **git
patch-id, never by sha**: rebase and squash-merge rewrite shas on exactly the
workflows that matter, so frontmatter `commits:` are hints and `patch_ids:`
are the stable join key. A session's patches found in the default branch =
shipped; superseded by heavy rewrite = partial; vanished = abandoned. Grades
are recorded as **engine feedback events** (`/feedback/event` — exists),
never written back into committed records. Force-pushes that orphan a
patch-id downgrade the grade to `unknown`, not `abandoned`. v1 **captures**
grades only; weight-nudging (bounded, capped, per the board) is enabled once
enough graded sessions exist to evaluate against.

**Loop 2 — nightly fail-closed eval gate.** Carried over as-is: the `eval/`
harness runs nightly against the local engine; recall-floor regression alarms;
**no data or a zero score counts as FAILURE, never as silence** (July outage
lesson). Bake-offs for embedder/reranker swaps follow the board's decision rule
(≥ +3pp recall@5 at ≤ 1.5× p95).

**Loop 3 — per-team tuning.** Future: per-repo gold sets → LoRA reranker →
isotonic confidence calibration. Gated on the gold sets existing first. Not
built in v1.

---

## 3. Operations

### Personal mode (default)

`lore dev init` in a repo: reads the git remote → registers the project
(`owner/name`) with the local engine as a brain scope → writes `.lore/lore.toml`
+ `.gitignore` entry for `.local/` → installs the Claude Code hooks + MCP server
into the repo's `.claude/` config. Zero tenancy parameters — personal-first,
exactly like the engine.

**`.local/` exclusion is a hard init-time assertion.** If the engine's watcher
cannot register a watch path with ignore rules (Phase 0 verify item), the
watcher is NOT pointed at `.lore/` at all — records are ingested via explicit
`/ingest` calls from the Stop hook instead. Raw transcripts being indexed even
once is a governance failure, not a degraded mode.

**`lore dev upkeep` is the single writer of `decisions/`.** Engine upkeep folds
notes but writes no files; the dual-truth hole between git and the engine graph
is closed by one triggered (never looping) lore-dev command that reads engine
fold state and materializes decision records — nothing else touches that
directory.

Always-on seats (reusing the existing `~/.lore` deployment): the engine
(:8099, VBS launcher + crash-retry), file watcher / explicit-ingest path per
the assertion above, nightly `LoreUpkeep` (fold, classify, decay — now
including the delete-reconcile pass), nightly eval gate, staleness watchdog
(db mtime + port probe — and **assert listening PID == launched PID**, the
zombie lesson).

### Team mode — org-free

- `lore host` — flips the local engine to serve selected projects: binds the
  API for remote access, opens a secure tunnel (**Tailscale tailnet-only
  preferred; Cloudflare quick tunnel is a fallback that prints a warning** —
  ephemeral, no edge auth), creates a team via the engine's org-free team
  surface, and mints a **join code**: single-use, short-TTL (default 15 min),
  encoding tunnel URL + invite id. One public port, TLS at the tunnel edge —
  the board's Caddy principle.
- `lore join <code>` — accepts the invite (`/invites/{id}/accept`) and
  **exchanges it for a per-member API key** (`/keys`); the code itself is dead
  after one use, so a leaked join code in chat history or shell history is
  worthless. The shared projects then appear in the teammate's recall lane as a
  federated brain (per the federation semantics above). Live while the host PC
  is on.
- **Git is the offline baseline:** when the host is off, teammates still have
  the committed `.lore/` layer via normal git pull; their local engine indexes
  it. Live tunnel = hot recall; git = cold sync. The two compose.
- Host revoke: `lore host --revoke <member>` invalidates the invite token;
  ACL removal is immediate on the host engine.

### GitHub layer

1. **The diff is the review** — PRs naturally include `.lore/sessions/*.md`;
   reviewers see prompts + what-was-done next to the code diff. Zero
   infrastructure.
2. **The `lore-dev` Action, two triggers:**
   - **On PR open/update** — joins the PR's commits to session records (by
     patch-id) and posts one check-run summary: sessions involved, intent,
     prompt count, files the AI touched vs changed by hand, grades to date.
   - **On push touching `.lore/**` on any branch** — posts a commit status /
     digest. This is the non-PR surface: exploratory and abandoned sessions —
     often the most review-worthy — get a GitHub surface even when no PR ever
     opens ("alongside/**instead of** pull requests" is the ask).
3. **Repo = project sync** — identity, collaborator hints, and default branch
   come from GitHub. Post-v1: PR/issue links become graph edges so "what did
   we decide about X" cites the PR where it landed.

### CI/CD + release path

Same shape as the board: PR gates (ruff, tests, `.lore/` validator, 3-OS) →
merge dev/main → PyInstaller freeze of the CLI (`lore-dev` binary; engine binary
already ships from lore-arch) → smoke-boot → draft release. The GitHub Action
ships from this repo (`github/`) and is versioned with the format spec.

---

## 4. Governance

- **No organizations.** Surface hierarchy: you → teams → projects (repos).
- **ACL inside retrieval** — team/project permission filters run inside each
  search lane, never post-hoc.
- **Private by default** — raw transcripts never leave `.local/`; the redaction
  backstop runs **before** any write to committed files and before any
  embedding. `lore.toml` scrub rules are additive (defaults cannot be disabled,
  only extended).
- **Per-team isolation** — a joined brain exposes only the projects the host
  selected; personal brain is never served.
- **Deletes propagate** — tombstone + purge downstream (engine `folded_paths`
  contract); a record deleted from `.lore/` is tombstoned on next index pass.
- **Draft-first** — Lore Dev never pushes, commits, or posts on its own;
  everything it produces lands as reviewable files or PR check output.
- **Fail-closed gates** — eval gate alarms on silence; capture hooks log their
  own failures to `.local/` and surface them in `lore dev status`.
- **Audit** — engine `query_log` (hashes only) covers recall; hook writes are
  append-only files in git — the audit log is the repo history itself.

---

## 5. Tool factory

The "constantly retrieving and building tools in an organized way" subsystem —
a registry plus two loops, not a free-running agent:

- **Registry** — each tool is a folder with `tool.toml` (name, purpose, inputs,
  provenance: `built` in session N / `retrieved` from URL, projects-used-in,
  last-used). Seeded from existing `skills/` and `tools/`. Manifests + source
  indexed into the brain as documents.
- **Capture loop** — the Stop hook flags new executable artifacts created
  during a session (plus explicit `lore tools add`); they're registered and
  indexed. Nothing built is forgotten.
- **Reuse loop** — `lore_tools_find` (MCP) answers "do I already have this?"
  before Claude rebuilds it. Upkeep folds the registry: dedupe near-identical
  tools, promote session-scratch → durable, decay unused entries.
- **Outside retrieval** (search GitHub for existing tools before building) is
  **v2**: v1 organizes what you make; v2 hunts.

---

## Engine work required (lore-arch, Phase 0 — lands and ships BEFORE lore-dev code)

Big-bang only works if the contract additions ship first; this list is the
sequencing fix. Verified against the live `/api/v1/health` capabilities
(2026-08-06): `/context-pack`, `/scopes` + grants, org-free `/teams` +
`/teams/{id}/invites` + `/invites/{id}/accept`, `/feedback/event`, `/keys`,
`/search`, `/ingest`, `/recent-prompts` all **exist** — the platform needs no
invite or context-pack invention.

| # | Item | Type |
|---|---|---|
| 1 | Watch-path registration with ignore rules (`.local/`) | **Verify, likely build** — hard blocker for `lore dev init` (explicit-ingest fallback specced) |
| 2 | Scope registration keyed `owner/name` | **Verify** — `/scopes` exists; confirm arbitrary keys in the frozen contract |
| 3 | Multi-scope fan-in (project + personal + teams) in one query with layering | **Build** — RRF fuses lanes, not scopes, today |
| 4 | Team surface on the SQLite dialect (`lore host` from a laptop, no Postgres) | **Verify, likely build** |
| 5 | Delete detection support (reconcile endpoint or indexed-paths listing) | **Build** (small) |
| 6 | Score-distribution exposure in `/search` responses (for the confidence stamp) | **Verify, likely small build** |
| 7 | Exact-ID lane matching payload tokens (shas, paths, issue numbers) | **Verify** |

Everything else in this design builds on surfaces that already exist.

---

## Cut from v1 (explicit)

| Board seat | Disposition |
|---|---|
| NLI fact-check on answers | Cut — confidence stamp from retrieval scores only; revisit if hallucinated-recall reports appear |
| Draft pre-warmer | Cut |
| Loop 1 weight-nudging | Capture-only in v1; nudging gated on data volume |
| Loop 3 per-team tuning | Future, gated on gold sets |
| OCR / ASR / media lanes | Engine keeps them; Lore Dev never surfaces them |
| Box adapter | Replaced by git |
| Web UI | v1 is CLI + hooks + MCP + GitHub Action; UI later, designed in Claude Design |
| Organizations | Removed from all surfaces permanently (not deferred) |

---

## Error handling

- **Hook failures never break a session** — hooks exit 0 on internal error,
  log to `.lore/.local/errors.log`, and `lore dev status` surfaces the backlog.
- **Engine down** — capture still writes markdown to `.lore/` (git remains
  truth); indexing catches up on next watcher/upkeep pass. Recall MCP returns
  an explicit "engine unavailable" rather than empty results (fail-closed on
  silence).
- **Ollama down** — distillation degrades to extractive; records marked
  `distill: extractive` so upkeep can re-distill later.
- **Tunnel drops** — teammates fall back to git-synced baseline automatically
  (their local engine already indexes pulled `.lore/`); `lore join` retries
  with backoff.
- **Zombie/port collisions** — launcher asserts listening PID == launched PID
  before reporting healthy (2026-08-04 lesson, now doctrine).

## Testing & eval

- **Format spec** — golden-file tests for the validator; forward-compat test
  (unknown keys preserved).
- **Hooks** — integration tests driving a scripted fake session end-to-end:
  session → `.lore/` record → indexed → recallable. Windows + macOS + Linux in
  CI (hooks are the most platform-sensitive surface).
- **Recall quality** — nightly gate reuses the existing `eval/` harness with a
  dev-flavored gold set (sessions/decisions Q&A pairs) added over time.
- **Teams** — contract tests against a second engine instance: join, ACL
  isolation (teammate must NOT see unshared projects — the test that matters),
  revoke, tunnel-drop fallback.
- **GitHub Action** — fixture PRs with `.lore/` records; snapshot-test the
  rendered check summary.

## Deferred (post-v1 backlog)

- Outside tool retrieval (GitHub hunt before build).
- PR/issue links as graph edges; "what did we decide about X" citing the PR.
- Loop 1 weight-nudging; Loop 3 per-team tuning.
- `.lore` bundle export (single-file portable brain) for sharing outside git.
- Additional capture adapters: cursor, copilot (format's `tool:` field is ready).
- Web UI (Claude Design surface).
