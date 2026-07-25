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

import hashlib
import os
import re
from collections import Counter
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
        pt = PageText(page=page, source=source, conf=conf, review=review, text=body)
        # Textract LAYOUT headings ride along in provenance (observed text, so
        # they satisfy the confidence guard); the textract detector reads them.
        if pm.get("layout_headings"):
            pt.textract_headings = pm["layout_headings"]
        out.append(pt)
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
    if page.source in ("ocr_fast", "ocr_textract"):
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


# Running headers/footers: the same banner on >= _RUNNING_MIN_REPEATS pages would
# otherwise register as a heading on every page ("City of X - Agenda").
_RUNNING_MIN_REPEATS = int(os.environ.get("LORE_DOC_TREE_RUNNING_MIN", "3"))
_PAGENUM_RE = re.compile(r"\bpage\s+\d+(\s+of\s+\d+)?\b", re.I)


def _normalize_running(line: str) -> str:
    # Collapse "Page 3 of 5" -> "page N" so per-page number differences don't
    # hide an otherwise-identical running footer.
    return _PAGENUM_RE.sub("page N", line.strip().lower())


def strip_running_lines(pages: list[PageText], min_repeats: int = None) -> list[PageText]:
    """Remove lines repeated across >= min_repeats pages (running heads/feet).
    Runs BEFORE detection — a banner must never become a heading."""
    min_repeats = min_repeats or _RUNNING_MIN_REPEATS
    counts = Counter()
    for p in pages:
        seen = set()
        for ln in p.text.splitlines():
            key = _normalize_running(ln)
            if key and key not in seen:      # count once per page
                seen.add(key)
                counts[key] += 1
    running = {k for k, c in counts.items() if c >= min_repeats}
    out = []
    for p in pages:
        kept = [ln for ln in p.text.splitlines() if _normalize_running(ln) not in running]
        np = PageText(p.page, p.source, p.conf, p.review, "\n".join(kept).strip())
        th = getattr(p, "textract_headings", None)
        if th:      # carry stashed Textract LAYOUT headings through the rebuild
            np.textract_headings = th
        out.append(np)
    return out


# Runs of non-clearing pages at least this long close into an explicit
# "Unstructured (pp. X-Y)" node: honest flat beats plausible-wrong, and it stops
# one confident heading from swallowing a 60-page garbage appendix.
_UNSTRUCTURED_RUN = int(os.environ.get("LORE_DOC_TREE_UNSTRUCTURED_RUN", "4"))


@dataclass
class DocNode:
    id: str
    parent_id: str | None
    title: str
    level: int
    page_start: int
    page_end: int
    source: str
    confidence: float


def _node_id(note_id: str, level: int, title: str, page: int) -> str:
    return hashlib.sha1(f"{note_id}|{level}|{title}|{page}".encode()).hexdigest()[:16]


def _default_detectors():
    dets = [detect_numbered]
    try:
        # Lazy: textract_ocr imports THIS module at top level, so the reverse
        # import must happen at call time to avoid a cycle. The detector itself
        # is offline (reads page.textract_headings stashed by parse_pages).
        from .textract_ocr import detect_textract
        dets.append(detect_textract)
    except Exception:
        pass
    return dets


def build_tree(pages, note_id, detectors=None):
    """Confidence-guarded event stacking. Detection emits a flat event stream;
    THIS pass turns it into nesting — detectors never build trees themselves."""
    detectors = detectors or _default_detectors()
    pages = strip_running_lines(pages)

    # 1. gather confidence-guarded heading events in appearance order
    events: list[HeadingEvent] = []
    for p in pages:
        if not clears_confidence(p):
            continue
        for det in detectors:
            events.extend(det(p))
    events.sort(key=lambda e: (e.page, e.order))

    # 2. stack into a tree; a node's page range provisionally runs to the last page
    nodes: list[DocNode] = []
    stack: list[DocNode] = []
    last_page = pages[-1].page if pages else 0
    for e in events:
        while stack and stack[-1].level >= e.level:
            stack.pop()
        parent = stack[-1].id if stack else None
        node = DocNode(_node_id(note_id, e.level, e.title, e.page), parent,
                       e.title, e.level, e.page, last_page, e.source, e.confidence)
        nodes.append(node)
        stack.append(node)

    # tighten page_end: a node ends where the next node at <= its level begins
    for i, n in enumerate(nodes):
        for m in nodes[i + 1:]:
            if m.level <= n.level:
                n.page_end = max(n.page_start, m.page_start - 1)
                break

    # 3. explicit Unstructured node for any long-enough run of non-clearing pages
    run_start = None
    prev_page = None
    for idx, p in enumerate(pages):
        clears = clears_confidence(p)
        if not clears and run_start is None:
            run_start = p.page
        if (clears or idx == len(pages) - 1) and run_start is not None:
            run_end = prev_page if clears else p.page
            if run_end - run_start + 1 >= _UNSTRUCTURED_RUN:
                title = f"Unstructured (pp. {run_start}-{run_end})"
                nodes.append(DocNode(_node_id(note_id, 1, title, run_start), None,
                                     title, 1, run_start, run_end, "unstructured", 0.0))
            run_start = None
        prev_page = p.page
    return nodes


