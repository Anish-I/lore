# Design: feedback events — any UI button becomes a ranking signal

**Date:** 2026-07-29
**Status:** implemented (`POST /feedback/event` + v1 mirror)
**Motivation:** Owner ask: upvote/downvote as buttons — "user sends the email
Lore generated" = upvote, "user clicks edit" = downvote — but generic, so it
fits any button in any product surface.

## Decision summary

1. **The button's meaning lives in the caller, not in Lore.** The API takes a
   free-form `event` name, a caller-declared `vote` (+1/-1), and a `weight`
   (0–1] — Lore never hardcodes button vocabularies, so "sent", "edited",
   "copied", "regenerate", or anything a future surface invents all fit the
   same endpoint. `source` namespaces the event ("email-draft:email_sent").
2. **One press fans out to the artifact's evidence.** `note_ids` is the
   artifact's provenance — for an email draft, the response's `citations` +
   `style_note_ids`. Sending the draft upvotes every note that fed it; editing
   soft-downvotes them (weight 0.5 by convention, caller's choice). Same
   guard as `/feedback`: votes only land on notes that exist in the tenant.
3. **Weighted net, same bounded multiplier.** Ranking now reads
   `sum(vote × weight)` through the existing `1 + 0.15·tanh(net/3)` — classic
   thumbs keep weight 1.0 (pre-migration NULLs coalesce to 1.0), so nothing
   changes for them. Schema: `feedback` gains `event text` + `weight real`
   via the standard dual-dialect migration (PG ADD COLUMN IF NOT EXISTS,
   SQLite probe-and-add).
4. **Every press is labeled training exhaust.** Event rows are exactly the
   implicit-label lane of the 2026-07-28 SLM/learning-loop spec §4: (note,
   event, vote, weight, query_hash, ts). The learning-to-rank loop trains on
   them with zero extra capture machinery.

## Surface

`POST /feedback/event` (root + `/api/v1` mirror):

```json
{"event": "email_sent",            // any button name
 "vote": 1,                         // +1 | -1 (caller decides valence)
 "weight": 1.0,                     // optional, clamped to (0, 1]
 "note_ids": ["deed-812", "ex2-033"],
 "source": "email-draft",           // optional surface namespace
 "query_hash": "..."}               // optional retrieval correlation
```

Personal mode: `tenant` defaults from the API-key principal. Response reports
`recorded` vs `skipped` (unknown notes are skipped, never inserted).

## Non-goals

- Server-side button registries or per-event valence mappings — deliberate;
  generic beats configurable here.
- Fractional votes beyond the weight axis, decay, or dedup-per-user — wait
  for real usage data (the learning loop will reveal what matters).
