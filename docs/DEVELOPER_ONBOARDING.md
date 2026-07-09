# Lore — Developer Onboarding & Finish-Up Checklist

Welcome. This is the concrete to-do list for taking Lore from "great single-player
local app + working team sync primitives" to "multi-tenant product with admin,
connectors, and scheduled backfill." Items are grounded in the current code with
file references. Check them off top-to-bottom; each block is roughly independent.

> **Read first:** `README.md`, `CONTRIBUTING.md`, and the gotchas in
> `~/.claude/.../memory/lore-desktop-gotchas.md` (renderer build, lucide icons,
> CSP images, concurrent-instance Postgres contention, `X-Lore-Token`). They will
> each save you an afternoon.

---

## 0. Orientation (½ day)

- [ ] **Run the desktop app in dev:** `cd desktop && npm install && npm start`
      (prestart rebuilds the renderer + spawns the Python backend). It boots the
      embedded Postgres + Qdrant; first run is slow.
- [ ] **Run the backend standalone:** `cd core && pip install -e ".[dev]" && python -m uvicorn lore.api:app --port 8099`.
- [ ] **Renderer build model:** edit `desktop/renderer/**/*.jsx` + `index.src.html`,
      then `npm run build:renderer` (Babel → `renderer/compiled/*.js`). **Never** edit
      `renderer/index.html` or `compiled/`. Plain JS (`md-to-runs.js`, `md-serialize.js`)
      is served directly.
- [ ] **Know the trust boundary:** identity comes from a verified Google id_token;
      **authorized scopes are always re-derived from membership tables**, never from
      client claims (`core/lore/auth.py`, `core/lore/tenancy.py`). Preserve this.
- [ ] **Backend port + token:** everything to `:8099` needs `X-Lore-Token`
      (`cfg.localToken`, `authHeaders()` in `desktop/main.js`). Enforcement is
      gated by `LORE_LOCAL_TOKEN` server-side.

---

## 1. Team & Company logic

**State today:** `POST /teams`, `POST /teams/{team_id}/invites`, `GET /invites`,
`POST /invites/{invite_id}/accept` exist (`core/lore/api.py` ~264–305). Membership
+ invite tables live in `core/lore/tenancy.py`. Scopes are derived from membership.
Desktop: `TeamsView` (`renderer/design/ui_kits/lore-desktop/projects.jsx`), the
Team place, and section/note **move-to-team/company** (this session) all work.
**Missing:** company/org creation, member management, leave-team, and any
company-vs-team distinction beyond the scope type.

