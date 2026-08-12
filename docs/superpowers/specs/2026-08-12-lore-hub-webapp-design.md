# Lore Hub — multi-municipality webapp (design)

**Date:** 2026-08-12
**Status:** Approved (Anish, this session)
**Repo:** new — `C:\Users\ivatu\lore-hub` (GitHub `Anish-I/lore-hub` later)
**Supersedes:** the in-engine web-package placement described in KAN-1/KAN-9 (stack unchanged)

## Goal

One shared hub webapp serving multiple municipalities, in the Ellington Clerk
Workspace design, with the Lore engine behind it as a pure API doing the whole
flow (ingest, search, ask, drafts, Box, every action). First slice: workspace
shell + Search/Ask against one town (the local lore-arch engine).

## Decision record

| Decision | Choice | Why |
|---|---|---|
| Topology | **A: shared hub + per-town engine instances** | Keeps one-town-per-box (KAN-25): each town has its own engine, SQLite/Qdrant, Box OAuth, encrypted volume. Hub holds no corpus data. A hub bug leaks navigation, not documents. |
| UI | Ellington Clerk Workspace look (cream `#f4f1e6`, dark red `#8b0000`, Georgia serif) **ported** to server-rendered templates | The 620KB design-export bundle is inline-JS and can't ship under strict CSP (KAN-13). Same design language, rebuilt as templates. |
| Stack | FastAPI + Jinja2 (autoescape ON) + HTMX vendored, no npm, no build step, Caddy in front | Board decision (KAN-9 / board "webapp request path" row) — unchanged. |
| ACL home | **Engine API only** | Amends KAN-9's "one backend" wording; preserves its rationale. The hub contains zero ACL logic — there is still exactly one place the filter lives. Engine never trusts the hub's claimed user. |
| Repo | Separate `lore-hub` repo | Platform (many towns) vs engine (per town) have different release cadences and blast radii. |

## Architecture

```
CLERK BROWSER ──HTTPS/cookies+CSRF──► LORE HUB (shared, one deploy)
                                        │  sessions, login, municipality routing,
                                        │  Jinja2 rendering, control.db (no corpus)
                                        │
                                        ├─Bearer lore_sk_* (town 1)──► ENGINE town 1 (lore-arch, own DB/Qdrant/Box)
                                        ├─Bearer lore_sk_* (town 2)──► ENGINE town 2
                                        └─ ...
```

- Browser↔hub: HttpOnly Secure SameSite session cookie, CSRF token on every
  state-changing request, strict CSP + HSTS + X-Frame-Options (KAN-10/12/13).
- Hub↔engine: bearer `lore_sk_*` service key per town in the Authorization
  header — no cookies on the API, nothing for CSRF to ride (board wire rule).
  The hub passes the user's requested scopes; the engine intersects them with
  real membership and derives tenant from the key ("scope cannot widen",
  tenant-from-token, deny by default — KAN-14). A dedicated signed
  user-claims token replaces raw scope-forwarding in a follow-up story.
- Local dev: the embedded lore-arch engine on `127.0.0.1:8099` is town #1.

## Components

| Unit | Purpose | Depends on |
|---|---|---|
| `hub/app.py` | app factory; session, CSRF, security-header middleware | FastAPI, itsdangerous (session signing) |
| `hub/routes/pages.py` | full-page GETs (login, shell, search, ask) | templates, control, engine_client |
| `hub/routes/fragments.py` | HTMX POST partials (`/search`, `/ask`) | engine_client, templates |
| `hub/engine_client.py` | typed httpx client; per-town base URL + key; timeouts; error mapping | httpx, control |
| `hub/control.py` + `control.db` | SQLite registry: towns (slug, engine_url, key ref), users, sessions | sqlite3 |
| `hub/templates/` | `base.html`, screens, `fragments/` — autoescape ON, zero inline JS/CSS | Jinja2 |
| `hub/static/` | `app.css` (Ellington palette), `htmx.min.js` vendored | — |
| `tests/` | pytest + TestClient + fake-engine fixture | — |

