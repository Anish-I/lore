"""OCR fallback for scanned PDFs (2026-07-22 municipal-onboarding finding).

A real town archive was ~40% scanned image PDFs — PyMuPDF returns empty text,
so those records were ingested but unreadable. This adds a per-page 2-tier
router:

  1. native  — PyMuPDF text, IF it passes a text-quality gate
  2. ocr_fast — RapidOCR text detection/recognition on ONNX.

Per-page provenance is returned to callers that use ``extract_document``.
``extract_text`` remains a compatibility wrapper. Gated by LORE_OCR_FALLBACK
(default off); the existing text-only path is unchanged when the flag is unset.

RapidOCR is not a table-structure model. Numeric-heavy OCR pages are marked for
review rather than treated as arithmetically validated.
"""
from __future__ import annotations

import os
import re
import statistics

# --- text-quality gate: is the native PDF text good enough, or is this a
#     scanned / garbage-layer page that needs OCR? Per PAGE, not per document
#     (mixed scanned/native docs and partial garbage layers are real). ---
_MIN_CHARS = 24               # a page with < this much text is suspect
_MIN_ALNUM_RATIO = 0.55       # scanned-garbage layers are punctuation/symbol soup
_MAX_REPLACEMENT = 3          # U+FFFD replacement chars = decode failure


def text_quality(text: str) -> tuple[bool, dict]:
    """(ok, metrics). ok => native text is trustworthy; else route to OCR."""
    t = text or ""
    stripped = t.strip()
    n = len(stripped)
    alnum = sum(c.isalnum() for c in stripped)
    replacement = t.count("�")
    # collapse-heavy pages (one repeated line) also read as low quality
    lines = [ln for ln in stripped.splitlines() if ln.strip()]
    uniq_ratio = (len(set(lines)) / len(lines)) if lines else 0.0
    metrics = {"chars": n, "alnum_ratio": round(alnum / n, 3) if n else 0.0,
               "replacement_chars": replacement, "uniq_line_ratio": round(uniq_ratio, 3)}
    ok = (n >= _MIN_CHARS
          and metrics["alnum_ratio"] >= _MIN_ALNUM_RATIO
          and replacement <= _MAX_REPLACEMENT
          and (uniq_ratio >= 0.3 or len(lines) <= 3))
    return ok, metrics


# --- ocr_fast engine (RapidOCR / ONNX), lazy singleton ---
_rapid = None
_RENDER_DPI = int(os.environ.get("LORE_OCR_DPI", "200"))
_RETRY_DPI = 300              # low-confidence pages get a second, sharper pass
_MIN_CONF = 0.5              # mean line confidence below this triggers the retry
# Explicit, tagged page cap (Sol): never silently truncate a long budget book.
_MAX_PAGES = int(os.environ.get("LORE_OCR_MAX_PAGES", "60"))
_REVIEW_CONF = 0.80
_NUMERIC_TOKEN_RE = re.compile(r"(?<!\w)\$?\s*\d[\d,.]*(?!\w)")


class OCRUnavailable(RuntimeError):
    """The OCR feature was enabled but its optional engine is unavailable."""


def _rapidocr():
    global _rapid
    if _rapid is None:
        try:
            from rapidocr_onnxruntime import RapidOCR
            _rapid = RapidOCR()
        except (ImportError, OSError) as exc:
            raise OCRUnavailable(
                "LORE_OCR_FALLBACK requires the optional 'ocr' dependencies"
            ) from exc
    return _rapid


def _format_ocr_result(result) -> tuple[str, float]:
    """Rebuild rows from RapidOCR boxes instead of discarding their geometry."""
    items = []
    for line in result or []:
        if len(line) < 3 or not str(line[1]).strip():
            continue
        box, value, confidence = line[0], str(line[1]).strip(), float(line[2])
        xs = [float(point[0]) for point in box]
        ys = [float(point[1]) for point in box]
        items.append({
            "x": min(xs),
            "y": sum(ys) / len(ys),
            "height": max(ys) - min(ys),
            "text": value,
            "conf": confidence,
        })
    if not items:
        return "", 0.0

    typical_height = statistics.median(item["height"] for item in items)
    tolerance = max(4.0, typical_height * 0.6)
    rows: list[list[dict]] = []
    row_y: list[float] = []
    for item in sorted(items, key=lambda entry: (entry["y"], entry["x"])):
        if not rows or abs(item["y"] - row_y[-1]) > tolerance:
            rows.append([item])
            row_y.append(item["y"])
        else:
            rows[-1].append(item)
            row_y[-1] = sum(entry["y"] for entry in rows[-1]) / len(rows[-1])

    text = "\n".join(
        "\t".join(entry["text"] for entry in sorted(row, key=lambda entry: entry["x"]))
        for row in rows
    )
    confidences = [item["conf"] for item in items]
    return text, sum(confidences) / len(confidences)


