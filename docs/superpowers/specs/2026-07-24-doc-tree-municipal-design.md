# Document-structure tree for the municipal OCR path (design)

Date: 2026-07-24
Status: design — approved scope, pre-implementation
Flag: `LORE_DOC_TREE` (default off, mirrors `LORE_OCR_FALLBACK`)
Reviewers: Anish (owner); Kimi K3 (independent design review — Sol/codex ask path
was erroring this session, fell back to the second-opinion panel).

## Problem

Lore's municipal PDF ingest flattens document structure. The path is:

```
distill.distill_document -> extract.extract_document -> ocr.extract_pdf_routed
  -> flat markdown:  "# Title\n\n## Page 1\n\n<text>\n\n## Page 2\n\n<text> ..."
  -> chunker.chunk_markdown  (keys chunks by markdown heading)
  -> contextualize.apply_context -> embed (BGE dense + Qdrant BM25 sparse) -> Qdrant
```

Because the only headings in the extracted markdown are `## Page N`, every chunk's
`heading_path` is just `"Page 42"`. The document's real hierarchy — `Article I §3`,
agenda items, budget line-items, `Appendix B` salary schedule — is lost exactly
where PageIndex (VectifyAI) would preserve it. Retrieval quality on long, structured
municipal documents suffers: a query about "town clerk recording fees" must land the
one lexical/semantic chunk with no structural context to help.

