# Design: topic divergence → subsections, and tag-scoped retrieval

**Date:** 2026-07-28
**Status:** tag-boost lane implemented (`tagscope.py` + `recall.TAG_BOOST`);
divergence detector + subsection rendering approved in brainstorm, not built.
**Motivation:** Owner question: when "algebra" starts diverging from "math",
should it become its own section? (Answer: yes, as a *subsection* — prevention
fights how knowledge grows, and the Ellington eval proved oversized generic
buckets are the real failure mode.) Second ask: ask-time RAG should collect
context around the tags the question names — "algebraic terms in the
mathematics of dogs" → scope built from tags {algebra, dogs}.

## Context: what the 2026-07-28 sectioning eval established

494-email Ellington corpus, cheap model (Haiku) end to end:

| pipeline | sections | weighted gold purity | spam in sections |
|---|---|---|---|
| baseline classify → propose | 22 | 0.716 | 35 (all role-caught) |
| + junk-role filter (shipped) | — | 0.750 | 0 |
| + hub split (shipped) | 20 | **0.776** | **0** |

The "Records Management" hub (108 notes, 0.56 purity) split into usable
folders (Vital Records, FOIA Requests, Municipal Grants 1.00, Culvert Study
0.83). Purity is now past the 0.75 gate **with the cheap model** — quality
came from system structure, not model spend. This doc extends that principle
to hierarchy and retrieval.

## Decision summary

1. **Two kinds of tags, told apart by co-occurrence shape — numeric, no LLM.**
   For a tag T with count >= the section threshold:
   - **Specialization** — concentration `P(topic = X | tag = T) >= 0.8`:
     T lives inside one topic (algebra inside Math). → subsection trigger.
   - **Cross-cutting** — T spreads across >= 3 topics (dogs, urgent): never a
     subsection; it is a retrieval *lens* (see §3).
2. **Subsections, not suppression.** A specialization tag proposes a child
   section "Math / Algebra" through the same lifecycle as every proposal:
   numeric trigger → proposed → user applies/dismisses (sticky), stability
   gate via `topic_registry.first_seen`, `topic_merge` as the fragment undo.
   The hub splitter already emits the flat form of this hierarchy — child as
   `kind='topic'`, parent preserved as `kind='tag'` — so the data model needs
   only an optional `parent_key` column on `topic_registry`; the desktop
   renders nesting.
3. **Tag-scoped retrieval is a BOOST, never a filter** (implemented). Lore is
   recall-obsessed: a hard tag filter deletes relevant-but-untagged notes from
   the answer. Query-named tags multiply matching notes' scores
   (`1 + LORE_TAG_BOOST × hits`, hits capped at 3, default boost 0.20); the
   hybrid dense+BM25 lanes remain the safety net underneath.

## 2. Divergence detector (not built — next after subsection rendering)

One SQL pass over `note_tags`, run in upkeep beside `find_hubs`:

```
candidates = tags with count >= section threshold (5)
for each: conc = max over topics X of P(topic=X | tag=T)
  conc >= 0.8            -> propose subsection X / T
  topics spanned >= 3    -> mark cross-cutting (retrieval lens only)
  else                   -> leave alone (too ambiguous; revisit next run)
```

Proposals land in `section_proposals` with a parent reference; LLM involvement
is limited to confirming/naming, mirroring the hub-split division of labor
(numbers decide *when*, the model decides *what to call it*). Dismissal is
sticky per the standing sections contract.

## 3. Tag-scoped retrieval (implemented 2026-07-28)

- `tagscope.match_tags(vocabulary, query)` — pure, deterministic: exact token,
  plural fold both ways, >=5-char prefix extension ("algebra" → "algebraic"),
  multi-word tags as dash-joined phrases; tags under 3 chars never match.
- `tagscope.load_tag_vocabulary` / `tag_hits_by_note` — two cheap queries,
  same cost shape as the existing signal lanes; hits capped at 3.
- `api._note_signals_provider` computes matches once per request and attaches
  `tag_hits` per candidate note; `recall._apply_note_signals` multiplies
  `1 + TAG_BOOST × hits` (`LORE_TAG_BOOST`, default 0.20).
- Composition: "algebra dogs" boosts notes carrying BOTH tags twice as hard as
  single-tag notes — ask-time scope assembly from tag intersections, which
  generalizes Personal Wizards (topic-scoped RAG) toward arbitrary lenses.

## Non-goals

- Hard tag filtering of candidates (kills recall; revisit only as an explicit
  user-facing filter control, never as default ask behavior).
- LLM-driven divergence detection (the trigger must stay numeric/auditable).
- Multi-level nesting beyond parent/child until a real corpus demands it.
- Folder moves from any of this — proposals only, per the standing invariant.
