# Design: lore-arch as the canonical headless API service

**Date:** 2026-07-28
**Status:** Phase A executed (this commit); B/C approved in principle, spec'd here for review before build.

## Decisions (owner-approved, 2026-07-28 session)

1. **lore-arch is THE engine repo.** The old `Anish-I/lore` repo (desktop app +
   engine + accumulated mess) is sunset: final pointer commit, then archived
   read-only on GitHub. All engine development happens here; product UIs live
   in their own repos and consume `/api/v1` only.
2. **Migration boundary:** engine core (`core/`), `eval/`, `docs/`,
   `.learnings/`, `.github/`, root manifests, `scrape_ct_clerks.py` (a test
   loads it). Left behind in the archive: `desktop/` (Electron UI), `skills/`,
   `api/`, local data dirs, `secrets/`, `tools/ct-clerk-puppeteer` (node
   scraper tooling — port later if needed).
3. **Personal-first, scopes invisible until created.** Zero tenancy params in
   the dev-facing API: ingest/query operate on the caller's personal space.
   `POST /api/v1/scopes` later creates named partitions ("work", "project-x");
   ingest may target one, queries may filter to one, unscoped queries search
   all scopes the caller can see.
4. **Auth: API keys, bindable beyond localhost.** New `api_keys` table
   (hashed key → user_id, label, role, created/last_used/revoked). A key
   authenticates AS a user — `tenancy.authorize_scopes` and the entire
   existing trust chain are unchanged. Google-OAuth/JWT desktop path stays.
   With keys enabled the server may bind non-localhost; without, localhost
   only (the existing `LORE_LOCAL_TOKEN` guard remains for that case).
5. **Teams v1 ships (minimal):** thin API over the EXISTING `tenancy.py`
   machinery (`create_team`, `invite_to_team`, `accept_invite`, membership
   scope authorization, audit) plus scope sharing: `scope_grants`
   (scope, user, read|write). Teams = shared scopes + per-member keys.

## The two-fork unification (what this migration actually was)

`lore-arch` was cut 2026-07-28 from the desktop app's bundled engine — a fork
that had DIVERGED BOTH WAYS from `vault-kos/lore`:

- vault-kos-only (newer engine): `learn.py`, `sessions.py`, `personal_memory.py`,
  `observations.py`, `structure.py` (doc-tree), `ocr.py`/`textract_ocr.py`,
  `topic_merge.py`, the classify role axis, + 14 modified files.
- bundle-only (newer product surface): `api_v1.py` (frozen /api/v1 mirror),
  `client.py` (stdlib SDK), `version.py`, `llm.py` improvements (artifact-aware
  grounding, clean extractive bullets, env timeouts).

Unification rules applied: vault-kos wins for engine files; bundle wins for
product-surface files; seams stitched by hand:
- `api.py` now calls `mount_v1(app)` after all root routes (the newer api.py
  never knew api_v1 existed).
- `test_llm_fallback.py` ported from the removed `recall.extract_exact_terms`
  to the newer `recall.extract_identifier` lane.
- Load-bearing uncommitted work in vault-kos (`distill_document` refactor,
  learn-gate, OCR router) was committed there first (`a6a7d2f`) so the
  migrated tree is self-consistent.

**Verification: full suite green in this repo — 397 passed, 3 skipped.**

## Lock-down items

- [x] Engine-only tree (no desktop/).
- [x] Suite green in-repo.
- [ ] `api.py` still serves `static/app.html` at `/` — a web-UI remnant.
      Replace with a JSON service banner (engine name/version/links) in Phase B.
- [ ] Branch protection on `main` (attempted via gh api after push).
- [ ] README refresh: drop "they get the desktop app" framing; this repo IS
      the product.

## Phase B — API keys + personal-mode defaults (next, spec'd here, build after review)

- `api_keys` table + `POST /api/v1/keys` (admin-gated), `DELETE /keys/{id}`.
- Key middleware alongside the existing token guard: `Authorization: Bearer
  lore_sk_...` → resolves user, injects default tenancy (personal scope) into
  handlers — existing endpoints lose no behavior, they gain defaults.
- Bind control: `LORE_BIND` env (default 127.0.0.1; non-localhost requires
  keys enabled — fail closed).
- Acceptance: the Ellington email test run PURELY through the API (ingest 494
  via /api/v1/ingest with a key, classify via upkeep trigger, verify tags/roles
  via API reads) — first executed as a pre-B smoke with the local token,
  re-run under keys when B lands.

## Phase C — Scopes API + teams surface (after B)

- `scopes` registry + `scope_grants`; `POST/GET /api/v1/scopes`,
  `POST /scopes/{id}/grants`.
- `authorize_scopes` gains one union clause (granted scopes).
- Teams endpoints exposing existing tenancy functions; invite flow by email.
- Acceptance: three-personas script (solo dev / member / outsider) — personal
  flow zero-param, scope filtering correct, shared scope visible to member,
  never to outsider.
