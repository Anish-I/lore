# Kimi K3 design review — lore-dev platform spec

**Date:** 2026-08-06 · **Model:** kimi-k3 (Moonshot API, streaming) · Reviewed spec commit 4b60395

> Note: Kimi reviewed a condensed engine summary. Claims of absent API surfaces were
> fact-checked against live /api/v1/health afterwards — /context-pack, /scopes, org-free
> /teams invites, /feedback/event, /keys all EXIST. Remaining real gaps moved into the
> spec's 'Engine work required (Phase 0)' section.

## 1. FIT

**Correctly reused (verified against A):**

- **Markdown ingest via existing distill path.** Engine distills md/txt/pdf/docx and chunks on the heading tree; session records are heading-structured markdown. Two-stage store (embed enriched, payload raw) fits "verbatim prompts" recall exactly. Sound.
- **Upkeep mirror.** `sessions/ → decisions/` fold maps cleanly onto engine upkeep (ephemeral → durable, ADD-only, tombstone sources). Conceptually aligned.
- **ACL-in-lane, redaction-pre-embed, folded_paths tombstones, one public port, feedback table, exact-ID lane, eval gate.** All exist per A and are reused in the right places.
- **Personal-first init.** Zero-tenancy `lore dev init` matches the engine's API-key personal mode.

**Silently assumed (unverified or absent):**

| Assumption | Engine surface | Verdict |
|---|---|---|
| `/context-pack` endpoint for session-start briefing | `/api/v1` | **Absent from A.** Spec names it in parentheses as if it exists. It doesn't. |
| Multi-scope fan-in with priority layering (project → personal → team) in one query | read path / RRF | **Absent.** A shows ACL filters inside lanes, not multi-scope union with ordering. RRF fuses dense+BM25, not scopes. |
| Remote brain recall (joined team brains "in the recall lane, ACL-filtered in-query") | entire engine | **Absent.** Engine is one process; nothing queries a remote engine. Federation is lore-dev's problem and the spec never says who merges. |
| Scope registration keyed `owner/name` via API | tenancy | **Plausible.** Named scopes exist and are opt-in; arbitrary string keys likely fine. Verify create-scope is in the frozen contract. |
| Invite minting scoped to selected projects, no orgs | invites tables | **Contradicted.** A's schema is users-orgs-teams-memberships-**invites** — invites almost certainly FK to org/team. "Orgs stay dormant" while using invite tables is not credible without an engine change. |
| Server mode on the laptop SQLite dialect (`lore host`) | storage dialect | **Unverified, likely gap.** A couples server mode to Postgres. |
| Watcher registration of arbitrary repo `.lore/` dirs + `.local/` exclusion | file watcher | **Unverified.** Watcher exists; dynamic watch-path and ignore-rule APIs are not in A. |
| Frontmatter as queryable metadata (status, branch, commits) | data model | **Absent.** Notes/chunks/edges/tags only. Frontmatter will be chunked as body text — fine for recall, useless for filtering. |
| Delete detection for files removed by git pull | watcher | **Unverified.** A says "re-indexes .md on save." Deletes and mass-mutation pulls are not saves. |
| Score distributions exposed for GREEN/AMBER/RED | search response | **Unverified.** And thresholds tuned now break when the pending EmbeddingGemma/MiniLM-L-12 swap lands. |
| Exact-ID lane matches commit shas / file paths | read path | **Unverified.** The lane almost certainly matches note IDs, not payload tokens. |

## 2. GAPS (ranked by blocking order)

1. **Watcher registration + `.local/` exclusion** — blocks `lore dev init` on day one. Without the exclusion, raw transcripts get indexed, directly violating the spec's own "raw transcripts never leave `.local/`" governance line. Highest stakes, earliest hit.
2. **Scope registration keyed by GitHub remote** — blocks init. Probably exists; confirm before anything else.
3. **Metadata model for session records** — blocks Loop 1 grading and any status/branch filtering. Feedback table absorbs grades; frontmatter stays text. Spec currently conflates the two.
4. **`/context-pack`** — blocks one of the three MCP tools. Either an engine ticket or a client-side composition over existing search + recency signals.
5. **Multi-scope fan-in within one engine** — blocks the stated recall layering even before teams exist. Engine change.
6. **Host mode**: runtime flip from personal/SQLite to serving, plus **org-less project-scoped invites** — blocks team mode (Dev Ask 4). Two engine changes, both touching the frozen contract.
7. **Remote federation** — fan-out, merge, deadline, and confidence semantics across engines. Nobody owns this in the spec. Blocks team recall.
8. **Delete detection + cross-brain tombstone semantics** — "deletes propagate" is only true per engine. Git carries the deletion; each engine must reconcile independently. Blocks the governance promise.
9. **`decisions/` writer** — engine upkeep writes no files. The fold-mirror needs a lore-dev-side writer (`lore dev upkeep`), single-writer, reading engine fold state. Unspecified.
10. **Score exposure + exact-ID key matching** — verify; likely small engine changes.

## 3. RISKS

