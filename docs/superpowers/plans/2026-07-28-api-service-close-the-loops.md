# API Service: Close the Local-Only Loops — Plan Addendum

> Continuation of 2026-07-28-api-service-keys-scopes.md (same constraints, TDD,
> commit per task, suite stays green). Owner approved closing all six holes.

## Design decisions (made 2026-07-28)

1. **Sections apply → metadata-only over HTTP.** `POST /api/v1/sections/{id}/apply`
   marks the section applied and records note→section assignment as STATE
   (claims), exactly like the desktop flow minus filesystem moves. Real file
   moves stay desktop-only (path-guard). API-mode data has no files to move —
   assignment IS the apply. Sections list/propose exposed read-only at
   `GET /api/v1/sections`.
2. **Watcher: no remote variant** (inherently local). Self-hosted boxes already
   get it via vault roots. Documented, not built.
3. **Admin-key relaxation:** `doctor`, `learn` review surfaces, and agent memory
   writes allow an ADMIN-role API key in service mode (`_require_key_admin`
   pattern) instead of blanket 403. Member keys still refused.
4. **Observations body variant:** the observations endpoint accepts
   `transcript` (JSON body, same shape the file would contain) as an
   alternative to `transcript_path`. Path variant stays for local.
5. **Invite accept for key users:** `POST /api/v1/invites/{invite_id}/accept`.
   Key principals need an email: `KeyCreateReq` gains optional `email`, upserted
   into `users` at key creation; accept resolves the caller's email from `users`
   and validates it against the invite (existing `tenancy.accept_invite`
   semantics — no client-supplied email, ever).
6. **Personal wizards v1 surface:** promote existing root wizard routes:
   `GET /api/v1/wizards` (list for caller), `POST /api/v1/wizards/{id}/chat`
   (RAG ask scoped to the wizard's topic). Reuse existing handlers — check
   root routes in api.py first (test_personal_wizards.py documents them).

## Task order (each: failing test → impl → suite → commit)

- T1: admin-key relaxation (doctor/learn/agent) — test_api_admin_relax.py
- T2: observations body variant — extend test file from T1 or own file
- T3: invite accept + email-on-key — test_api_invite_accept.py
- T4: sections list/apply metadata-only — test_api_sections.py
- T5: wizards v1 surface — test_api_wizards.py
- T6: README + API_V1 doc note + push

Acceptance: full suite green; every new endpoint personal-mode/key-authed;
member-vs-admin distinction tested for T1.