Secrets (`lore_sk_*` keys) live outside git in `.env`/OS keyring; `control.db`
stores a reference, never the key value in plaintext committed anywhere.

## Data flow (Search/Ask, slice 1)

1. GET `/login` → simple local credential form (OIDC per KAN-11 comes later);
   success mints session cookie, stores user + town membership from control.db.
2. GET `/` → workspace shell (nav, town name, Search/Ask tabs) rendered
   server-side; first page load carries the CSRF token via `hx-headers` on
   `<body>` (KAN-9 pseudocode).
3. HTMX POST `/search` → hub validates session + CSRF → `engine_client.search
   (town, scopes, q)` → engine enforces ACL → hub renders
   `fragments/results.html` → HTMX swaps `#results`.
4. HTMX POST `/ask` → same path → cited answer + GREEN/AMBER/RED confidence
   chip per KAN-15/53 → swaps `#answer`. Citations render note titles +
   sources; hostile document text is inert (autoescape — the KAN-24 lesson).

## Error handling

- Engine timeout/down → inline fragment error state with retry button; never a
  stack trace; hub logs the correlation id.
- No/expired session → 303 to `/login`. Engine 401/403 → rendered
  deny-by-default screen (scope names, no data).
- Engine 4xx/5xx mapped in `engine_client` to typed errors → one error
  fragment template. Audit-log hook points (KAN-21) stubbed on every
  state-changing route from day one.

## Testing

- Unit: `engine_client` against a fake engine (httpx MockTransport);
  control.db town routing.
- Integration: TestClient full-page + fragment flows; CSP/HSTS header
  assertions; CSRF-negative tests (POST without token → 403); XSS regression —
  hostile strings (`<img onerror>`, the app.html payload class) through
  search/ask templates must render escaped.
- Manual: run against local engine :8099, click through per KAN-9's
  "strict CSP on, anything that breaks is a leftover inline".

## First slice, then widening

1. Scaffold repo + skeleton (app factory, middleware, base template, CSS with
   Ellington palette, vendored HTMX) — KAN-9 equivalent.
2. Simple session login + control.db with town #1 (local engine).
3. Workspace shell in Ellington design.
4. Search + Ask screens against the real engine (KAN-15).
5. CSRF + security headers asserted by tests from the start (KAN-12/13).

Then: inbox, tasks, drafts queue (KAN-17), upload+ingest (KAN-18), admin
(KAN-19), auditor (KAN-20), OIDC (KAN-11), rate limiting (KAN-22), audit log
(KAN-21). Engine-side follow-ups: promote demo-BFF-only flows
(bootstrap/organize/tasks) into the engine API; service-token with signed user
claims.

## Jira amendments (this session)

- **KAN-1, KAN-9** — description update: webapp lives in `lore-hub` repo;
  engine consumed as API; "one home for the ACL filter" = the engine API;
  "no second backend" becomes "no client-side rendering stack, and no ACL
  logic outside the engine".
- **KAN-10..22** — sweep for "in the engine" placement wording; update where
  present. Stories' security content unchanged.
- **New story** — "Hub↔engine service auth + hub control plane": per-town
  `lore_sk_*` keys, scope intersection, tenant pinning, key rotation;
  control.db schema.
- **KAN-25, KAN-60** — remain valid; note on KAN-60 that the hub joins the
  compose topology as its own service in front of per-town engines.

## Excalidraw board delta (co-design with Anish — not drawn yet)

The "webapp request path — proposed" row gets a v2 panel: shared HUB box
(sessions, CSRF, Jinja2/HTMX render, control.db) in front of N per-town engine
stacks (Caddy → engine API → stores), `lore_sk_*` bearer on the hub→engine
hop. IAM SERVICE role annotation moves onto that hop. One-town-per-box framing
unchanged.

## Out of scope (YAGNI)

- Multi-tenant engine consolidation (Option B) — revisit only under real
  hosting-cost pressure.
- OIDC in slice 1 (local credentials first; KAN-11 lands before any real town).
- Per-town theming, billing, self-serve town onboarding.
- Porting the retrieval-pipeline visualization (app.html) — retired per KAN-9.