1. **Hook capture reliability on Windows.** Stop may never fire (crash, kill, interrupt), orphaning working records in `.local/` — silent capture loss on the most fragile surface. *Mitigation: SessionStart detects and folds orphaned working records from prior sessions; keep exit-0 + errors.log + 3-OS CI (already specced).*
2. **Redaction backstop false negatives.** One miss puts a secret into verbatim prompts committed to git and pushed to GitHub — un-rotatable without history rewrite. Pre-write scanning is a single point of failure. *Mitigation: independent second scanner (gitleaks-class) as a pre-push hook and a PR check; default capture level should not commit prompts verbatim until a repo opts up.*
3. **Join-code tunnel security.** Bearer token embedded in a URL, pasteable into chat and shell history; Cloudflare quick tunnels are ephemeral with no edge auth; no TTL or single-use semantics specced. *Mitigation: single-use, short-TTL join codes exchanged for per-member API keys; prefer Tailscale tailnet-only over Funnel; quick tunnel demoted to fallback-with-warning.*
4. **`.lore/` merge/rebase semantics.** Rebase and squash-merge rewrite shas, so `commits: [abc1234]` dangles and sha-based Loop 1 grading breaks on exactly the workflows that matter. *Mitigation: grade by patch-id/change-id, treat frontmatter shas as hints, store grades as engine feedback events — never rewrite committed frontmatter.*
5. **Federation latency and score incomparability.** Personal + project + N remote brains: sequential fan-out stacks the 111ms p50 with tunnel RTTs and N remote reranks; cross-encoder score distributions across engines are not comparable, so a merged GREEN/AMBER/RED is numerically meaningless. *Mitigation: parallel fan-out with a hard per-brain deadline (~400ms), confidence computed per brain by each engine, results merged as labeled per-brain lists — no cross-engine score blending.*

## 4. MISFITS

- **A second MCP server with no acknowledgment of the engine's own MCP stdio transport.** The only legitimate reason for the proxy is federation plus factory tools — say that, and reuse the engine MCP for single-brain recall. As written it's silent duplication of an existing transport.
- **"Engine stores are derived and rebuildable from `.lore/`" overclaims.** Feedback, ask_history, query_log, and folded graph state are engine-local and not in git. Only note content rebuilds. State the accepted loss explicitly.
- **"Orgs removed permanently" while consuming the invite tables** is cosmetic org-freedom. Either the engine grows org-less scoped invites (contract change — admit it) or lore-dev mints a hidden team row per host (admit that). The current wording hides an engine dependency.
- **`status: shipped` written at Stop time is unknowable at Stop time.** The merge — the actual grade — happens later. Putting it in append-only frontmatter invites committed-file rewrites and diff noise. Stop-time facts in frontmatter; grades in feedback; rendered by the Action.
- **Big-bang (Ask 6) vs frozen-contract discipline.** The spec's own sentence — "engine gaps discovered during implementation are closed in lore-arch" — guarantees mid-push blocking on a second repo's release cycle. Big-bang only works if every contract addition in §2 lands and ships from lore-arch *first*. The spec doesn't sequence this.
- **Ask 3 is under-served.** "Review AI prompting alongside/**instead of** pull requests" — but the Action only renders on PRs, so exploratory and abandoned sessions (the ones most worth reviewing) have no GitHub surface.
- **Verbatim prompts committed by default sits awkwardly next to private-by-default.** `capture level` exists in `lore.toml` but the default is unstated. State it.

## 5. CHANGES

1. Open a lore-arch ticket list **now** and sequence it before any lore-dev code: context-pack endpoint (or explicit client-side composition), multi-scope query fan-in, watch-path registration with ignore rules, org-less project-scoped invites, server-mode-on-SQLite for `lore host`, delete detection, score exposure in search responses.
2. Rewrite the federation section: lore-dev MCP proxy owns fan-out — parallel, per-brain deadline, per-brain confidence labels, no cross-engine score blending. Name the engine MCP transport and justify the proxy's existence in one sentence.
3. Resolve the org/invite contradiction in the Locked Decisions table — pick hidden-team-row or engine change; delete "orgs stay dormant" as written.
4. Move `status`/merge-grade out of session frontmatter into engine feedback events, rendered by the Action. Frontmatter carries Stop-time facts only.
5. Add SessionStart orphan recovery: fold any working record in `.local/` left by a crashed session.
6. Make `.local/` watcher exclusion a hard init-time assertion; if the engine lacks ignore rules, never point the watcher at the repo root — ingest `.lore/` via explicit distill calls instead.
7. Add a reconcile pass (indexed paths vs directory listing) on watcher/upkeep tick for delete detection; document that cross-brain deletes propagate via git and reconcile independently per engine.
8. Grade by patch-id, not sha; add a spec paragraph on rebase/squash/force-push behavior.
9. Make join codes single-use with TTL, exchanged for per-member credentials; demote Cloudflare quick tunnel to fallback-with-warning.
10. State the default capture level; recommend prompts-in-`.local` until a repo opts into committed verbatim prompts.
11. Add a non-PR GitHub surface (Action on push to `.lore/**`, or scheduled digest) to actually cover Ask 3.
12. Correct the rebuildability claim: enumerate what is lost on rebuild (feedback, ask_history, query_log, fold state) and accept it in writing.
13. Version confidence-stamp thresholds with the eval harness and mandate recalibration when the pending embedder/reranker swap ships.
14. Define `lore dev upkeep` as the single writer of `decisions/`, triggered (not a loop), reading engine fold state — closing the dual-truth hole between git and the engine graph.