# --- Marker-preserving render + top-level entrypoint ------------------------

_PAGE_LEVEL = 6            # deepest markdown heading level: a page never pops a section


def _heads_by_page(nodes):
    by_page = {}
    for n in nodes:
        if n.source == "unstructured":
            continue
        by_page.setdefault(n.page_start, []).append(n)
    for page in by_page:
        by_page[page].sort(key=lambda n: n.level)
    return by_page


def render_markdown(title, pages, nodes):
    """Re-emit the document with section headings inserted at the pages they were
    observed on, and each page kept as a ``###### Page N`` leaf. Insertions only —
    body text is never moved across a page boundary (page provenance stays exact).
    """
    heads = _heads_by_page(nodes)
    out = [f"# {title}", ""]
    for p in pages:
        for n in heads.get(p.page, []):
            out.append(f"{'#' * min(max(n.level + 1, 2), _PAGE_LEVEL - 1)} {n.title}")
            out.append("")
        out.append(f"{'#' * _PAGE_LEVEL} Page {p.page}")
        out.append("")
        if p.text:
            out.append(p.text)
            out.append("")
    body = re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()
    return body + "\n"


def _rewrite_title(title, llm):
    """Optional: an LLM may normalize an OBSERVED title's casing/OCR noise. It may
    not invent a node. Falls back to the observed title on any error/empty."""
    try:
        prompt = ("Rewrite this document heading with clean casing and spacing. "
                  "Do not add or invent words. Return only the heading.\n" + title)
        out = (llm(prompt) or "").strip()
        return out or title
    except Exception:
        return title


def build(title, markdown, provenance, note_id, llm=None, detectors=None):
    """Deterministic structure pass. Returns (hierarchical_markdown, doc_nodes).
    On any failure — or when the text has no page markers — returns the ORIGINAL
    markdown and []: the flag's promise is never-worse-than-off."""
    try:
        pages = parse_pages(markdown, provenance)
        if not pages:
            return markdown, []
        nodes = build_tree(pages, note_id, detectors=detectors)
        if llm is not None:
            for n in nodes:
                if n.source != "unstructured":
                    n.title = _rewrite_title(n.title, llm)
        return render_markdown(title, strip_running_lines(pages), nodes), nodes
    except Exception:
        return markdown, []


def stale_notes(conn, tenant_id):
    """note_ids indexed under a different builder version (flag on) or carrying a
    tree while the flag is off — a rebuild-or-refuse worklist for doctor/upkeep.
    A flag/version flip must trigger re-index, never a silently mixed index
    (chunk_id hashes heading_path, so tree and flat chunks don't interleave)."""
    if enabled():
        # Version drift AND legacy-flat page-marker notes (builder_version NULL
        # but the body still carries `## Page N` lines) — both need re-index or
        # the store silently mixes tree and flat PDF notes.
        rows = conn.execute(
            "select id from notes where tenant_id=%s and ("
            " (builder_version is not null and builder_version <> %s)"
            " or (builder_version is null and body like %s)"
            ")", (tenant_id, BUILDER_VERSION, "%## Page %")).fetchall()
    else:
        rows = conn.execute(
            "select distinct note_id from doc_nodes where tenant_id=%s",
            (tenant_id,)).fetchall()
    return [r[0] for r in rows]
