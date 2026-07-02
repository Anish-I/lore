# Lore — Phase 2 & near-term roadmap (captured brain-dump)

**Date:** 2026-06-30
**Status:** Roadmap / not yet specced. Phase 1 (local-first SQLite) is the prerequisite.
Source: user voice brain-dump. This is a capture + my structuring, to be refined.

---

## A. Phase 2 — Teams, shared spaces, live sync

The big one. Local-first stays the base (Phase 1); Phase 2 adds collaboration on top.

**Mental model**
- A **team** = small shared space (e.g. just you + one other person) working a "log phase."
- Knowledge sharing happens by **talking to the bot**. It captures the conversation and
  clusters it into topics (e.g. "the car accident").
- From a topic/conversation you can tell the agent: *"build a team / project / wizard from this"* →
  the agent acknowledges → creates the container → you **invite people** (email, .org, Google).
- **Auth:** anything shared (team / enterprise) requires a **Google account**. The only thing that
  needs no account is a **marketplace plugin/wizard** — that's a free web download.
- **Server:** a connected sync server. When anything changes — or a member adds details to a team —
  it propagates into the team (and into members' plugins).
- **Dual-write buckets:** in Lore, a user configures their plugin/capture to write to
  **team, local, or everything** (both buckets at once). Enable this from the app AND via CLI /
  Claude-Codex plugin.
- It's **live** and added to the knowledge base. Query stays as built: private-only, shared-only,
  or both (already shipped).

**Open hosting question:** how/where the connected server is hosted is undecided.

**Terminology to consolidate (my proposal — see section B).**

---

## B. Concept vocabulary: team / project / wizard (KEEP DISTINCT)

**Decision (2026-06-30): keep these as distinct concepts** — the user sees real differences and does
NOT want them collapsed into one "Space." Working definitions below (to be confirmed/refined by the
user — the exact boundaries are still open):

| Concept | What it is | Members | Source | Google account? |
|---|---|---|---|---|
| **Project** | a personal working container of notes you're actively building | just you | you create | no |
| **Team** | a shared, live-synced workspace | you + invitees | you create, then invite | yes |
| **Wizard** | an installable knowledge pack from the marketplace | you | downloaded off the web | no |

> TODO (needs user input): precise distinction between Project and Team-before-invite, and whether a
> Wizard can be promoted into a Project/Team. The user explicitly wants these kept separate — do not
> unify them in the Phase 2 spec.

Flow to create one from a chat topic:
1. Bot detects a topic cluster (e.g. "car accident").
2. Offers: *"Turn this into a project / team / wizard?"* → user picks the concept explicitly.
3. If team → invite via email/Google → sync server provisions it.

---

## C. Near-term UX (Phase 1.5 — independent of Phase 2)

These are app-polish items, buildable before/alongside Phase 2.

1. **VS Code-style file tree (left rail).** Currently no right-click. Want: context menu
   (rename, move, delete, new), drag-to-reorder (up/down), "bouncy" motion, and **drag-and-drop
   import** — drop a file into Lore and it lands in the tree at that spot. Model on VS Code's explorer.
2. **Drag-file-into-Lore = import in place.** (Complements the existing top Import button.)
3. **Auto-create sections button.** Given a pile of unstructured data: auto-tag → auto-build
   sections. During an **audit**, off-topic material gets sectioned "on the side" automatically.
   Goal: tagging + section-building becomes smooth/efficient.
4. **Status/tab bar rework (bottom).** Current items ("subsidiary involved, search, backend ready")
   are confusing. Rework into a clear, plain-language status bar (see section D).

## D. Bugs / must-fix

- **Knowledge graph stuck on "fetching notes"** even though notes exist. Likely tied to the
  backend/graph endpoint or a tenant/scope mismatch. Investigate (may resolve once Phase 1 local-first
  removes the DB dependency).
- **OAuth + setup must fully work end-to-end** — when a user selects something in setup, it must
  actually take effect and persist.

## E. Status bar rework — proposed

Replace jargon with a VS Code-like bar, plain language, left→right:

`[ 📖 Space: Private ▾ ]      [ ● 342 notes indexed · synced 2m ago | ⚠ Working offline ]      [ 🔍 Search  ✨ Ask ]`

- **Left:** active Space + visibility (click to switch).
- **Center:** one honest status string — indexed count + sync/offline state in words, not "backend ready".
- **Right:** quick actions.
States collapse to plain phrases: *Indexing… / All indexed / Working offline / Syncing team…*

---

## Sequencing (proposed)

1. **Phase 1** — local-first SQLite (spec + plan done).
2. **Phase 1.5** — file-tree UX, drag-drop import, status-bar rework, graph "fetching" bug, OAuth/setup.
3. **Phase 2** — Space consolidation → shared Spaces + sync server + invites + dual-write buckets.
4. **Auto-sections / audit-structuring** — can land in 1.5 or 2 depending on appetite.
