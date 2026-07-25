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
