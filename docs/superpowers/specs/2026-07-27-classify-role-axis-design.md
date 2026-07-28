# Design: role axis for auto-classification (classify.py)

**Date:** 2026-07-27
**Status:** approved (brainstorm with owner; design confirmed in session)
**Motivation:** Ellington Mailbox eval (494 synthetic town-clerk emails,
`eval/history/inbox-tagging-ellington-494-2026-07-27.json`). Topic clustering
is sound (30 topics, purity 0.775, thread-pair recall 0.866), but 50% of
ground-truth SPAM filed into real work topics. The misses are gray bulk mail
(association digests, certification blasts, vendor pilots) whose vocabulary is
the tenant's own domain vocabulary. classify.py emits only topic+tags — it has
no role axis, so post-hoc tag filtering caps at R≈0.54.

## Decision summary

1. **Mechanism:** add a `role` field to the classify LLM contract, stored per
   note. (Rejected: reserved-Spam-topic steering — conflates role with topic;
   recall-time tag filtering — measured ceiling R≈0.54.)
2. **Vocabulary:** exactly three roles:
   - `correspondence` — a specific person wrote this to/with the user about
     the user's matters (includes the user's own sent mail).
   - `solicitation` — unsolicited attempt to sell or pitch: vendor demos,
     cold outreach, promotional offers.
   - `bulk` — automated or mass-distributed mail: newsletters, digests,
     alerts, receipts, association blasts.
   Gray mail (professionally relevant but mass-sent) is `bulk` by definition —
   role is a delivery-mode fact, not a junk verdict.
3. **Scope:** emit + store + eval only. No consumer wiring (recall, sections,
   digest), no backfill of already-classified notes, no schema DDL
   (`note_tags.kind` is unconstrained text; `'role'` rides the existing
   unique `(tenant_id, note_id, tag, kind)`).

## Changes (all in core/lore/classify.py)

- `_classify_prompt`: instruct the model to add `"role":"correspondence"|
  "solicitation"|"bulk"` per item, with the three one-line definitions above
  and: omit `role` when the note is not a message/email. Vocabulary block and
  topic/tags contract unchanged.
- `parse_classification`: accept optional `role`; validate against the enum;
  missing/invalid → `None`. Never inferred.
- `_store`: when role is present, insert one `note_tags` row with
  `kind='role'`, `tag=<role>`, same `source` as the rest of the item.
- `classify_fallback`: unchanged — the deterministic path never emits a role.
- Selection query and batching mechanics unchanged; a note classified before
  this change keeps its existing rows and is not revisited.

## Error handling

Same degradation philosophy as today: a malformed or missing role never blocks
storage of the tags/topic that did parse. LLM failure for a batch still falls
back per note (fallback yields no role).

## Testing

- **Unit (TDD, alongside test_dump_onboarding.py patterns):**
  - prompt contains the role contract and the three role names;
  - `parse_classification` keeps old-style replies working (no role key),
    accepts valid roles, drops invalid ones (`"advertisement"` → None);
  - `_store`/`classify_untagged` writes `kind='role'` rows for roled items and
    none for role-less items;
  - fallback path stores no role row.
- **Acceptance gate — rerun the Ellington eval.** The session harness is
  promoted into the repo as part of this change
  (`eval/scenarios/run_inbox_tagging.py` = ingest + classify loop,
  `eval/scenarios/score_inbox_tagging.py` = metrics incl. roles; corpus JSON
  checked into `eval/scenarios/` beside them). Fresh DB per run. Pass criteria:
  - SPAM-class recall by `solicitation ∪ bulk` ≥ 0.85 (baseline tag-token
    detector: 0.543);
  - of emails whose ground-truth tags contain no SPAM label, ≤ 5% roled
    `solicitation`;
  - topic quality within noise of the 2026-07-27 baseline: distinct topics
    ≤ 40 and purity ≥ 0.75 — the role axis must not degrade topic quality;
  - expected and correct: Personal-class school newsletters and utility bills
    come out `bulk` — the eval maps roles to the SPAM class only for the
    recall metric, it does not treat `bulk` as junk.

## Non-goals

- Consumers of the role signal (recall filtering, section proposals, digest
  suppression) — separate change once role accuracy is proven.
- Backfilling roles for notes classified before this change.
- Any change to `_BATCH_SIZE`, `_RUN_CAP`, `_BODY_CHARS`, or the topic
  registry/vocabulary mechanics.
