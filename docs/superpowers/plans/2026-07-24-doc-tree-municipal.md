# Document-structure tree (municipal OCR path) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Lore's municipal PDF ingest a real heading hierarchy (borrowed from PageIndex) so retrieved chunks carry `Article I > Section 3 > Page 42` paths instead of flat `Page 42`, behind a default-off flag, with a persisted disposable `doc_nodes` tree — without a per-query LLM or LLM-generated index text.

**Architecture:** A new deterministic `structure.py` parses the flat `## Page N` markdown + OCR provenance into per-page records, detects headings (numbered-grammar regex, font-outlier, validated `get_toc`, caps) as a confidence-guarded event stream, stacks them into a tree, and re-renders marker-preserving hierarchical markdown that the existing `chunk_markdown → contextualize → embed` pipeline consumes unchanged. The tree is also persisted to a version-stamped `doc_nodes` table. Wired into `index.index_document` behind `LORE_DOC_TREE`.

**Tech Stack:** Python 3, pytest, PyMuPDF (fitz), SQLite/Postgres via `lore.db`, Qdrant (unchanged).

## Global Constraints

- Flag: `LORE_DOC_TREE` env, default off. When off, ingest is byte-for-byte the current path.
- Model-agnostic: the builder is deterministic. An optional `llm` callable may ONLY rewrite an observed heading's title string; it may NEVER create a node or emit summaries. Default `llm=None`.
- No LLM-generated text is ever embedded or stored in chunk text or `doc_nodes.title` beyond a title rewrite of an already-observed heading.
- Marker-preserving: never move text across a `## Page N` boundary; insert headings only.
- Confidence guard (the one rule): a heading enters the tree only if observed on a confidence-clearing page — `source ∈ {font,regex,toc,caps}` on a page that is `native`, OR `ocr_fast` with `conf ≥ ocr._REVIEW_CONF` and no `review_reasons`.
- Page markers render as the deepest heading level `###### Page N` so a page never pops a section.
- `chunk_id = sha1(note_id|heading_path|chunk_index)` → enriching `heading_path` requires re-index; acceptable and gated.
- Version stamp: `structure.BUILDER_VERSION` (string). Bump on any detector/grammar change. Stored on `notes.builder_version`; mismatch → rebuild-or-refuse.
- `doc_nodes` is disposable/rebuildable, never user-owned canonical.
- Tests: `from lore import ...`; use the session-scoped `conn` fixture from `core/tests/conftest.py`; env flags via `monkeypatch`. Run tests from `core/` with `python -m pytest`.

---

### Task 1: Module skeleton, flag, and per-page parsing

**Files:**
- Create: `core/lore/structure.py`
- Test: `core/tests/test_structure.py`

**Interfaces:**
- Produces: `enabled() -> bool`; `BUILDER_VERSION: str`; `PageText` dataclass `(page:int, source:str, conf:float|None, review:bool, text:str)`; `parse_pages(markdown:str, provenance:dict|None) -> list[PageText]`.

- [ ] **Step 1: Write the failing test**

```python
# core/tests/test_structure.py
from lore import structure


def test_flag_default_off(monkeypatch):
    monkeypatch.delenv("LORE_DOC_TREE", raising=False)
    assert structure.enabled() is False
    monkeypatch.setenv("LORE_DOC_TREE", "1")
    assert structure.enabled() is True
    monkeypatch.setenv("LORE_DOC_TREE", "0")
    assert structure.enabled() is False


def test_parse_pages_joins_text_and_provenance():
    md = "# Budget\n\n## Page 1\n\nARTICLE I\n\nGeneral text.\n\n## Page 2\n\nmore text"
    prov = {"pages": [
        {"page": 1, "source": "native", "chars": 20},
        {"page": 2, "source": "ocr_fast", "conf": 0.62, "review_reasons": ["numeric_content"]},
    ]}
    pages = structure.parse_pages(md, prov)
    assert [p.page for p in pages] == [1, 2]
    assert pages[0].source == "native" and pages[0].review is False
    assert pages[1].source == "ocr_fast" and pages[1].conf == 0.62 and pages[1].review is True
    assert "ARTICLE I" in pages[0].text and "more text" in pages[1].text


def test_parse_pages_without_provenance_defaults_native():
    md = "# T\n\n## Page 1\n\nhello"
    pages = structure.parse_pages(md, None)
    assert len(pages) == 1 and pages[0].source == "native" and pages[0].review is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && python -m pytest tests/test_structure.py -v`
Expected: FAIL with `AttributeError: module 'lore.structure' has no attribute 'enabled'` (module missing).

- [ ] **Step 3: Write minimal implementation**

