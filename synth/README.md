# Synthetic corpus

Synthetic "people-work" data for building and evaluating the enterprise
work-tool (wizards/plugins over email + documents). No real customer data
exists yet (decision: Anish, 2026-07-17), so this is the stand-in we build
against — see [`docs/GHANDOUR-ASSESSMENT.md`](../docs/GHANDOUR-ASSESSMENT.md) §6a.

## What's here

```
synth/
  generate.py            # deterministic generator (source of truth)
  expected/*.json        # ground-truth to-dos per scenario (the wizard eval anchor) — committed
  out/                   # materialized corpus — GITIGNORED, regenerate on demand
    enterprise/          # broad scenario: Q3 budget overrun + hiring freeze
      emails/  *.eml
      docs/    *.docx
      sheets/  *.xlsx
      decks/   *.pdf     # "presentation" (pptx unavailable → PDF slide-deck)
    municipal/           # vertical slice: a public-records (FOIA) request
      emails/  *.eml
      docs/    *.docx
      sheets/  *.xlsx
      records/ *.pdf
```

Each scenario is **one coherent thread**: an email chain plus the documents it
references, so the full ingestion path (PyMuPDF PDF, the zip/XML DOCX reader,
openpyxl XLSX) is exercised end-to-end. `expected/<scenario>-todos.json` is the
ground-truth action-item list the "email chain → to-dos" wizard is scored against
(assignee / task / due / source message).

## Regenerate

```
python synth/generate.py          # writes everything under synth/out/
```

Output is gitignored — it's a build artifact. Only the generator and the
ground-truth JSON are committed, so the corpus stays reviewable and reproducible
without binary churn in git.

## Ingest into Lore (manual smoke)

Point `/reindex` (or the desktop import) at files under `synth/out/`. Verified
formats extract via `core/lore/extract.py`:

| Format | Extractor |
|---|---|
| `.pdf` | PyMuPDF (`fitz`) |
| `.docx` | stdlib zip + XML |
| `.xlsx` | openpyxl (rows → pipe-delimited; added 2026-07-17) |
| `.eml` | plain text (RFC822-style body) |

## Notes / gaps found while building this

- **XLSX ingestion was missing** and was added to the extractor while building
  this corpus (spreadsheets are core people-work for the enterprise direction).
- **PPTX generation is unavailable** on the dev box (no `python-pptx`), so
  presentations are rendered as PDF slide-decks. Real `.pptx` ingestion is not
  yet supported by the extractor — a future item if decks become first-class.
