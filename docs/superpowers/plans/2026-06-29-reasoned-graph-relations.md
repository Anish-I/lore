# Reasoned Graph — Heuristic Relations Engine (Codex-planned)

**Goal:** Replace constant-weight structural edges with reasoned, confidence-scored, auditable
**typed semantic edges**, plus a node **importance** score. Fully deterministic (no LLM).

**Reuses the existing `edges` table:** `kind` = relation type, `weight` = confidence(0–1),
`evidence` = the justifying sentence + cue. Keep structural edges (`link`/`folder`/`tag`/`topic`)
as-is for connectivity; ADD semantic kinds alongside.

## Relation ontology
`supports · contradicts · causes · depends_on · supersedes · implements · relates_to`(weak default)

## Codex design decisions (precision-first)
- **v1 anchors ONLY on explicit `[[wikilinks]]`.** No unlinked co-mentions (fastest path to a noisy graph). Defer co-mentions.
- **Top false-positive traps:** discourse "but"/contrast ≠ contradicts; "A because B" ⇒ B causes A (direction flips); negation ("does not depend on") suppresses, never becomes contradicts; speculation ("may/should/could") → low/ignore; passive ("A was superseded by B" ⇒ B supersedes A); never type folder/tag adjacency; ignore code/quote/frontmatter.
- **Confidence (deterministic):** `cue_specificity × proximity × syntax_confidence × polarity × certainty × ambiguity_penalty`.
  - cue_specificity: supersedes/implements/depends_on/causes 0.90–1.00; supports/contradicts 0.75–0.90; relates 0.40–0.55
  - proximity: same clause 1.0 / same sentence 0.85 / adjacent 0.50 / paragraph 0.35
  - polarity: negated relation → 0.0; contrast marker → 0.75 unless explicit contradiction cue
  - certainty: assertive 1.0 / likely 0.75 / may·should·proposed 0.45
  - ambiguity: 1 linked target 1.0 / multiple targets 0.75 / multiple cues 0.60 / conflicting → highest-specificity, cap 0.65
  - **min thresholds per kind:** depends_on/implements/supersedes/causes ≥ 0.70; supports/contradicts ≥ 0.65; relates_to ≥ 0.50 (maybe don't emit).
- **Direction via pattern families**, not bare keywords: `A requires B⇒A depends_on B`; `A is required by B⇒B depends_on A`; `A was replaced by B⇒B supersedes A`; `A because of B⇒B causes A`; etc.
- **Negation:** negator within 3 tokens before cue ⇒ suppress that relation (not contradicts).
- **Importance (start simple, NOT PageRank):** weighted typed in-degree —
  `0.45·depended_on + 0.20·implemented_by + 0.15·supported_by + 0.10·contested(capped) + 0.10·recency(half-life 45d)`. Cap `contradicts` contribution to avoid drama bias. PageRank later.

## Schema / idempotency
- Migration: extend `edges_kind_check` to allow the 7 relation kinds; add `notes.importance real default 0`.
- A pair may hold multiple typed edges (different `kind`) — `unique(tenant,src,dst,kind)` still holds.
- Recompute per note like `_upsert_edges` (delete this note's semantic-kind edges, re-insert) — no orphans; structural edges untouched.

## Smallest first slice
1. `relations.py`: wikilink-anchored cue extraction → typed edge + confidence + evidence; wired into `index_document`'s edge pass. Eyeball on the real vault.
2. `notes.importance` weighted-typed-in-degree, computed in an upkeep pass.
3. Graph: edge color by kind, opacity by confidence, node size by importance.

**Biggest risk:** precision of cue extraction → keep edges sparse, gated by per-kind thresholds, and always store `evidence` so every edge is auditable/deletable.