- [ ] **Company / Org creation & management.** Enterprise scope exists in
      `tenancy._SYNCABLE_SCOPE_TYPES` but there is **no `/orgs` or `/company` route**.
      Add: create org, attach teams to an org, an org-wide `company` scope, and the
      desktop flow behind the **Company** place (today it's inert). Decide the model:
      is "Company" one org-wide scope, or an umbrella over team scopes?
      - Acceptance: a user can create a company, invite others, move a page to
        Company, and a company-mate sees it. `GET /auth/me` returns the company scope.
- [ ] **Member management API + UI.** No way to list, remove, or view members.
      Add `GET /teams/{id}/members`, `DELETE /teams/{id}/members/{user_id}`,
      `POST /teams/{id}/leave`. Surface in `TeamsView` (roster with roles + remove).
- [ ] **Invite lifecycle.** Add expiry, revoke (`DELETE /invites/{id}`), resend,
      and pending-invite visibility for the inviter. Today invites are create/accept only.
- [ ] **Scope-propagation correctness.** When a member is removed or leaves, their
      access to team-scoped notes must drop on the next `authorize_scopes` pass
      (re-derived from membership — verify no cached JWT scope leaks; sessions are
      short-lived but confirm). Add an integration test for "removed member can no
      longer read team pages."
- [ ] **Audit trail.** `tenancy` has an audit table — actually write to it on
      create/invite/accept/remove/scope-change and expose a read endpoint for admins.

---

## 2. Admin scopes, RBAC & account management

**State today:** `memberships.role` column exists (default `'member'`, invites can
set `'admin'`) but **is never checked anywhere** — no RBAC. Account = Google login
+ logout only (`auth:login`/`auth:logout`/`auth:status` in `desktop/main.js`;
`auth.py`). No profile edit, no delete, no session list.

- [ ] **Enforce roles (RBAC).** Add a server-side `require_role(team_id, "admin")`
      guard and apply it to: create invites, remove members, delete team, org
      settings. Right now any member can do admin actions. Define the matrix:
      owner > admin > member (viewer?).
      - Acceptance: a `member` calling `DELETE /teams/{id}/members/...` gets 403;
        an `admin` succeeds; covered by tests.
- [ ] **Promote / demote members.** `PATCH /teams/{id}/members/{user_id}` (role) +
      UI control (admin-only). Guard against removing the last owner.
- [ ] **Account management page.** Extend the Settings "Account" section: display
      name (already synced from Google name → `cfg.owner`; let them override),
      avatar, email, connected identity. Add **Delete account** (purge memberships,
      re-key or delete synced notes, revoke sessions) and **Sign out everywhere**.
- [ ] **Session management.** Sessions are a stored JWT (`lore-auth.bin`, encrypted
      via `safeStorage`). Add server-side session/token revocation (a token version
      or jti denylist) so "sign out everywhere" and account deletion actually
      invalidate live tokens.
- [ ] **Org/admin console.** A minimal admin view: members, roles, invites, audit
      log, and per-scope membership counts. Gate behind the RBAC guard above.

---

## 3. Connectors / plugins (users connect external services) — greenfield

**State today:** **Nothing exists.** Ingestion is manual: drag-drop files/folders/
zip/photos (`import:files` in `desktop/main.js` → `runImport`) and single-URL
(`import:url` → backend `/ingest-url`). The "Wizards marketplace" is *knowledge
packs*, not service connectors. `secrets/google_oauth_client.json` is the pattern
for OAuth client config.

- [ ] **Design the connector interface.** A connector = { id, name, icon, auth
      (OAuth2 / API key), `listItems(cursor)`, `fetchItem(id) → {title, text, url,
      created_at}`, incremental cursor }. Put the contract in `core/lore/connectors/`
      and a registry (mirror `wizards-catalog.json`'s shape for the desktop list).
- [ ] **Per-connector OAuth.** Reuse the desktop loopback flow (`lib/google-oauth.js`,
      `runLoopbackFlow`) generalized per provider; store tokens encrypted with
      `safeStorage` (like `lore-auth.bin`), never in the renderer. Add refresh-token
      handling (the current flow only keeps the id_token).
- [ ] **First connectors (pick 2–3):** Gmail, Google Drive/Docs, Notion, Slack.
      Each maps external items → notes with a stable id (`connector:<name>:<extid>`)
      and a source scope so they're filterable / removable as a group.
- [ ] **Ingestion → index.** Route fetched text through the existing extract/redact/
      index path (`extract.py` → `index_note`); reuse the image/asset handling for
      attachments. Respect the folder read-scope excludes (`cfg.excludes`).
- [ ] **Security:** SSRF guard (resolved-IP based — see the smoke-hardening notes),
      redaction on all fetched text, per-connector scope isolation, and a clear
      "disconnect + purge" that deletes the connector's notes.
- [ ] **Desktop UI:** a "Connections" screen (Settings or its own place) listing
      available/connected connectors, connect/disconnect, last-sync time, and status.

## 4. Automatic backfill at a chosen frequency

**State today:** the desktop **upkeep auto-scheduler** already fires
`/upkeep/run` every `cfg.upkeepIntervalMinutes` (default 30) when auto-mode is on
(`desktop/main.js` ~54–90; `upkeep:set-auto` IPC). `/upkeep/run` opportunistically
backfills `created_at` (`backfill_created_at`, also `/backfill/created`). The
Settings "auto-organize" toggle + section-threshold slider (this session) drive it.
**Missing:** a user-facing **frequency** control and per-connector scheduled sync.

- [ ] **Expose the interval.** Add a frequency control to Settings (a slider/select:
      15m / 30m / 1h / 6h / daily) writing `cfg.upkeepIntervalMinutes`; the scheduler
      already reads it at (re)schedule time — just add `startUpkeepInterval` re-arm
      on change. (The plumbing exists; only the UI is missing.)
- [ ] **Per-connector backfill schedule.** Each connector runs its incremental sync
      on its own cadence (reuse the interval infra). Persist per-connector cursor +
      `lastSyncedAt`; surface "Last synced" (mirror the "Last tidied" timestamp added
      this session).
- [ ] **Backoff + failure surfacing.** Retries with backoff, a visible error state
      when a token expires (prompt re-auth), and rate-limit respect per provider.
- [ ] **Manual "Sync now"** per connector (mirror the ribbon "Refresh" = upkeep run).

---

## 5. Testing the product as a whole

**State today:** solid pieces exist — Python `pytest` (+ 3-OS + server-parity lanes),
`ruff`, desktop `vitest` + `eslint` + `node --check` parse job, standalone
installer tests (`test-cli-installer.js`, `test-hooks-installer.js` now in CI),
Playwright `_electron` e2e scripts (`desktop/e2e-*.js`), and eval harnesses
(`eval/bench_locomo.py` recall benchmark, `eval/smoke_edge.py`, `eval/smoke_load.py`,
nightly recall eval). CI: `.github/workflows/ci.yml` + `release.yml`.

- [ ] **Team/RBAC integration tests (backend).** Two-user pytest: create team →
      invite → accept → move page → other user reads it; removed member loses access;
      member is 403'd on admin actions. This is the highest-value coverage gap.
- [ ] **Connector contract tests.** A fake connector fixture that exercises
      list/fetch/incremental-cursor + the ingest→index→recall round-trip, plus the
      SSRF/redaction guards.
- [ ] **Desktop e2e for the new flows.** Extend the Playwright sweep (`e2e-buttons.js`)
      to drive: sign-in modal, WYSIWYG edit→save→reload round-trip on a scratch note,
      section move, connector connect (mocked), and Settings frequency change.
      **Gotcha:** run e2e as the **sole** Electron instance — two instances contend
      on embedded Postgres and the 2nd boots an empty vault (see gotchas memory).
- [ ] **Recall regression gate.** Keep `bench_locomo` / nightly recall in CI as a
      non-regression gate (baseline recall@5 ~0.82) so retrieval changes can't quietly
      degrade quality. Note: `core/lore/recall.py` currently has an uncommitted
      env-gated two-stage retrieval experiment — reconcile or revert it before relying
      on the baseline.
- [ ] **Packaging smoke.** `release.yml` already freezes the backend + smoke-boots it;
      also assert the frozen binary's `lore-backend cli --help` and `mcp` modes work
      (the CLI packaged bug this session proves why). Consider adding `dist` (electron-
      builder) to a manual release checklist.
- [ ] **Manual QA matrix.** Before a release: the 3 places (My Notes/Team/Company),
      every ribbon tool, editor (rich + source), import (file/folder/zip/photo),
      Ask (inline + docked, all model providers), Map, Wizards + Marketplace,
      Settings, sign-in/out, and both themes (light + dark). Target: 0 console errors.

---

## Suggested sequencing

1. **RBAC + member management** (§2, §1) — unblocks everything team-shaped and is a
   security must-have before wider rollout.
2. **Company/org model** (§1) — the "Company" place is currently inert.
3. **Connector framework + first connector** (§3) — the biggest new surface; land the
   interface + one provider end-to-end before adding more.
4. **Frequency UI + per-connector scheduling** (§4) — small once §3 exists.
5. **Test coverage** (§5) — write the team/RBAC and connector tests *alongside* the
   features, not after.

*Grounded in the codebase as of 2026-07-09. Related notes: `docs/`, the
Obsidian `Lore/Knowledge/` folder, and the lore-desktop-gotchas memory.*
