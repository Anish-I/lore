# Okta SSO — Manual Test Plan

**What this validates:** the parts I could **not** exercise without a live Okta tenant + a
browser — the real browser loopback, the code→token exchange, RS256 verification against Okta's
JWKS, and the group→scope mapping producing real team scopes on a real user.

Automated tests (below) already pass; this file is the human-in-the-loop pass.

Work through it top to bottom. Each step has a **✅ Pass =** line — if it doesn't match, jump to
**Troubleshooting** at the bottom and tell me what you saw.

---

## Part 0 — One-time Okta setup (do this first)

These are Okta admin-console actions, not code.

- [ ] **0.1 Rotate the client secret.** In the Okta app (client_id `0oa15cs51goDdEdok698`), generate a
      new client secret and **revoke the old one** (it was sent over chat). Copy the new value — you'll
      put it in an env var / gitignored file in Part 2, never in the repo.
- [ ] **0.2 Register the redirect URI.** Add `http://127.0.0.1/callback` to the app's **Sign-in
      redirect URIs**. (Okta allows any loopback port for native apps, so the exact port the app
      picks at runtime doesn't need listing — just `127.0.0.1/callback`.)
- [ ] **0.3 Make sure the ID token carries `groups`.** In the authorization server (the one your
      `OKTA_ISSUER` points at — often `.../oauth2/default`), add/confirm a **groups claim** on the
      **ID token**. Two common ways:
      - a claim named `groups`, value = **Groups**, filter **Matches regex `.*`** (or a tighter
        filter), included when scope = `groups`; **or**
      - the same claim set to "always include," in which case you can drop `groups` from the
        requested scopes (see `OKTA_SCOPES` in Part 2).
- [ ] **0.4 Have a test user in a known group.** Note the **exact Okta group name** (e.g. `Engineering`)
      and pick the Lore team id it should map to (e.g. `t-eng`). You'll need this for
      `OKTA_GROUP_SCOPE_MAP`.

---

## Part 1 — Automated tests (fast, no Okta needed)

Run these first to confirm the code is intact on your machine. **1.3 and 1.4 automate the
mechanics that Parts 3–5 used to require a live Okta + browser for** — real RS256 verification
and the full loopback flow, against local mock servers with real crypto.

- [ ] **1.1 Server-side auth suite**
      ```bash
      cd core
      VAULT_FAKE=1 python -m pytest tests/test_auth.py -p no:asyncio -q
      ```
      **✅ Pass =** `14 passed, 1 skipped`. (The skip is the Google-client-file test — expected.)

- [ ] **1.2 Desktop loopback unit tests**
      ```bash
      cd desktop
      npx vitest run tests/okta-oauth.test.js
      ```
      **✅ Pass =** `4 passed`.

- [ ] **1.3 Server RS256 verification, end-to-end (real crypto, no monkeypatch)**
      ```bash
      cd core
      VAULT_FAKE=1 python -m pytest tests/test_okta_verify_e2e.py -p no:asyncio -q
      ```
      Mints a real signed ID token, serves the matching JWKS on localhost, and runs the actual
      `verify_okta_id_token` / `login_with_okta`. Covers **Part 4** (group→scope on a genuinely
      verified token) and **Part 5.2** (wrong audience/issuer, expired, tampered, alg=none, and a
      token signed by an unpublished key are all rejected).
      **✅ Pass =** `9 passed`.

- [ ] **1.4 Desktop loopback, end-to-end (real flow vs. mock Okta over HTTPS)**
      ```bash
      cd desktop
      npm run test:okta
      ```
      Drives the real `runLoopbackFlow` — PKCE, state, the code→token exchange, the callback
      server, and the nonce check — against a self-signed-TLS mock Okta. Covers the mechanics of
      **Parts 3.3–3.4** and the negative paths in **5.2** (state mismatch, nonce replay, Okta error
      redirect, token-exchange failure). **✅ Pass =** `9 passed` (4 unit + 5 loopback).

- [ ] **1.5 (optional) Full Electron boot smoke** — launches the real app and checks the Okta
      button wiring + the "not configured" path (**Parts 3.2 / 5.1**) via Playwright. Needs a
      display; on a headless box it skips cleanly.
      ```bash
      cd desktop
      npm run test:e2e:electron
      ```
      **✅ Pass =** `1 passed` on a desktop with a display, or `1 skipped` headless (never an error).

> **Debugging:** `.vscode/launch.json` has ready configs — *Electron: main (debug)*, *Vitest:
> current file*, *Vitest: Electron smoke*, and *Pytest: current file (core)* — so you can set
> breakpoints in the loopback flow, the IPC handlers, or the server verify path.

> **Bug this automation caught:** the desktop loopback called `cleanup()` (which closes the
> callback server) *before* reading `server.address().port` to build the token-exchange
> `redirect_uri` — `address()` is `null` after close, so every real sign-in would have thrown
> `Cannot read properties of null (reading 'port')` at the exchange step. Fixed in
> `lib/okta-oauth.js` by capturing the redirect URI once while listening and reusing it (1.4 is
> the regression guard).

---

## Part 2 — Configure the app (server + desktop)

The Lore **server** verifies the token and maps groups → scopes. The **desktop** only fetches the
token. Both read config from env; the desktop also accepts a gitignored file.

- [ ] **2.1 Server env** (in the shell that starts the backend):
      ```bash
      export LORE_SERVER_MODE=1
      export OKTA_ISSUER="https://<your-okta-domain>/oauth2/default"
      export OKTA_CLIENT_ID="0oa15cs51goDdEdok698"
      export OKTA_GROUP_SCOPE_MAP='{"Engineering":"t-eng"}'   # your group → team id from 0.4
      export LORE_JWT_SECRET="<a-32+-char-random-string>"     # signs Lore session JWTs
      ```
      > Note: the **server does not need the client secret** — it only verifies the ID token's
      > signature via Okta's public JWKS. The secret is a **desktop** concern (token exchange).

- [ ] **2.2 Desktop config.** Pick **one**:
      - **Env** (same machine as the app): `OKTA_ISSUER`, `OKTA_CLIENT_ID`, `OKTA_CLIENT_SECRET`
        (the rotated value), and optionally `OKTA_SCOPES` (defaults to `openid email profile groups`
        — set to `openid email profile` if you made the groups claim "always include" in 0.3).
      - **File** (gitignored, never committed): create `secrets/okta_client.json`:
        ```json
        {
          "issuer": "https://<your-okta-domain>/oauth2/default",
          "client_id": "0oa15cs51goDdEdok698",
          "client_secret": "<rotated-secret>"
        }
        ```
      **✅ Check:** `git status` shows **no** `secrets/` file and **no** secret anywhere in tracked files.

---

## Part 3 — Desktop end-to-end (the real test)

- [ ] **3.1 Start the backend in server mode** with the Part 2.1 env set (port 8099).
- [ ] **3.2 Launch the desktop app** with the Part 2.2 config, open the sign-in modal.
      **✅ Pass =** you see **two** buttons: "Continue with Google" and **"Continue with Okta SSO"**.
- [ ] **3.3 Click "Continue with Okta SSO."**
      **✅ Pass =** your system browser opens to your Okta sign-in page; the modal shows
      "Finish in your browser."
- [ ] **3.4 Sign in as the test user** from 0.4 and approve.
      **✅ Pass =** the browser tab shows "Lore sign-in complete — you can close this tab," and the app
      flips to **"Signed in / Welcome, <name>."**
- [ ] **3.5 Confirm the identity stuck.** The app greeting/owner now shows the Okta user's name/email.
      **✅ Pass =** name/email match the Okta account (not the old local owner).

---

## Part 4 — Verify the group → scope mapping actually happened

This is the whole point of the feature: the user's Okta **group** became a Lore **team scope**.

- [ ] **4.1 Check scopes via the API.** Grab the session — easiest is to hit `/auth/me` with the token
      the app stored, or re-run the login against the server directly if you have an ID token. If you
      can read the app's stored session, confirm `scopes` includes `team:t-eng` (your mapped team).
      **✅ Pass =** `scopes` contains the team id you mapped in `OKTA_GROUP_SCOPE_MAP`
      (e.g. `["team:t-eng"]`), derived from the group — **not** sent by the client.
- [ ] **4.2 Revoke test (optional but valuable).** In Okta, remove the test user from the group, sign
      out and back in.
      **✅ Pass =** that `team:` scope is **gone** from `scopes` on the next login (the membership is
      revoked server-side). Any invite-based team the user has stays untouched.

---

## Part 5 — Negative checks (should fail cleanly, not crash)

- [ ] **5.1 Not configured.** Unset the desktop Okta config and click "Continue with Okta SSO."
      **✅ Pass =** a clean message ("Okta SSO isn't configured in this build"), no crash.
- [ ] **5.2 Bad token.** (If you can craft one, or point `OKTA_ISSUER` at the wrong domain.)
      **✅ Pass =** server returns **401**, modal shows a sign-in error, no session is stored.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Browser: "The redirect URI ... did not match" | `127.0.0.1/callback` not registered | Redo **0.2** |
| Okta rejects the request: `invalid_scope` | authz server doesn't allow the `groups` scope | Set `OKTA_SCOPES="openid email profile"` and make the groups claim "always include" (**0.3**) |
| Login works but `scopes` is empty | groups claim not in the token, or group name ≠ map key | Verify **0.3**; the `OKTA_GROUP_SCOPE_MAP` **key** must equal the Okta group name **exactly** (case-sensitive) |
| `token exchange failed` in the app | wrong/old client secret | Use the **rotated** secret from **0.1** |
| Server 401 on a real token | issuer/audience mismatch | `OKTA_ISSUER` and `OKTA_CLIENT_ID` must match the app + authz server exactly |
| `scopes` never enforced anywhere | backend not in server mode | `LORE_SERVER_MODE=1` must be set on the **backend** process |

---

## What "all green" means

Parts 1–4 passing = the enterprise identity path works **end to end**: Okta login → verified token →
group-derived team scopes → Lore session → authorized data plane. That closes assessment
deliverable #4 with live confirmation, not just unit tests.