def ocr_image(png_bytes: bytes) -> tuple[str, float]:
    """OCR a rendered page image → (text, mean_confidence in [0,1])."""
    result, _ = _rapidocr()(png_bytes)
    return _format_ocr_result(result)


def ocr_page(page, dpi: int = _RENDER_DPI) -> tuple[str, float]:
    """Render one fitz page → OCR. Retries once at higher DPI if low-confidence."""
    png = page.get_pixmap(dpi=dpi).tobytes("png")
    text, conf = ocr_image(png)
    if conf < _MIN_CONF and dpi < _RETRY_DPI:
        png = page.get_pixmap(dpi=_RETRY_DPI).tobytes("png")
        text2, conf2 = ocr_image(png)
        if conf2 > conf:
            return text2, conf2
    return text, conf


def extract_pdf_routed(path: str) -> tuple[str, str, dict] | None:
    """Per-page routed PDF extraction with provenance.

    Returns (title, markdown, provenance) or None if the file is unreadable.
    provenance = {"pages": [{"page", "source", "chars", "conf?"}...],
                  "native_pages", "ocr_pages", "truncated"}
    """
    import fitz

    try:
        doc = fitz.open(path)
    except Exception:
        return None

    parts, pages_meta = [], []
    native_pages = ocr_pages = usable_pages = 0
    review_pages = []
    truncated = doc.page_count > _MAX_PAGES
    for i, page in enumerate(doc):
        if i >= _MAX_PAGES:
            break
        native = page.get_text("text") or ""
        ok, _m = text_quality(native)
        if ok:
            parts.append(f"## Page {i + 1}\n\n{native.strip()}")
            pages_meta.append({"page": i + 1, "source": "native", "chars": len(native.strip())})
            native_pages += 1
            usable_pages += 1
            continue
        try:
            text, conf = ocr_page(page)
        except OCRUnavailable:
            raise
        except Exception as exc:
            pages_meta.append({"page": i + 1, "source": "error", "chars": 0,
                               "error": type(exc).__name__})
            parts.append(f"## Page {i + 1}\n\n[OCR extraction failed for this page]")
            review_pages.append(i + 1)
            continue
        # Tier 3 (LORE_OCR_TEXTRACT, cost-routed): only pages RapidOCR handled
        # poorly are worth Textract money. Higher-confidence Textract text wins;
        # its LAYOUT headings ride along in provenance for the doc-tree.
        tier_source, layout_headings = "ocr_fast", None
        if conf < _REVIEW_CONF and _textract_enabled():
            from . import textract_ocr
            try:
                png = page.get_pixmap(dpi=_RENDER_DPI).tobytes("png")
                resp = textract_ocr.analyze_page_png(png)
                t_text, t_conf = textract_ocr.parse_text(resp)
                if t_text.strip() and t_conf > conf:
                    text, conf = t_text, t_conf
                    tier_source = "ocr_textract"
                    layout_headings = textract_ocr.parse_headings(resp) or None
            except textract_ocr.TextractUnavailable:
                raise
            except Exception:
                pass    # AWS hiccup -> keep the RapidOCR result (never worse)
        if text.strip():
            reasons = []
            if conf < _REVIEW_CONF:
                reasons.append("low_confidence")
            if len(_NUMERIC_TOKEN_RE.findall(text)) >= 4:
                reasons.append("numeric_content")
            meta = {"page": i + 1, "source": tier_source,
                    "chars": len(text.strip()), "conf": round(conf, 3)}
            if layout_headings:
                meta["layout_headings"] = layout_headings
            if reasons:
                meta["review_reasons"] = reasons
                review_pages.append(i + 1)
            pages_meta.append(meta)
            parts.append(f"## Page {i + 1}\n\n{text.strip()}")
            ocr_pages += 1
            usable_pages += 1
        else:
            pages_meta.append({"page": i + 1, "source": "unreadable", "chars": 0})
            parts.append(f"## Page {i + 1}\n\n[No extractable text was recovered from this page]")
            review_pages.append(i + 1)

    body = re.sub(r"\n{3,}", "\n\n", "\n\n".join(p for p in parts if p)).strip()
    if truncated:
        body += f"\n\n[truncated at {_MAX_PAGES} of {doc.page_count} pages — raise LORE_OCR_MAX_PAGES]"
    title = os.path.splitext(os.path.basename(path))[0]
    prov = {"pages": pages_meta, "native_pages": native_pages,
            "ocr_pages": ocr_pages, "truncated": truncated,
            "engine": "rapidocr-onnx", "review_pages": sorted(set(review_pages))}
    if usable_pages == 0:
        return title, "", prov
    return title, f"# {title}\n\n{body}\n", prov


def _textract_enabled() -> bool:
    # Local import indirection so this module stays importable without boto3.
    return os.environ.get("LORE_OCR_TEXTRACT", "0") == "1"


def enabled() -> bool:
    return os.environ.get("LORE_OCR_FALLBACK", "0") == "1"