```python
# core/lore/structure.py
"""Deterministic document-structure tree for the municipal OCR path.

Parses the flat `## Page N` markdown produced by ocr.extract_pdf_routed (plus its
per-page provenance) into a heading hierarchy, so retrieved chunks carry real
section paths instead of flat "Page N". Gated by LORE_DOC_TREE (default off).

Model-agnostic: detection is deterministic. An optional `llm` may only REWRITE an
observed heading's title; it never creates nodes and never emits summaries.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

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
    """Split flat `## Page N` markdown into per-page records, joined with the
    OCR provenance (source/conf/review_reasons). Pages absent from provenance
    default to trustworthy `native`."""
    prov_by_page = {}
    for pm in (provenance or {}).get("pages", []):
        prov_by_page[pm.get("page")] = pm

    parts = _PAGE_MARKER_RE.split(markdown)
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && python -m pytest tests/test_structure.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add core/lore/structure.py core/tests/test_structure.py
git commit -m "feat(structure): module skeleton, LORE_DOC_TREE flag, per-page parsing"
```

---

### Task 2: Confidence-clearing predicate

**Files:**
- Modify: `core/lore/structure.py`
- Test: `core/tests/test_structure.py`

**Interfaces:**
- Produces: `clears_confidence(page: PageText) -> bool`.

- [ ] **Step 1: Write the failing test**

```python
def test_clears_confidence():
    from lore.structure import PageText, clears_confidence
    from lore import ocr
    assert clears_confidence(PageText(1, "native", None, False, "x")) is True
    # ocr page above review threshold, no review flags → clears
    assert clears_confidence(PageText(2, "ocr_fast", ocr._REVIEW_CONF + 0.05, False, "x")) is True
    # ocr page flagged for review → never clears
    assert clears_confidence(PageText(3, "ocr_fast", 0.99, True, "x")) is False
    # low-confidence ocr → never clears
    assert clears_confidence(PageText(4, "ocr_fast", ocr._REVIEW_CONF - 0.1, False, "x")) is False
    # unreadable/error → never clears
    assert clears_confidence(PageText(5, "unreadable", None, True, "")) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && python -m pytest tests/test_structure.py::test_clears_confidence -v`
Expected: FAIL with `ImportError: cannot import name 'clears_confidence'`.

- [ ] **Step 3: Write minimal implementation**

```python
# append to core/lore/structure.py
def clears_confidence(page: PageText) -> bool:
    """The one guard rule: only trustworthy pages may contribute headings."""
    if page.review:
        return False
    if page.source == "native":
        return True
    if page.source == "ocr_fast":
        return page.conf is not None and page.conf >= ocr._REVIEW_CONF
    return False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && python -m pytest tests/test_structure.py::test_clears_confidence -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/lore/structure.py core/tests/test_structure.py
git commit -m "feat(structure): confidence-clearing page predicate (the guard rule)"
```

---

### Task 3: Numbered-heading grammar detector

**Files:**
- Modify: `core/lore/structure.py`
- Test: `core/tests/test_structure.py`

**Interfaces:**
- Produces: `HeadingEvent` dataclass `(page:int, order:int, level:int, title:str, source:str, confidence:float)`; `detect_numbered(page: PageText) -> list[HeadingEvent]` (source `"regex"`).

- [ ] **Step 1: Write the failing test**

```python
def test_detect_numbered_positives_and_negatives():
    from lore.structure import PageText, detect_numbered
    body = "\n".join([
        "ARTICLE I",                  # level 1 heading
        "General Provisions apply to all sections below and continue at length.",
        "Section 3. Recording Fees",  # level 2 heading
        "The fee is $10.",
        "APPENDIX B",                 # level 1 heading
        "See Section 3.2 for details.",   # citation, NOT a heading (mid-sentence)
        "3.2.1 Sub Item",             # dotted numbering, level 3
    ])
    ev = detect_numbered(PageText(5, "native", None, False, body))
    titles = [e.title for e in ev]
    assert "ARTICLE I" in titles
    assert any(t.startswith("Section 3") for t in titles)
    assert "APPENDIX B" in titles
    assert any(t.startswith("3.2.1") for t in titles)
    # the citation line must NOT be detected
    assert all("See Section 3.2 for details." != t for t in titles)
    # levels: ARTICLE/APPENDIX = 1, Section = 2, dotted 3.2.1 = 3
    by_title = {e.title.split(".")[0][:7]: e.level for e in ev}
    assert next(e.level for e in ev if e.title == "ARTICLE I") == 1
    assert next(e.level for e in ev if e.title.startswith("Section 3")) == 2
    assert next(e.level for e in ev if e.title.startswith("3.2.1")) == 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && python -m pytest tests/test_structure.py::test_detect_numbered_positives_and_negatives -v`
Expected: FAIL (`ImportError: detect_numbered`).

- [ ] **Step 3: Write minimal implementation**

```python
# append to core/lore/structure.py
@dataclass
class HeadingEvent:
    page: int
    order: int          # global appearance order, for stable stacking
    level: int
    title: str
    source: str         # regex | font | toc | caps
    confidence: float

