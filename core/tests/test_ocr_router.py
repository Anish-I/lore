"""OCR fallback router and the municipal budget regression fixture."""
import os
import re
from pathlib import Path

import pytest
from lore import extract, ocr


def test_text_quality_gate():
    # good native text passes
    ok, m = ocr.text_quality(
        "The Board of Finance met on January 9 to review the proposed budget "
        "and approved transfers totaling one hundred twenty three thousand.")
    assert ok and m["alnum_ratio"] > 0.55

    # empty / too-short fails
    assert not ocr.text_quality("")[0]
    assert not ocr.text_quality("   \n  ")[0]
    assert not ocr.text_quality("BOF 2017")[0]           # under min chars

    # symbol-soup garbage layer fails on alnum ratio
    assert not ocr.text_quality("@#$%^&*()_+={}[]|\\<>?/~`" * 4)[0]

    # decode-failure (replacement chars) fails
    assert not ocr.text_quality("meeting minutes " + "�" * 6 + " approved budget")[0]

    # one repeated line (collapse) fails the uniqueness check
    assert not ocr.text_quality(("same line\n" * 20))[0]


def test_flag_default_off(monkeypatch):
    monkeypatch.delenv("LORE_OCR_FALLBACK", raising=False)
    assert ocr.enabled() is False
    monkeypatch.setenv("LORE_OCR_FALLBACK", "1")
    assert ocr.enabled() is True
    monkeypatch.setenv("LORE_OCR_FALLBACK", "0")
    assert ocr.enabled() is False


def test_extract_text_unaffected_when_flag_off(monkeypatch, tmp_path):
    # non-pdf path never touches the OCR router
    monkeypatch.setenv("LORE_OCR_FALLBACK", "1")
    assert extract.extract_text("notes.md") is None       # unsupported ext, no crash
    # unsupported extension short-circuits before any OCR import
    assert extract.extract_text(str(tmp_path / "x.rtf")) is None


def test_ocr_geometry_rebuilds_rows_in_reading_order():
    result = [
        ([[90, 40], [100, 40], [100, 50], [90, 50]], "$", 0.99),
        ([[10, 42], [80, 42], [80, 52], [10, 52]], "Town Clerk", 0.97),
        ([[105, 41], [145, 41], [145, 51], [105, 51]], "9,485", 0.95),
        ([[10, 10], [80, 10], [80, 20], [10, 20]], "Heading", 0.98),
    ]
    text, confidence = ocr._format_ocr_result(result)
    assert text.splitlines() == ["Heading", "Town Clerk\t$\t9,485"]
    assert 0.95 < confidence < 1.0


def test_missing_ocr_engine_is_not_silently_treated_as_an_empty_page(monkeypatch, tmp_path):
    import fitz
    monkeypatch.setenv("LORE_OCR_FALLBACK", "1")

    pdf = fitz.open()
    page = pdf.new_page()
    page.insert_text((72, 72), "Native text with enough ordinary prose to pass the quality gate.")
    pdf.new_page()  # low-quality page forces the OCR lane
    path = tmp_path / "mixed.pdf"
    pdf.save(path)
    pdf.close()

    def unavailable(_page, dpi=ocr._RENDER_DPI):
        raise ocr.OCRUnavailable("missing")

    monkeypatch.setattr(ocr, "ocr_page", unavailable)
    with pytest.raises(ocr.OCRUnavailable):
        extract.extract_document(str(path))


def test_unreadable_page_is_visible_in_text_and_provenance(monkeypatch, tmp_path):
    import fitz
    monkeypatch.setenv("LORE_OCR_FALLBACK", "1")

    pdf = fitz.open()
    page = pdf.new_page()
    page.insert_text((72, 72), "Native text with enough ordinary prose to pass the quality gate.")
    pdf.new_page()
    path = tmp_path / "mixed.pdf"
    pdf.save(path)
    pdf.close()

    monkeypatch.setattr(ocr, "ocr_page", lambda _page, dpi=ocr._RENDER_DPI: ("", 0.0))
    result = extract.extract_document(str(path))
    assert result is not None
    assert "No extractable text was recovered from this page" in result.text
    assert result.provenance["pages"][1]["source"] == "unreadable"
    assert result.provenance["review_pages"] == [2]


def test_fully_unreadable_pdf_remains_empty_but_keeps_provenance(monkeypatch, tmp_path):
    import fitz
    monkeypatch.setenv("LORE_OCR_FALLBACK", "1")

    pdf = fitz.open()
    pdf.new_page()
    path = tmp_path / "blank.pdf"
    pdf.save(path)
    pdf.close()

    monkeypatch.setattr(ocr, "ocr_page", lambda _page, dpi=ocr._RENDER_DPI: ("", 0.0))
    result = extract.extract_document(str(path))
    assert result is not None and result.text == ""
    assert result.provenance["pages"][0]["source"] == "unreadable"
    assert extract.extract_text(str(path)) is None


def test_provenance_shape():
    # the routed extractor promises a provenance dict; assert its contract on a
    # tiny synthetic PDF built with fitz (native-text page → source 'native').
    import fitz
    p = fitz.open()
    page = p.new_page()
    page.insert_text((72, 72),
                     "Town of Ellington Board of Finance regular meeting minutes "
                     "with enough ordinary prose to pass the native text-quality gate cleanly.")
    path = os.path.join(os.environ.get("TEMP", "/tmp"), "ocr-native.pdf")
    p.save(path)
    p.close()
    title, text, prov = ocr.extract_pdf_routed(path)
    assert prov["native_pages"] == 1 and prov["ocr_pages"] == 0
    assert prov["pages"][0]["source"] == "native"
    assert "Ellington" in text
    os.remove(path)


def test_real_budget_ocr_preserves_label_value_digit_pairs():
    pytest.importorskip("rapidocr_onnxruntime")
    fixture = Path(__file__).parents[2] / "eval" / "scenarios" / "bof_salary.png"
    if not fixture.exists():
        pytest.skip("municipal OCR fixture not present")

    text, confidence = ocr.ocr_image(fixture.read_bytes())
    expected = {
        "boardofselectmen": "5144",
        "financeofficer": "9076",
        "taxcollector": "5506",
        "townclerk": "9485",
        "townplanner": "3510",
        "police": "6282",
        "animalcontrolofficer": "1170",
        "emergencymanagement": "836",
        "buildingofficial": "5176",
        "firemarshal": "3943",
        "generaltownroads": "50134",
        "parksrecreation": "4577",
        "humanservices": "15503",
        "seniorcenter": "2803",
    }
    normalized_rows = [re.sub(r"[^a-z0-9]", "", row.lower()) for row in text.splitlines()]
    for label, digits in expected.items():
        assert any(label in row and digits in row for row in normalized_rows), (label, digits)
    assert confidence > 0.9
    assert len(ocr._NUMERIC_TOKEN_RE.findall(text)) >= 4
