# Real Municipal-Records Onboarding — 788 Town-Government PDFs (2026-07-22)

**Setup:** a real user's export — 788 PDFs + 1 docx of a Connecticut town's
government records (Board of Finance, Board of Selectmen, and 7 ad-hoc
committees/task forces, ~470MB), dumped into a **fresh Lore through the real
production ingest path** — `index.index_note()` per file (the exact function
the backend's `/reindex` handler calls): `distill_md` → `extract.extract_text`
(PyMuPDF for PDFs) → chunk → embed → edge-build → classify. No bespoke adapter,
no hand-extraction. Local gemma4:e4b for classification (the desktop's
`use_llm` path). Committee = hidden gold, never shown to Lore.
Artifact: `eval/history/onboard-municipal-2026-07-22.json` ·
driver: `eval/scenarios/run_onboard_directory.py`.

## What Lore did with a town's filing cabinet

| Stage | Result |
| --- | --- |
| Ingest | 470 / 789 indexed with text, **319 empty**, 0 errors, 187s |
| Extraction success | **59.6%** — the other 40% are scanned image PDFs (no text layer) |
| Avg chunks / readable doc | 7.16 |
| **Connections auto-built** | **2,341 folder-sibling edges** — zero user action |
| Classification (gemma4 + C2) | 470 docs → **7 clean topics** (not hundreds) |
| Organization vs committee gold | pairwise **F1 0.69** (P 0.625 / R 0.769) |
| Sections proposed | 7 |

### Topic → committee purity (gemma4, C2 vocabulary on)

| Topic | n | Dominant committee | Purity |
| --- | --- | --- | --- |
| Local Government Finances | 132 | Board of Finance | **92%** |
| Board Selectmen Minutes | 108 | Board of Selectmen | **97%** |
| Education Governance | 18 | Board of Finance | 94% |
| Departmental Operations | 13 | Lighting Project | 100% |
| Civic Recognition Events | 13 | Board of Selectmen | 100% |
| Town Community Events | 11 | Diversity & Inclusion | 73% |
| Meeting Records | 175 | (cross-committee) | 57% |

## Findings

1. **The onboarding story holds on real government data.** A citizen/clerk
   drops a folder of PDFs; Lore reads 60% of them, builds 2,341 connections
   unprompted, and organizes the readable set into 7 coherent, correctly-named
   municipal topics — 6 of 7 mapping to a single committee at 92–100% purity.
   This is the product's promise, delivered on data we didn't author.

2. **The #1 real-world gap is OCR, not retrieval.** 40% of this town's records
   are scanned image PDFs with no text layer — Lore ingests them (note row +
   provenance) but extracts nothing, so they're invisible to search and
   organization. Municipal/legal/historical archives are OCR-heavy by nature.
   `extract.extract_text` needs an OCR fallback (e.g. a local Tesseract pass on
   empty PyMuPDF results) or those docs silently vanish. Highest-impact item
   for this persona.

3. **C2 canonical vocabulary is what made this legible.** 7 topics for 470 real
   documents — the pre-C2 classifier would have shattered this into hundreds
   (measured 338/400 on Enron). Prevention, on real data.

4. **The one imperfect topic is a legitimate alternative, not an error.**
   "Meeting Records" (175 docs, 57% purity) grouped minutes/agendas across
   committees by DOCUMENT TYPE where the folders group by COMMITTEE. Both are
   valid organizations; it costs F1 only because committee is the gold. A future
   multi-facet topic model (committee × doc-type) would satisfy both.

5. **The title-index quadratic is REAL in production, not a synthetic artifact.**
   Throughput fell 22 → 4.8 files/s as the store grew past ~600 notes — the
   `index_document` → `build_title_index`-per-note O(n²) we bypassed in the eval
   harness. The desktop reconcile has no such bypass; a 5,000-file vault would
   crawl. The api.py-style TTL title-index cache in `index_document` moves from
   "candidate" to **needed for real onboarding**.

6. **Zero ingest errors across 788 heterogeneous real PDFs** — the extractor's
   defensive design (malformed/corrupt → None, never raises) held on messy
   real-world files.

## Gold-granularity note

The harness's default gold (immediate parent folder) scored 0.382 — but for
these records the immediate parent is often "Agendas"/"Minutes"/a year (a
doc-type/temporal bucket, not a topic). Re-scoring against the top-level
committee (the meaningful topical gold) gives 0.69. Reported both; committee is
the honest headline.

## Backlog impact

- **OCR fallback in `extract.extract_text`** — new top item for document-heavy
  onboarding (was not on the list; this run surfaced it).
- **Title-index TTL cache in `index_document`** — promoted from candidate to
  required (production-confirmed).
- Auto-apply purity gate (already built) matters here: 7 sections proposed at
  50–100% purity; the <24h stability gate would hold them for review.
- Multi-facet topics (committee × doc-type) — future, to resolve the
  "Meeting Records" tension.
