# Lore "Ask-first" redesign — design spec (2026-07-03)

Business feedback round 2: the app still reads like a developer's box; wizards + teams
navigation is confusing; the chat underperforms; the word "scope" must die; and the app
should feel personalized — it should already know what you're about to ask. Decisions
below were locked with the user in brainstorming.

## The one idea

**Ask is the app.** Lore opens into a chat that answers from your knowledge, with one
plain-English source picker — Private / Team / Wizards — and personalized quick prompts.
Everything developer-flavored moves behind an Advanced toggle. The retrieval/ACL engine
is untouched; this is a resurfacing, not a re-architecture.

## 1. Home = Ask (new view, default on launch)

- New `home` view in `wired-app.jsx`, default `view` state on boot (replaces `workspace`
  as the landing surface). Calm layout: greeting, source picker, ask input, quick-prompt
  chips, recent-conversation resume link.
- Rail becomes **Home · Files · Wizards · Settings** (+ Advanced group, see §5).
- The existing floating Ask panel remains as the quick overlay (Cmd-K style) but shares
  ALL machinery (history, picker state, rendering) with the home view — one chat
  implementation, two mounts.

## 2. Source picker (kills "scope" in the UI)

- One control: `Talking to: [Private] [Team ▾] [Wizards ▾]`. Pick ONE source at a time.
  - **Private** (default): the user's own notes — maps internally to their full personal
    scope list (the purpose scope + private), exactly what today's persona provides.
  - **Team**: dropdown of teams. Until team sync exists, renders the locally-saved team
    names (from the teams-create fallback) greyed with "activates with team sync".
  - **Wizards**: dropdown of the user's wizards; picking one routes the chat through the
    wizard's membership (existing `/wizards/personal/{id}/ask` machinery).
- The word "scope" disappears from every user-facing string. Grep-sweep of renderer copy:
  the editor visibility control already says Private/Team/Company (keep); Ask trace
  labels say "answered from Private", never scope IDs like `engineering`.
- Internal mapping lives in ONE renderer helper (`sourceToRequest(source)` →
  `{scopes:[...]} | {wizardId}`), so the backend API is unchanged.

## 3. Chat that does the job

Rebuild the Ask conversation into a real chat (shared component, both mounts):
- **History**: conversations persist (new `ask_history` SQLite table via existing chat
  persistence patterns — mirror `personal_wizard_chats` shape with a `source` column).
  One active thread + a history drawer to resume/delete past threads.
- **Follow-up context**: the last N (6) turns are sent with each question so follow-ups
  work ("what about the second one?"). Backend `/trace` + `llm.answer` gain an optional
  `history` param (list of {role, text}); prompt assembly puts history before chunks.
- **Citations that open**: each answer keeps its citation chips; clicking opens the note
  in Files view (existing openNote path).
- **Answered-from line**: keep `scopes_used` trace, rendered as "answered from Private ·
  6 notes".
- **No-LLM fallback**: if no provider is configured, return the top passages verbatim
  under "Here's what your notes say" — never a fake generated answer.

## 4. Wizards = collections you chat with

- Kill the store from the main UI: catalog browse/install/ratings/MCP-tools tabs leave
  `buckets.jsx`. MCP/skills status moves to Settings → Advanced. (Code for the store is
  kept but unrouted — `buckets.jsx` store components stop being reachable; delete-dead
  cleanup happens in a later pass once the new shape settles.)
- Wizards view = simple list of the user's collections: name, note count, last-used,
  [Chat] [Rename] [Delete]. One "New wizard" flow: name it, then either "from a search"
  (the existing chat-driven builder, restyled minimal) or "pick notes" (checkbox list).
- A wizard IS the third tab of the source picker; the standalone wizard-chat screens go
  away in favor of the unified chat with the wizard selected.

## 5. Advanced gating + calm restyle

- `cfg.advancedMode` (default OFF) replaces `simpleMode` (inverted semantics; migration:
  existing `simpleMode:true` users map to `advancedMode:false`, which is the default).
  OFF: rail shows Home/Files/Wizards/Settings. ON: adds Graph, Teams, Hooks.
- Settings row: "Advanced mode — show the knowledge graph, teams, and developer tools".
- Restyle pass on Home + rail + titlebar only: sans-serif body (mono reserved for data),
  larger type on home, fewer borders, calmer spacing. Design tokens untouched; both
  themes keep working.

## 6. Personalized quick prompts

- 3–4 chips under the home ask box:
  - **Frequency-learned**: normalized repeat questions from `ask_history` (case/punct
    folded, top by count with recency tiebreak, min 2 occurrences).
  - **Activity-derived**: from `/stats` + recent notes: "What's new in <most-active
    topic>?", "Summarize <newest note title>".
  - **Cold-start defaults** until history exists ("What did I work on this week?").
- Deterministic v1 (no LLM): a `suggestPrompts(history, stats)` renderer helper, unit
  tested. All signal stays local; the hashed audit log is NOT used for this (it can't
  be — by design it has no raw text).
- Tap → runs the question in the current source immediately.

## 7. Server: deferred, prepared

- Modernize root `docker-compose.yml`: rename vault→lore creds/db, add the backend
  service (build from core/, `LORE_SERVER_MODE=1`, depends_on pg+qdrant), named volumes.
  Compose is infra-ready for the future team server; the desktop does NOT wire to it in
  this round. The picker's Team tab is the slot it later plugs into.

## Explicitly out of scope

Team sync/server wiring, Okta/OIDC, store/marketplace revival, graph changes beyond
moving it behind Advanced, design-token/theme rework, deleting store code.

## Verification

1. `pytest` (incl. new history-param + ask-history tests), `eslint`, `vitest` (incl.
   `suggestPrompts` unit tests), renderer rebuild, clean boot (0 renderer errors).
2. Live: app opens on Home; ask from Private answers with citations + answered-from
   line; follow-up question uses context; history survives restart; wizard picked from
   the source picker answers only from its notes.
3. Quick prompts: seed 3 repeats of a question in history → chip appears; tap runs it.
4. Grep gate: no user-visible "scope" string in renderer output surfaces.
5. Advanced OFF hides Graph/Teams/Hooks; ON restores; simpleMode migration honored.
6. `docker compose config` validates; compose brings up pg+qdrant+backend locally once
   (smoke), then torn down — desktop untouched.
