# Lore "Memory-first" simplification — FINAL design spec (2026-07-03, v3)

Converged after three mockup rounds with the user. Positioning: **Lore is a memory
company** — "it remembers stuff." The current app's layout/tabs/icons/theme are GOOD and
stay. The change is: one new Home tab, a de-janked sidebar, the demo's calm editor, chat
with per-source transparency, a visible pushing system, jargon renamed in place, and
developer surfaces behind an Advanced toggle. Mockup of record (v3):
scratchpad lore-ask-first-mockup.html / artifact 9fc64c50.

## 1. Home tab (new, default view)
- Rail gains **Home** at top; app boots into it. Content, centered column:
  - Greeting ("Good evening, <name from owner/config>") + memory line:
    **"Lore remembers 220 things for you · 3 new since yesterday · backed up ✓"**
    (counts from /stats; delta vs yesterday from note created_at; backup from backup:status).
  - Ask input (reuses the Ask machinery; answers open the existing ask side panel).
  - **Personalized prompt chips** (3-4): learned repeats from new ask_history (normalized
    text, min 2 occurrences, recency tiebreak) + activity-derived ("What's new in <most
    recently active section>?") + cold-start defaults. Deterministic helper
    `suggestPrompts(history, stats)`, vitest'd. Sub-caption: "these learn from what you ask".
  - **This-week digest** (the executive view): new backend `GET /digest?tenant&days=7` —
    notes grouped by day × section: {day, section, count, topTitles[3]}. Rendered as quiet
    rows "Tue — Kalshi: pair-sizing config changed…" (title-based summary line = top note
    titles joined; NO LLM required). Footnote: "when teams join, this shows who worked on
    what, per team".

## 2. Top bar: one context switch
- The Show filter (All/Private/Team/Wizards) is REPLACED by **Private / Team / Company**
  (Private default/active; Team+Company greyed with tooltip "activates with team sync").
  It filters tree+graph (existing passesScopeFilter semantics, 'all'→'private' mapping:
  private shows the user's own everything) AND sets the ask source. Wizards are no longer
  a top-bar filter — they live in the Wizards view and the ask panel's wizard picker.

## 3. Chat (the placement + transparency the user called out)
- Ask stays a side panel over whatever you're doing (existing panel), openable from Home
  input, titlebar ask button, and editor "Chat about this note".
- **History**: ask_history table (SQLite+PG mirror of personal_wizard_chats shape +
  source column); one active thread, History drawer (list, resume, delete).
- **Follow-ups**: /trace + llm.answer accept optional history:[{role,text}] (last 6 turns).
- **Per-citation source labels**: every citation chip shows where it came from —
  "PairStrategy · Private" / "roadmap · Team" (scope comes back in /search results
  already; /trace citations gain scope). THE feature: when the bot answers, it tells you
  what's team knowledge vs yours.
- Answered-from line stays. No-LLM fallback: top passages verbatim, never a fake answer.
- Personalized chips also show in the empty ask panel.

## 4. Pushing system (make confidentiality movement first-class)
- Editor visibility control stays (Private/Team/Company, redaction gate — shipped).
- ADD: tree right-click → "Push to Team" / "Make Private"; citation chip context action
  "Push to Team". All routes through the existing note:set-scope IPC (redaction gate
  included). Pushed state visible: small scope glyph on tree rows for team/company notes.

## 5. Sidebar de-jank (the "janky sections" fix)
- Sections chip cloud: hidden by default; appears only when a section filter is active.
- Proposed-sections block → ONE quiet line: "✨ Lore tidied 3 things — Review" opening a
  popover with the existing promote/undo/dismiss actions (renamed: Promote→"Turn into
  folder"). No buttons on the default surface.
- Library up/down chevrons render only with 2+ libraries.
- Workspace header: "220 things remembered" replaces "220 notes indexed".

## 6. Editor: keep the demo's calm
- Remove the Read/Edit toggle: read view by default; CLICK the body → edit mode
  (autofocus); blur or Cmd-S → back to read. Toolbar keeps path · tags · visibility.
- Doc header styled like the mockup: serif title, quiet meta line (path · updated Xd ago).

## 7. Renames in place (no "scope", no dev jargon)
Hooks→Connections (rail label under Advanced + Settings card) · Re-index note→Refresh ·
indexed→remembered · Upkeep→Tidy up · "Backend offline"→"Memory engine is starting…" ·
Backlinks→Mentioned in · Promote→Turn into folder · scope→(never user-visible).

## 8. Advanced mode (developer stuff in the back)
- cfg.advancedMode (default OFF) replaces simpleMode (migration: drop simpleMode key;
  default experience IS the simple one now).
- OFF rail: Home, Files, Graph, Teams, Wizards, Settings. ON adds: Connections (hooks).
- Settings: MCP/skills catalog, CLI install, copy-snippets, model rows (embedding/
  reranker/contextual retrieval), retrieval-config import → grouped under an "Advanced"
  section, visible only when advancedMode. Wizard store/catalog tabs → Advanced too;
  default Wizards view = your wizards list + New wizard.

## Out of scope
Team sync/server, Okta, layout re-architecture, theme changes, graph changes.

## Verification
1. Suites green (pytest incl. digest+history+suggest tests; vitest incl. suggestPrompts;
   eslint; ruff); renderer rebuilt; clean boot (0 errors).
2. Live: boots to Home with real counts + digest rows from the actual library; chip tap
   answers in the panel with per-citation Private badges; follow-up uses context; history
   survives restart.
3. Tree right-click Push to Team → scope changes (store verified), glyph appears.
4. Sections line: "Lore tidied N" appears only when proposals exist; popover actions work.
5. Editor: click body edits, blur returns to read; no toggle rendered.
6. Grep gates: no user-visible "scope"/"re-index"/"backlinks"/"upkeep" strings in
   renderer surfaces; advancedMode OFF hides Connections/store/model rows.
