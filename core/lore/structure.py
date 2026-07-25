"""Deterministic document-structure tree for the municipal OCR path.

Parses the flat ``## Page N`` markdown produced by ``ocr.extract_pdf_routed``
(plus its per-page provenance) into a heading hierarchy, so retrieved chunks
carry real section paths (``Article I > Section 3 > Page 42``) instead of flat
``Page 42``. Gated by ``LORE_DOC_TREE`` (default off): when off, ingest is
byte-for-byte the current flat path.

Model-agnostic: detection is deterministic. An optional ``llm`` may ONLY rewrite
an observed heading's title; it never creates a node and never emits summaries.
The derived tree is disposable/rebuildable, never user-owned canonical.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass

from . import ocr

# Bump on ANY detector/grammar change — stamped on notes.builder_version so a
# flag/version flip on an already-indexed corpus is detected (rebuild-or-refuse).
BUILDER_VERSION = "doc-tree/1"

_PAGE_MARKER_RE = re.compile(r"(?m)^##\s+Page\s+(\d+)\s*$")


def enabled() -> bool:
    return os.environ.get("LORE_DOC_TREE", "0") == "1"


@dataclass
class PageText:
    page: int
    source: str            # native | ocr_fast | error | unreadable
    conf: float | None
    review: bool           # page carries review_reasons / low confidence
    text: str


def parse_pages(markdown: str, provenance: dict | None) -> list[PageText]:
    """Split flat ``## Page N`` markdown into per-page records, joined with the
    OCR provenance (source/conf/review_reasons). Pages absent from provenance
    default to trustworthy ``native``."""
    prov_by_page = {}
    for pm in (provenance or {}).get("pages", []):
        prov_by_page[pm.get("page")] = pm

    parts = _PAGE_MARKER_RE.split(markdown or "")
    # parts = [prefix, "1", body1, "2", body2, ...]
    out = []
    for i in range(1, len(parts), 2):
        page = int(parts[i])
        body = parts[i + 1].strip()
        pm = prov_by_page.get(page, {})
        source = pm.get("source", "native")
        conf = pm.get("conf")
        review = bool(pm.get("review_reasons")) or source in ("error", "unreadable")
        out.append(PageText(page=page, source=source, conf=conf, review=review, text=body))
    return out