This is Lore's one structural weakness and PageIndex's core strength. We borrow the
strength as an **ingestion strategy**, without adopting PageIndex's per-query
LLM tree-walk (which would break Lore's model-agnostic, fast, hybrid thesis).

## Scope (approved)

Deterministic structure rewrite + a persisted, disposable, version-stamped
`doc_nodes` table wired for future late-aggregation.

**In scope**
- A deterministic structure builder that derives a heading hierarchy from a PDF and
  rewrites the flat page-markdown into hierarchical markdown, page markers preserved.
- Persist a `doc_nodes` table (disposable, rebuildable, never user-owned canonical),
  version-stamped, enough to support late-aggregation later.
- Wire it into `index.index_document` behind `LORE_DOC_TREE`.
- An optional, narrow LLM role: it may **only rewrite an observed heading's title**
  (normalize casing/OCR noise). It may never create nodes and never emit summaries.

**Explicitly NOT in scope (deferred, and why)**
- Node-summary retrieval points (`source_type="doc-node"`) — a second retrieval
  surface (new RRF weights, exact-ID-lane semantics, note-signal aggregation, doubled
  eval surface). Deferred behind a demonstrated cross-section-QA failure that late
  aggregation over `doc_nodes` can't fix.
- Reasoning-navigation — a per-query LLM tree-walk, which contradicts the retrieval
  thesis (~200ms, no per-query LLM call).
- LLM-generated summaries in the index — breaks model-agnostic index reproducibility
  (swap the LLM, the corpus silently changes) and risks paraphrasing numbers, which
  the OCR router already refuses to treat as validated (`ocr.py` flags
  `numeric_content` for review). Summaries are a Phase-B artifact; we are not building
  Phase B's index.

## Architecture

### New module: `core/lore/structure.py`

Detection emits a flat event stream; a separate pass stacks it into nesting.
**Detection never builds trees.** Pipeline:

1. `strip_running_headers_footers(pages)` — remove lines repeated at a similar
   x/y offset on ≥k pages (running heads/feet). Runs first, or every
   "City of X — Agenda" banner becomes a heading.
2. `detect_headings(pages, doc, provenance) -> list[HeadingEvent]` where
   `HeadingEvent = (page, line_offset, level, title, source, confidence)`.
   Detectors, in priority order:
   - `font` — PyMuPDF span-dict font-size outliers vs body median + bold flag
     (native pages only). Strongest generic signal.
   - `regex` — line-anchored numbered-heading grammar: `ARTICLE|SECTION|§|APPENDIX
     |EXHIBIT|ORDINANCE NO.|RESOLUTION NO.`, dotted `3.2.1`, code-style `3-2.04`.
     Depth = numbering depth. Requires a standalone short line with no terminal
     period (kills "see Section 3.2." citations and mid-sentence `§ 3-2.04`).
   - `toc` — `doc.get_toc()`, **only when validated**: distinct non-empty titles,
     monotonic pages, max page ≤ page count. A drifted/garbage TOC is rejected
     whole (a constant page offset would make every `page_range` wrong).
   - `caps` — ALL-CAPS / Title-Case short standalone lines, lowest confidence.
3. `stack_events(events) -> DocTree` — stack by level into nesting. A numbering
   discontinuity (Section 2 → 5) is a **region confidence downgrade**, never a
   repair opportunity.
4. Emit `DocNode` records and hierarchical markdown (below).

### Confidence guard (the one rule)

> A heading enters `heading_path` only if directly observed on a
> **confidence-clearing page** — `source ∈ {font, regex, toc, caps}` on a page that
> is `native`, or `ocr_fast` with `conf ≥ _REVIEW_CONF` **and no** `review_reasons`.
> The LLM may rewrite an observed title; it may **never create a node**.

Consequences:
- Low-confidence / numeric-flagged / unreadable OCR pages get **no heading
  detection**. They attach as `## Page N` leaves under the nearest observed
  ancestor.
- After ~4 consecutive unstructured pages, close an explicit
  `Unstructured (pp. X–Y)` node — honest flat beats plausible-wrong, and it stops
  one confident heading from swallowing a 60-page garbage appendix.
- Every heading records `(source, confidence)` so the eval can measure the
  fabrication rate directly.

### Markdown emission (marker-preserving)

`render_hierarchical_markdown(tree, pages)`:
- **Insertions only**, at observed line offsets. Never move text across a
  `## Page N` marker (no hyphen-joining, no cross-page paragraph merges) — that
  would silently corrupt page provenance and the eval harness.
- Section headings occupy levels 2..k. **Page markers become a fixed deepest
  level** (`###### Page N`), so a page never pops a section, and the next section
  pops the page. `chunk_markdown`'s stack logic then yields
  `heading_path = "Article I > Section 3 > Page 42"` — rich structure *and*
  preserved page anchor, with **no `Chunk` schema change**.
- Landmine (1) fix: the eval's per-page recovery regex widens from `^## Page N$`
  to `^#+ Page N$`.

### Persistence: `doc_nodes` table

```
doc_nodes(
  id, tenant_id, note_id, parent_id,
  title, level, page_start, page_end,
  source, confidence, builder_version, created_at
)
```

Disposable and rebuilt on every re-index. Not user-owned canonical (matches the
Lore decision matrix: candidate indexes/selectors are disposable and reversible).
`node_id ↔ heading_path` is derivable, so **late aggregation** (score a node by
aggregating its child-chunk scores at query time) becomes a pure additive change
later — no new embeddings, no RRF change.

### Integration point: `index.index_document`

Insert before [`index.py:304`](../../../core/lore/index.py) (`chunks = apply_context(chunk_markdown(...))`):

```python
if doc_tree.enabled() and _has_page_markers(text):
    text, nodes = structure.build(text, provenance, doc=..., llm=None)
    _persist_doc_nodes(conn, tenant_id, source_id, nodes, builder_version=BUILDER_VERSION)
chunks = apply_context(chunk_markdown(source_id, text), title, llm=None)
```

`chunk_id = sha1(note_id|heading_path|idx)`, so enriching `heading_path` changes
chunk ids → full re-index (acceptable; gated, same as `LORE_CONTEXT_ALL`).

### Mixed-index guard (Kimi landmine #5 — "will bite first")

Flipping `LORE_DOC_TREE` (or changing the builder) on an already-indexed corpus
yields a mixed index, because `chunk_id` hashes `heading_path`. Fix: stamp
`BUILDER_VERSION` into the note/index row; a `doctor`/upkeep check flags notes
indexed under a different builder version (or tree-vs-flat mismatch) →
**rebuild-or-refuse**, never silently mix.

## Data flow

```
extract_pdf_routed(path) -> (title, flat page-markdown, provenance)
        │  LORE_DOC_TREE on & has page markers
        ▼
structure.build(text, provenance, doc, llm=None)
        ├─ strip running headers/footers
        ├─ detect_headings  → HeadingEvent stream (confidence-guarded)
        ├─ stack_events     → DocTree (+ Unstructured nodes)
        ├─ render_hierarchical_markdown  (marker-preserving)  → hierarchical text
        └─ DocNode records  → _persist_doc_nodes (version-stamped)
        ▼
chunk_markdown -> heading_path "Article I > Section 3 > Page 42"
        ▼
apply_context(llm=None) -> embed (BGE + BM25) -> Qdrant   [unchanged]
```

## Error handling & safety

- Builder is best-effort: any detector exception → fall back to flat page-markdown
  (no-worse-than-off), log the reason. The flag's promise is "never worse than the
  current flat path."
- Confidence guard prevents hallucinated hierarchy over bad OCR (the nightmare).
- Marker-preserving emission prevents provenance corruption.
- Version stamp + rebuild-or-refuse prevents mixed indexes.
- `numeric_content` pages are never restructured or LLM-touched — consistent with
  the OCR router's existing "not arithmetically validated" stance.

## Testing (TDD)

Unit (`core/tests/test_structure.py`):
- header/footer stripping removes repeated banners, keeps unique lines
- font-outlier detection on a synthetic span dict
- regex grammar: positives (`ARTICLE I`, `Section 3.2`, `APPENDIX B`, `3-2.04`
  standalone) and negatives (`see Section 3.2.` citation, mid-sentence `§ 3-2.04`)
- event stacking incl. discontinuity → region downgrade
- `Unstructured (pp. X–Y)` node inserted after 4 consecutive unstructured pages
- confidence guard: no headings emitted on review-flagged / low-conf pages
- marker preservation: no text moved across `## Page N`; output pages are
  `###### Page N`
- `heading_path` output equals `Article I > Section 3 > Page 42`
- determinism: same input + builder_version → identical chunk_ids
- optional-LLM: `llm` given rewrites an observed title only; never adds a node

Integration (`core/tests/test_doc_tree_index.py`):
- index a synthetic hierarchical PDF-markdown behind the flag → chunks carry rich
  heading_paths; `doc_nodes` persisted; per-page provenance recoverable via
  `^#+ Page N$`
- mixed-index guard: flip flag on an existing note → rebuild-or-refuse triggers

Eval gate (`eval/scenarios/run_onboard_directory.py` on the municipal corpus):
- recall@5 must not regress vs `onboard-municipal-ocr-fixed-{50,full}-2026-07-22`
- report wrong-nesting rate + nDCG delta

## Tunable constants (eval-tuned, not guessed)

All env-overridable, defaults fixed during the eval pass, never hand-guessed:
- `k` — min repeats for a line to count as a running header/footer.
- unstructured-run length before an `Unstructured (pp. X–Y)` node is closed
  (starting hypothesis ~4).
- OCR page confidence threshold — reuses `ocr._REVIEW_CONF` so the tree guard and
  the OCR review-flag agree by construction.
- font-outlier ratio (heading size vs body-median).
- `BUILDER_VERSION` — bumped on any detector/grammar change.

## Kill criterion (the gate)

Wrong-nesting rate on labeled municipal docs, and nDCG delta on the onboard eval.
**If wrong-nesting exceeds threshold, ship flat** — a credible-but-wrong hierarchy
is worse than none, because `heading_path` is trusted metadata that poisons
contextualize and the embeddings downstream with no way to detect it.

## Phase-B trigger (deferred, not by inertia)

Promote to node-summary retrieval / late-aggregation only when a **demonstrated
cross-section-QA failure class** appears that structure-enriched chunks + `doc_nodes`
late-aggregation cannot fix — not merely because "the eval looked promising."
```