"""Textract OCR tier (LORE_OCR_TEXTRACT): offline block-parsing tests.

No AWS calls here — these tests exercise the response-parsing and detector
logic against a synthetic AnalyzeDocument response. The live client is only
constructed when the flag is on AND boto3 credentials resolve.
"""
from lore import textract_ocr
from lore.structure import PageText


def _blocks():
    # Minimal AnalyzeDocument(LAYOUT) response shape: LAYOUT_TITLE and
    # LAYOUT_SECTION_HEADER reference LINE blocks via CHILD relationships.
    return {
        "Blocks": [
            {"Id": "t1", "BlockType": "LAYOUT_TITLE", "Confidence": 93.0,
             "Relationships": [{"Type": "CHILD", "Ids": ["l1"]}]},
            {"Id": "h1", "BlockType": "LAYOUT_SECTION_HEADER", "Confidence": 88.0,
             "Relationships": [{"Type": "CHILD", "Ids": ["l2"]}]},
            {"Id": "l1", "BlockType": "LINE", "Text": "TOWN OF ELLINGTON BUDGET", "Confidence": 92.5},
            {"Id": "l2", "BlockType": "LINE", "Text": "Board of Finance Salaries", "Confidence": 88.4},
            {"Id": "l3", "BlockType": "LINE", "Text": "Clerk salary 54,320", "Confidence": 97.1},
        ]
    }


def test_flag_default_off(monkeypatch):
    monkeypatch.delenv("LORE_OCR_TEXTRACT", raising=False)
    assert textract_ocr.enabled() is False
    monkeypatch.setenv("LORE_OCR_TEXTRACT", "1")
    assert textract_ocr.enabled() is True


def test_parse_blocks_text_and_confidence():
    text, conf = textract_ocr.parse_text(_blocks())
    lines = text.splitlines()
    assert "TOWN OF ELLINGTON BUDGET" in lines
    assert "Clerk salary 54,320" in lines
    assert 0.88 < conf < 1.0            # normalized to [0,1] like RapidOCR


def test_layout_headings_extracted_with_levels():
    heads = textract_ocr.parse_headings(_blocks())
    # LAYOUT_TITLE -> level 1, LAYOUT_SECTION_HEADER -> level 2
    assert ("TOWN OF ELLINGTON BUDGET", 1) in [(h["title"], h["level"]) for h in heads]
    assert ("Board of Finance Salaries", 2) in [(h["title"], h["level"]) for h in heads]


def test_detector_emits_confidence_guarded_events():
    # The textract detector reads page.textract_headings stashed by the router;
    # a page WITHOUT stashed headings emits nothing.
    page = PageText(3, "ocr_textract", 0.90, False, "TOWN OF ELLINGTON BUDGET\n...")
    page.textract_headings = textract_ocr.parse_headings(_blocks())
    ev = textract_ocr.detect_textract(page)
    assert any(e.title == "TOWN OF ELLINGTON BUDGET" and e.level == 1 for e in ev)
    assert all(e.source == "textract" for e in ev)

    bare = PageText(4, "ocr_textract", 0.90, False, "text")
    assert textract_ocr.detect_textract(bare) == []


def test_clears_confidence_accepts_good_textract_pages():
    from lore.structure import clears_confidence
    from lore import ocr
    good = PageText(1, "ocr_textract", ocr._REVIEW_CONF + 0.1, False, "x")
    bad = PageText(2, "ocr_textract", ocr._REVIEW_CONF - 0.2, False, "x")
    flagged = PageText(3, "ocr_textract", 0.99, True, "x")
    assert clears_confidence(good) is True
    assert clears_confidence(bad) is False
    assert clears_confidence(flagged) is False


def test_router_escalates_low_conf_ocr_pages_to_textract(monkeypatch, tmp_path):
    """A page that fails the native gate AND comes back low-confidence from
    RapidOCR escalates to Textract when LORE_OCR_TEXTRACT=1; the Textract result
    wins when its confidence is higher, and provenance says ocr_textract."""
    import fitz
    from lore import ocr

    pdf = tmp_path / "scan.pdf"
    doc = fitz.open()
    doc.new_page()                      # blank page -> native text fails the gate
    doc.save(str(pdf))

    monkeypatch.setenv("LORE_OCR_FALLBACK", "1")
    monkeypatch.setenv("LORE_OCR_TEXTRACT", "1")
    # RapidOCR returns junk at low confidence
    monkeypatch.setattr(ocr, "ocr_page", lambda page, dpi=200: ("grbl 111", 0.31))
    # Textract returns clean text + a layout heading at high confidence
    monkeypatch.setattr(
        textract_ocr, "analyze_page_png",
        lambda png: {"Blocks": [
            {"Id": "h1", "BlockType": "LAYOUT_SECTION_HEADER", "Confidence": 91.0,
             "Relationships": [{"Type": "CHILD", "Ids": ["l1"]}]},
            {"Id": "l1", "BlockType": "LINE", "Text": "Board of Finance", "Confidence": 91.0},
            {"Id": "l2", "BlockType": "LINE", "Text": "Salaries were approved.", "Confidence": 93.0},
        ]})

    got = ocr.extract_pdf_routed(str(pdf))
    assert got is not None
    _title, md, prov = got
    assert "Board of Finance" in md
    page_meta = prov["pages"][0]
    assert page_meta["source"] == "ocr_textract"
    assert page_meta["conf"] > 0.85
    # layout headings are stashed in provenance for the doc-tree detector
    assert page_meta["layout_headings"][0]["title"] == "Board of Finance"


def test_structure_build_uses_textract_layout_headings():
    """End-to-end: provenance layout_headings -> textract-sourced doc node with
    the heading in the rendered markdown (scanned pages get real structure)."""
    from lore import structure
    md = "# Scan\n\n## Page 1\n\nBoard of Finance\nSalaries were approved.\n"
    prov = {"pages": [{"page": 1, "source": "ocr_textract", "conf": 0.91,
                       "layout_headings": [
                           {"title": "Board of Finance", "level": 2, "conf": 0.91}]}]}
    out_md, nodes = structure.build("Scan", md, prov, note_id="n9")
    assert any(n.title == "Board of Finance" and n.source == "textract" for n in nodes)
    assert "## Board of Finance" in out_md or "### Board of Finance" in out_md
