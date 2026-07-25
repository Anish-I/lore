"""Deterministic document-structure builder (municipal OCR path, LORE_DOC_TREE)."""
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
    assert next(e.level for e in ev if e.title == "ARTICLE I") == 1
    assert next(e.level for e in ev if e.title.startswith("Section 3")) == 2
    assert next(e.level for e in ev if e.title.startswith("3.2.1")) == 3


def test_strip_running_lines_removes_banner_keeps_unique():
    from lore.structure import PageText, strip_running_lines
    pages = [
        PageText(i, "native", None, False,
                 f"City of Xville - Agenda\nUnique body line {i}\nPage {i} of 5")
        for i in range(1, 6)
    ]
    out = strip_running_lines(pages)
    joined = "\n".join(p.text for p in out)
    assert "City of Xville - Agenda" not in joined      # repeated banner stripped
    assert "Unique body line 3" in joined               # unique content kept


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
    # >=4 consecutive non-clearing pages -> an explicit Unstructured node.
    # Page 3 (review-flagged OCR) is non-clearing too, so the run is 3..7.
    uns = next(n for n in nodes if n.title.startswith("Unstructured"))
    assert uns.page_start == 3 and uns.page_end == 7
