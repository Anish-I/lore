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


def clears_confidence(page: PageText) -> bool:
    """The one guard rule: only trustworthy pages may contribute headings.

    A heading enters the tree only if observed on a confidence-clearing page —
    ``native``, or ``ocr_fast`` with ``conf >= ocr._REVIEW_CONF`` and no review
    flags. This is what stops fabricated hierarchy over bad OCR."""
    if page.review:
        return False
    if page.source == "native":
        return True
    if page.source == "ocr_fast":
        return page.conf is not None and page.conf >= ocr._REVIEW_CONF
    return False


@dataclass
class HeadingEvent:
    page: int
    order: int          # global appearance order, for stable stacking
    level: int
    title: str
    source: str         # regex | font | toc | caps | textract
    confidence: float


# A heading LINE must be short and standalone, with no terminal period, to avoid
# matching "see Section 3.2 for details." citations embedded in prose.
_KEYWORD_RE = re.compile(
    r"^(ARTICLE|SECTION|APPENDIX|EXHIBIT|CHAPTER|TITLE|DIVISION"
    r"|ORDINANCE\s+NO\.?|RESOLUTION\s+NO\.?)\b", re.I)
_DOTTED_RE = re.compile(r"^(\d+(?:[.\-]\d+)+)\b")          # 3.2.1 or 3-2.04
_MAX_HEADING_WORDS = 9

# keyword → depth. Structural top-level containers = 1; section-like = 2.
_KEYWORD_LEVEL = {
    "TITLE": 1, "CHAPTER": 1, "ARTICLE": 1, "APPENDIX": 1, "EXHIBIT": 1,
    "DIVISION": 1, "SECTION": 2, "ORDINANCE": 1, "RESOLUTION": 1,
}

_order_counter = 0


def _next_order() -> int:
    global _order_counter
    _order_counter += 1
    return _order_counter


def _looks_like_heading_line(line: str) -> bool:
    s = line.strip()
    if not s or len(s.split()) > _MAX_HEADING_WORDS:
        return False
    if s.endswith("."):        # terminal period ⇒ prose/citation, not a heading
        # allow a lone trailing period on a numbering token like "3." only if short
        if not re.match(r"^\d+[.\-\d]*\.$", s):
            return False
    return True


def detect_numbered(page: PageText) -> list[HeadingEvent]:
    """Line-anchored numbered-heading grammar (ARTICLE/SECTION/APPENDIX/…, dotted
    3.2.1). Only fires on short standalone lines with no terminal period, so prose
    citations like "see Section 3.2 for details." are not mistaken for headings."""
    events = []
    for raw in page.text.splitlines():
        line = raw.strip()
        if not _looks_like_heading_line(line):
            continue
        m_kw = _KEYWORD_RE.match(line)
        m_dot = _DOTTED_RE.match(line)
        if m_kw:
            key = m_kw.group(1).split()[0].upper()
            level = _KEYWORD_LEVEL.get(key, 2)
        elif m_dot:
            level = min(1 + m_dot.group(1).replace("-", ".").count("."), 6)
        else:
            continue
        events.append(HeadingEvent(page.page, _next_order(), level, line, "regex", 0.7))
    return events
