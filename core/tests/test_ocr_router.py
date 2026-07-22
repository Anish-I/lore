"""OCR fallback router (2026-07-22): the per-page text-quality gate and the
flag-gated extract path. Engine-level OCR accuracy is measured by the
numeric-faithfulness harness on real scanned budget PDFs, not here."""
import os

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