# A heading LINE must be short and standalone, with no terminal period, to avoid
# matching "see Section 3.2 for details." citations embedded in prose.
_KEYWORD_RE = re.compile(
    r"^(ARTICLE|SECTION|APPENDIX|EXHIBIT|CHAPTER|TITLE|DIVISION"
    r"|ORDINANCE\s+NO\.?|RESOLUTION\s+NO\.?)\b", re.I)
_DOTTED_RE = re.compile(r"^(\d+(?:[.\-]\d+)+)\b")          # 3.2.1 or 3-2.04
_SECTION_NUM_RE = re.compile(r"^(?:SECTION|ARTICLE)\s+([0-9IVXLC]+)", re.I)
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && python -m pytest tests/test_structure.py::test_detect_numbered_positives_and_negatives -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/lore/structure.py core/tests/test_structure.py
git commit -m "feat(structure): line-anchored numbered-heading grammar detector"
```

---

### Task 4: Running header/footer stripping

**Files:**
- Modify: `core/lore/structure.py`
- Test: `core/tests/test_structure.py`

**Interfaces:**
- Produces: `strip_running_lines(pages: list[PageText], min_repeats:int=None) -> list[PageText]` (returns new PageText list with running head/foot lines removed). Constant `_RUNNING_MIN_REPEATS`.

- [ ] **Step 1: Write the failing test**

```python
def test_strip_running_lines_removes_banner_keeps_unique():
    from lore.structure import PageText, strip_running_lines
    pages = [
        PageText(i, "native", None, False,
                 f"City of Xville — Agenda\nUnique body line {i}\nPage {i} of 5")
        for i in range(1, 6)
    ]
    out = strip_running_lines(pages)
    joined = "\n".join(p.text for p in out)
    assert "City of Xville — Agenda" not in joined      # repeated banner stripped
    assert "Unique body line 3" in joined               # unique content kept
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && python -m pytest tests/test_structure.py::test_strip_running_lines_removes_banner_keeps_unique -v`
Expected: FAIL (`ImportError: strip_running_lines`).

- [ ] **Step 3: Write minimal implementation**

```python
# append to core/lore/structure.py
from collections import Counter

_RUNNING_MIN_REPEATS = int(os.environ.get("LORE_DOC_TREE_RUNNING_MIN", "3"))
_PAGENUM_RE = re.compile(r"\bpage\s+\d+(\s+of\s+\d+)?\b", re.I)


def _normalize_running(line: str) -> str:
    # Collapse "Page 3 of 5" → "Page N of N" so per-page number differences don't
    # hide an otherwise-identical running footer.
    return _PAGENUM_RE.sub("page N", line.strip().lower())


def strip_running_lines(pages: list[PageText], min_repeats: int = None) -> list[PageText]:
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
        out.append(PageText(p.page, p.source, p.conf, p.review, "\n".join(kept).strip()))
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && python -m pytest tests/test_structure.py::test_strip_running_lines_removes_banner_keeps_unique -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/lore/structure.py core/tests/test_structure.py
git commit -m "feat(structure): strip running headers/footers before detection"
```

---

### Task 5: Event stacking into a tree, with the confidence guard and Unstructured nodes

**Files:**
- Modify: `core/lore/structure.py`
- Test: `core/tests/test_structure.py`

**Interfaces:**
- Consumes: `PageText`, `HeadingEvent`, `clears_confidence`, `detect_numbered`, `strip_running_lines`.
- Produces: `DocNode` dataclass `(id:str, parent_id:str|None, title:str, level:int, page_start:int, page_end:int, source:str, confidence:float)`; `build_tree(pages: list[PageText], note_id:str, detectors=None) -> list[DocNode]`. Constant `_UNSTRUCTURED_RUN`.

- [ ] **Step 1: Write the failing test**

```python
def test_build_tree_guard_and_unstructured():
    from lore.structure import PageText, build_tree
    from lore import ocr
    pages = [
        PageText(1, "native", None, False, "ARTICLE I\nGeneral text one."),
        PageText(2, "native", None, False, "Section 3. Fees\nThe fee is $10."),
        # low-confidence OCR page: MUST NOT contribute a heading even though it
        # contains a line that looks like one.
        PageText(3, "ocr_fast", ocr._REVIEW_CONF - 0.2, True, "ARTICLE II\ngarbled 111 222"),
        PageText(4, "unreadable", None, True, ""),
        PageText(5, "unreadable", None, True, ""),
        PageText(6, "unreadable", None, True, ""),
        PageText(7, "unreadable", None, True, ""),
    ]
    nodes = build_tree(pages, note_id="n1")
    titles = [n.title for n in nodes]
    assert "ARTICLE I" in titles
    assert any(t.startswith("Section 3") for t in titles)
    # guard: the low-conf OCR "ARTICLE II" is never a node
    assert "ARTICLE II" not in titles
    # Section 3 nests under ARTICLE I
    art = next(n for n in nodes if n.title == "ARTICLE I")
    sec = next(n for n in nodes if n.title.startswith("Section 3"))
    assert sec.parent_id == art.id
    # ≥4 consecutive unstructured pages → an explicit Unstructured node
    assert any(n.title.startswith("Unstructured") for n in nodes)
    uns = next(n for n in nodes if n.title.startswith("Unstructured"))
    assert uns.page_start == 4 and uns.page_end == 7
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && python -m pytest tests/test_structure.py::test_build_tree_guard_and_unstructured -v`
Expected: FAIL (`ImportError: build_tree`).

- [ ] **Step 3: Write minimal implementation**

```python
# append to core/lore/structure.py
import hashlib

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
    return [detect_numbered]     # font/toc detectors appended by callers when available


def build_tree(pages, note_id, detectors=None):
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

    # 2. stack into a tree; end each node's page_range at the next same-or-shallower head
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

    # 3. explicit Unstructured node for any run of >= _UNSTRUCTURED_RUN
    #    consecutive non-clearing pages (honest flat beats plausible-wrong).
    run_start = None
    for idx, p in enumerate(pages):
        broken = clears_confidence(p)
        is_last = idx == len(pages) - 1
        if not broken and run_start is None:
            run_start = p.page
        if (broken or is_last) and run_start is not None:
            run_end = pages[idx - 1].page if broken else p.page
            if run_end - run_start + 1 >= _UNSTRUCTURED_RUN:
                nodes.append(DocNode(
                    _node_id(note_id, 1, f"Unstructured (pp. {run_start}-{run_end})", run_start),
                    None, f"Unstructured (pp. {run_start}-{run_end})", 1,
                    run_start, run_end, "unstructured", 0.0))
            run_start = None
    return nodes
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && python -m pytest tests/test_structure.py::test_build_tree_guard_and_unstructured -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/lore/structure.py core/tests/test_structure.py
git commit -m "feat(structure): confidence-guarded event stacking + Unstructured nodes"
```

---

### Task 6: Marker-preserving hierarchical markdown render + top-level `build()`

**Files:**
- Modify: `core/lore/structure.py`
- Test: `core/tests/test_structure.py`

**Interfaces:**
- Consumes: `PageText`, `DocNode`, `parse_pages`, `build_tree`.
- Produces: `render_markdown(title:str, pages:list[PageText], nodes:list[DocNode]) -> str`; `build(title:str, markdown:str, provenance:dict|None, note_id:str, llm=None, detectors=None) -> tuple[str, list[DocNode]]`.

- [ ] **Step 1: Write the failing test**

```python
def test_render_preserves_page_markers_and_nests():
    from lore import structure
    md = ("# Budget\n\n## Page 1\n\nARTICLE I\n\nGeneral text one.\n\n"
          "## Page 2\n\nSection 3. Fees\n\nThe fee is $10.")
    prov = {"pages": [{"page": 1, "source": "native"}, {"page": 2, "source": "native"}]}
    out_md, nodes = structure.build("Budget", md, prov, note_id="n1")
    # page markers preserved (as deepest level) so provenance recovery still works
    import re
    assert re.search(r"(?m)^#+\s+Page\s+1\s*$", out_md)
    assert re.search(r"(?m)^#+\s+Page\s+2\s*$", out_md)
    # section heading present at a shallower level than the page marker
    assert re.search(r"(?m)^##\s+ARTICLE I\s*$", out_md)
    # no text moved across pages: "The fee is $10." still after Page 2 marker
    p2 = out_md.split("Page 2", 1)[1]
    assert "The fee is $10." in p2 and "General text one." not in p2


def test_chunk_markdown_over_rendered_gets_rich_heading_path():
    from lore import structure
    from lore.chunker import chunk_markdown
    md = ("# Budget\n\n## Page 1\n\nARTICLE I\n\n"
          "Section 3. Recording Fees\n\nThe recording fee is ten dollars per page filed.")
    prov = {"pages": [{"page": 1, "source": "native"}]}
    out_md, _ = structure.build("Budget", md, prov, note_id="n1")
    chunks = chunk_markdown("n1", out_md)
    assert any("ARTICLE I" in c.heading_path and "Section 3" in c.heading_path
               and "Page 1" in c.heading_path for c in chunks)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && python -m pytest tests/test_structure.py -k "render_preserves or rich_heading" -v`
Expected: FAIL (`AttributeError: build` / `render_markdown`).

- [ ] **Step 3: Write minimal implementation**

```python
# append to core/lore/structure.py
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
    observed on, and each page kept as a `###### Page N` leaf. Insertions only —
    body text is never moved across a page boundary."""
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


def build(title, markdown, provenance, note_id, llm=None, detectors=None):
    """Deterministic structure pass. Returns (hierarchical_markdown, doc_nodes).
    On any failure, returns the ORIGINAL markdown and [] — never worse than off."""
    try:
        pages = parse_pages(markdown, provenance)
        if not pages:
            return markdown, []
        nodes = build_tree(pages, note_id, detectors=detectors)
        if llm is not None:
            for n in nodes:
                if n.source != "unstructured":
                    n.title = _rewrite_title(n.title, llm)
        return render_markdown(title, pages, nodes), nodes
    except Exception:
        return markdown, []


def _rewrite_title(title, llm):
    """Optional: LLM may normalize an OBSERVED title's casing/OCR noise. It may not
    invent a node. Falls back to the observed title on any error/empty result."""
    try:
        prompt = ("Rewrite this document heading with clean casing and spacing. "
                  "Do not add or invent words. Return only the heading.\n" + title)
        out = (llm(prompt) or "").strip()
        return out or title
    except Exception:
        return title
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && python -m pytest tests/test_structure.py -k "render_preserves or rich_heading" -v`
Expected: PASS.

- [ ] **Step 5: Run the full module suite + commit**

Run: `cd core && python -m pytest tests/test_structure.py -v`
Expected: PASS (all).

```bash
git add core/lore/structure.py core/tests/test_structure.py
git commit -m "feat(structure): marker-preserving render + build() entrypoint"
```

---

### Task 7: `doc_nodes` table + `notes.builder_version` column

**Files:**
- Modify: `core/lore/db.py` (add table to `SCHEMA` and `SCHEMA_SQLITE`; add column migration; probe-and-add in `bootstrap_schema`)
- Test: `core/tests/test_structure_schema.py`

**Interfaces:**
- Produces: table `doc_nodes(id, tenant_id, note_id, parent_id, title, level, page_start, page_end, source, confidence, builder_version, created_at)`; column `notes.builder_version text`.

- [ ] **Step 1: Write the failing test**

```python
# core/tests/test_structure_schema.py
def test_doc_nodes_table_and_builder_version_column(conn):
    # doc_nodes accepts a row
    conn.execute("delete from doc_nodes where note_id=%s", ("nX",))
    conn.execute(
        "insert into doc_nodes(id,tenant_id,note_id,parent_id,title,level,"
        "page_start,page_end,source,confidence,builder_version) "
        "values(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        ("d1", "t1", "nX", None, "ARTICLE I", 1, 1, 3, "regex", 0.7, "doc-tree/1"))
    row = conn.execute("select title, page_end from doc_nodes where id=%s", ("d1",)).fetchone()
    assert row[0] == "ARTICLE I" and row[1] == 3
    # notes.builder_version column exists
    conn.execute("select builder_version from notes limit 1")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && python -m pytest tests/test_structure_schema.py -v`
Expected: FAIL (`no such table: doc_nodes`).

- [ ] **Step 3: Write minimal implementation**

Add the same `create table if not exists doc_nodes(...)` block to BOTH `SCHEMA` and `SCHEMA_SQLITE` in `core/lore/db.py` (PG uses `timestamptz default now()`, SQLite uses `timestamp default current_timestamp`):

```sql
create table if not exists doc_nodes(
  id text primary key,
  tenant_id text not null,
  note_id text not null references notes(id) on delete cascade,
  parent_id text,
  title text not null,
  level integer not null,
  page_start integer,
  page_end integer,
  source text,
  confidence real default 0,
  builder_version text,
  created_at timestamptz default now());        -- SQLite: timestamp default current_timestamp
create index if not exists doc_nodes_note on doc_nodes(note_id);
```

Add the `builder_version` column to the `notes` create-table in both `SCHEMA` and `SCHEMA_SQLITE` (`builder_version text,` after `content_hash text,`). Then make existing DBs get it:

PG — add to a migration list run in `bootstrap_schema` (mirror `_BODY_MIGRATION`):

```python
_DOC_TREE_MIGRATION = [
    "alter table notes add column if not exists builder_version text",
]
# ...in bootstrap_schema (PG branch), before Step 3 conn.execute(SCHEMA):
for stmt in _DOC_TREE_MIGRATION:
    try:
        conn.execute(stmt)
    except Exception:
        pass
```

SQLite — probe-and-add in the `_SqliteConn` branch of `bootstrap_schema` (mirror the `memory_type` probe):

```python
try:
    conn.execute("alter table notes add column builder_version text")
except Exception:
    pass  # column already exists
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && python -m pytest tests/test_structure_schema.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/lore/db.py core/tests/test_structure_schema.py
git commit -m "feat(db): doc_nodes table + notes.builder_version column"
```

---

### Task 8: Persist nodes + wire `build()` into `index_document` behind the flag

**Files:**
- Modify: `core/lore/index.py` (add `_persist_doc_nodes`; insert structure step before line ~304; stamp `builder_version` on the notes upsert)
- Test: `core/tests/test_doc_tree_index.py`

**Interfaces:**
- Consumes: `structure.enabled`, `structure.build`, `structure.BUILDER_VERSION`.
- Produces: `index._persist_doc_nodes(conn, tenant_id, note_id, nodes, builder_version)`.

- [ ] **Step 1: Write the failing test**

```python
# core/tests/test_doc_tree_index.py
import re
from lore import index, db, structure, embed as _embed  # adjust embed import to the project's fake


def _fake_embedder():
    from lore.embed import get_embedder      # project's Fake embedder under VAULT_FAKE=1
    return get_embedder()


def test_flag_off_leaves_flat_paths(conn, monkeypatch):
    monkeypatch.delenv("LORE_DOC_TREE", raising=False)
    md = "# Ord\n\n## Page 1\n\nARTICLE I\n\nSection 3. Fees\n\nThe fee is ten dollars.\n"
    index.index_document(source_id="flatnote", title="Ord", text=md, scope_id="eng",
                         owner_id="u", tenant_id="t1", embedder=_fake_embedder(), conn=conn)
    paths = [r[0] for r in conn.execute(
        "select heading_path from chunks where note_id=%s", ("flatnote",)).fetchall()]
    assert paths and all("Page" in p for p in paths)
    assert not any("ARTICLE" in p for p in paths)         # flat when flag off


def test_flag_on_enriches_paths_and_persists_nodes(conn, monkeypatch):
    monkeypatch.setenv("LORE_DOC_TREE", "1")
    md = "# Ord\n\n## Page 1\n\nARTICLE I\n\nSection 3. Fees\n\nThe recording fee is ten dollars.\n"
    prov = {"pages": [{"page": 1, "source": "native"}]}
    index.index_document(source_id="treenote", title="Ord", text=md, scope_id="eng",
                         owner_id="u", tenant_id="t1", embedder=_fake_embedder(),
                         conn=conn, provenance=prov)
    paths = [r[0] for r in conn.execute(
        "select heading_path from chunks where note_id=%s", ("treenote",)).fetchall()]
    assert any("ARTICLE I" in p for p in paths)
    nodes = conn.execute("select title from doc_nodes where note_id=%s", ("treenote",)).fetchall()
    assert any("ARTICLE I" == t[0] for t in nodes)
    bv = conn.execute("select builder_version from notes where id=%s", ("treenote",)).fetchone()[0]
    assert bv == structure.BUILDER_VERSION
```

Note: `index_document` gains an optional `provenance=None` keyword (extraction provenance is available at the call site in `index_note`/ingest; pass it through). If the project's fake-embedder accessor differs, adjust `_fake_embedder()` to match `core/tests/test_index_recall_e2e.py`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && python -m pytest tests/test_doc_tree_index.py -v`
Expected: FAIL (`TypeError: index_document() got an unexpected keyword argument 'provenance'`, or enriched paths absent).

- [ ] **Step 3: Write minimal implementation**

In `core/lore/index.py`:

1. Add `provenance=None` to the `index_document` signature.
2. Add the persister:

```python
def _persist_doc_nodes(conn, tenant_id, note_id, nodes, builder_version):
    conn.execute("delete from doc_nodes where note_id=%s", (note_id,))
    for n in nodes:
        conn.execute(
            "insert into doc_nodes(id,tenant_id,note_id,parent_id,title,level,"
            "page_start,page_end,source,confidence,builder_version) "
            "values(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (n.id, tenant_id, note_id, n.parent_id, n.title, n.level,
             n.page_start, n.page_end, n.source, n.confidence, builder_version))
```

3. Insert the structure step immediately before `chunks = apply_context(...)` (line ~304), and stamp the version. Replace the notes-upsert column set to include `builder_version`:

```python
from . import structure

builder_version = None
if structure.enabled() and structure._PAGE_MARKER_RE.search(text or ""):
    text, _nodes = structure.build(title, text, provenance, note_id=source_id, llm=None)
    builder_version = structure.BUILDER_VERSION
    # persisted AFTER the notes row exists (FK on note_id) — see below
```

Because `doc_nodes.note_id` FK-references `notes(id)`, persist nodes AFTER the existing notes upsert. Add the `builder_version` column to that upsert (the `insert into notes(...)` at ~277): add `builder_version` to the column list, a `%s` bind, `builder_version` to the params tuple, and `builder_version=excluded.builder_version` to the `on conflict do update set`. Then, right after the notes upsert and before chunking, persist nodes when the flag produced them:

```python
if builder_version is not None:
    _persist_doc_nodes(conn, tenant_id, source_id, _nodes, builder_version)
```

Keep the structure `build()` call BEFORE the notes upsert (it rewrites `text`, and the upsert stores `body=text`), but move `_persist_doc_nodes` to AFTER it. Concretely: compute `text, _nodes, builder_version` first; do the notes upsert (now storing `builder_version`); then `_persist_doc_nodes`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && python -m pytest tests/test_doc_tree_index.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add core/lore/index.py core/tests/test_doc_tree_index.py
git commit -m "feat(index): structure pass + doc_nodes persistence behind LORE_DOC_TREE"
```

---

### Task 9: Mixed-index guard (`needs_rebuild`)

**Files:**
- Modify: `core/lore/structure.py`
- Test: `core/tests/test_doc_tree_index.py`

**Interfaces:**
- Produces: `structure.stale_notes(conn, tenant_id) -> list[str]` — note_ids whose stored `builder_version` differs from the current `BUILDER_VERSION` while the flag is on (or that hold `doc_nodes` while the flag is off). Used by doctor/upkeep to rebuild-or-refuse; never silently mixes.

- [ ] **Step 1: Write the failing test**

```python
def test_stale_notes_flags_version_mismatch(conn, monkeypatch):
    monkeypatch.setenv("LORE_DOC_TREE", "1")
    conn.execute("update notes set builder_version=%s where id=%s",
                 ("doc-tree/OLD", "treenote"))
    stale = structure.stale_notes(conn, "t1")
    assert "treenote" in stale
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && python -m pytest tests/test_doc_tree_index.py::test_stale_notes_flags_version_mismatch -v`
Expected: FAIL (`ImportError: stale_notes`).

- [ ] **Step 3: Write minimal implementation**

```python
# append to core/lore/structure.py
def stale_notes(conn, tenant_id):
    """note_ids indexed under a different builder version (flag on) or carrying a
    tree while the flag is off — a rebuild-or-refuse worklist, never a silent mix."""
    if enabled():
        rows = conn.execute(
            "select id from notes where tenant_id=%s and builder_version is not null "
            "and builder_version <> %s", (tenant_id, BUILDER_VERSION)).fetchall()
    else:
        rows = conn.execute(
            "select distinct note_id from doc_nodes where tenant_id=%s", (tenant_id,)).fetchall()
    return [r[0] for r in rows]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && python -m pytest tests/test_doc_tree_index.py::test_stale_notes_flags_version_mismatch -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/lore/structure.py core/tests/test_doc_tree_index.py
git commit -m "feat(structure): stale_notes mixed-index guard (rebuild-or-refuse worklist)"
```

---

### Task 10: Widen the eval's per-page provenance recovery regex

**Files:**
- Modify: `eval/scenarios/run_onboard_directory.py:65` (and any sibling `^## Page` split)
- Test: `core/tests/test_doc_tree_index.py` (a small regex-parity assertion so the change is covered)

**Interfaces:**
- Consumes: rendered markdown from Task 6 (`###### Page N`).

- [ ] **Step 1: Write the failing test**

```python
def test_rendered_pages_recoverable_by_widened_regex():
    import re
    from lore import structure
    md = "# T\n\n## Page 1\n\nARTICLE I\n\nbody one\n\n## Page 2\n\nbody two\n"
    prov = {"pages": [{"page": 1, "source": "native"}, {"page": 2, "source": "native"}]}
    out_md, _ = structure.build("T", md, prov, note_id="n1")
    # OLD eval regex would miss the deeper markers; the widened one must recover both
    old = re.split(r"(?m)^## Page (\d+)\s*$", out_md)
    widened = re.split(r"(?m)^#+ Page (\d+)\s*$", out_md)
    assert old.count("1") == 0            # deep markers not matched by the old regex
    assert widened.count("1") == 1 and widened.count("2") == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && python -m pytest tests/test_doc_tree_index.py::test_rendered_pages_recoverable_by_widened_regex -v`
Expected: PASS for the assertion about the widened regex, FAIL only if Task 6's render regressed — this test primarily documents the eval contract. If it passes immediately, proceed to update the eval file (the code change below is the deliverable).

- [ ] **Step 3: Update the eval harness**

In `eval/scenarios/run_onboard_directory.py`, change the page-split regex from
`r"(?m)^## Page (\d+)\s*$"` to `r"(?m)^#+ Page (\d+)\s*$"` (both the split in
`reconstruct_ocr_metrics` and any other occurrence found via
`grep -n "## Page" eval/scenarios/run_onboard_directory.py`).

- [ ] **Step 4: Run tests**

Run: `cd core && python -m pytest tests/test_doc_tree_index.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add eval/scenarios/run_onboard_directory.py core/tests/test_doc_tree_index.py
git commit -m "eval(onboard): recover per-page provenance under deep page markers"
```

---

### Task 11: Full-suite regression + eval gate

**Files:**
- No new code. Run the existing suites and the municipal eval; record the gate result.

- [ ] **Step 1: Run the whole core test suite**

Run: `cd core && python -m pytest -q`
Expected: PASS (no regressions in existing tests; the flag is off by default so the flat path is unchanged).

- [ ] **Step 2: Run the municipal onboarding eval with the flag OFF (baseline parity)**

Run: `python eval/scenarios/run_onboard_directory.py --root "<municipal corpus path>" --tenant onboard --out eval/history/onboard-doctree-off-<date>.json`
Expected: recall/organization parity with `eval/history/onboard-municipal-ocr-fixed-full-2026-07-22.json`.

- [ ] **Step 3: Run the eval with the flag ON**

Run (PowerShell): `$env:LORE_DOC_TREE=1; python eval/scenarios/run_onboard_directory.py --root "<municipal corpus path>" --tenant onboard-tree --out eval/history/onboard-doctree-on-<date>.json`
Expected: recall@5 does not regress vs baseline; capture wrong-nesting rate and nDCG delta.

- [ ] **Step 4: Apply the kill criterion**

If wrong-nesting rate exceeds the agreed threshold, keep the flag OFF (ship flat) and open a follow-up to tune detectors. Otherwise, record the win in `docs/superpowers/specs/2026-07-24-doc-tree-municipal-design.md` results and proceed.

- [ ] **Step 5: Commit the eval artifacts**

```bash
git add eval/history/onboard-doctree-*.json docs/superpowers/specs/2026-07-24-doc-tree-municipal-design.md
git commit -m "eval(doc-tree): municipal gate results (flag on vs off)"
```

---

## Self-Review

**Spec coverage:**
- Deterministic builder (get_toc/font/regex/caps) → Tasks 3 (regex), 5 (stacking). Font-outlier and validated `get_toc` detectors are pluggable via `build_tree(detectors=...)`; regex+caps+header-strip is the v1 detector set. **Gap noted:** font-outlier + `get_toc` adapters from `fitz` are not separate tasks here — they are a fast follow-up that appends detectors to `_default_detectors()`; v1 lands on regex + header-strip, which the eval gate (Task 11) validates before promotion. If the gate shows insufficient coverage, add the font detector before enabling the flag.
- Confidence guard (one rule) → Tasks 2, 5. ✓
- Marker-preserving render + `###### Page N` → Task 6. ✓
- `doc_nodes` + version stamp → Tasks 7, 8. ✓
- Mixed-index guard → Task 9. ✓
- Eval regex widen → Task 10. ✓
- Kill criterion / gate → Task 11. ✓
- Optional LLM title-rewrite only → Task 6 (`_rewrite_title`). ✓
- Deferred (node-summary index, reasoning-nav, LLM summaries) → correctly absent. ✓

**Placeholder scan:** `<municipal corpus path>` and `<date>` in Task 11 are runtime values supplied at execution, not code placeholders. `_fake_embedder()` cross-references `test_index_recall_e2e.py` for the exact fake accessor — resolve at execution. No TODO/TBD in code steps.

**Type consistency:** `PageText`, `HeadingEvent`, `DocNode` fields are consistent across Tasks 1/3/5. `build()` returns `(str, list[DocNode])` consumed identically in Tasks 6 and 8. `_PAGE_MARKER_RE` defined in Task 1, reused in Task 8. `BUILDER_VERSION` defined Task 1, used Tasks 8/9. ✓

**Caveat to resolve at execution:** confirm the fake-embedder accessor and whether `index_note`/ingest call sites thread `provenance` into `index_document`; if a caller doesn't yet pass it, add the pass-through in Task 8 (the extraction provenance comes from `distill.distill_document`).
