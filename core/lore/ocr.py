"""OCR fallback for scanned PDFs (2026-07-22 municipal-onboarding finding).

A real town archive was ~40% scanned image PDFs — PyMuPDF returns empty text,
so those records were ingested but unreadable. This adds a per-PAGE 3-tier
router (Sol review 2026-07-22):

  1. native  — PyMuPDF text, IF it passes a text-quality gate
  2. ocr_fast — RapidOCR (PaddleOCR models exported to ONNX; reuses the
                onnxruntime already in the stack, no PaddlePaddle runtime)
  3. vlm      — a local vision model for table-heavy/low-confidence pages.
                Escalation lane only; NOT wired until a vision model is present
                (the local gemma4 build is text-only — verified 2026-07-22).

Per-page provenance is returned so a note carries how each page was read
(native/ocr_fast/vlm + confidence). Gated by LORE_OCR_FALLBACK (default off);
the existing text-only path is unchanged when the flag is unset.

Numeric faithfulness (Sol): OCR of budget tables is only useful if exact values
survive — evaluated separately by the numeric-faithfulness harness, not assumed.
"""
from __future__ import annotations

import os
import re

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


def _rapidocr():
    global _rapid
    if _rapid is None:
        from rapidocr_onnxruntime import RapidOCR
        _rapid = RapidOCR()
    return _rapid


def ocr_image(png_bytes: bytes) -> tuple[str, float]:
    """OCR a rendered page image → (text, mean_confidence in [0,1])."""
    result, _ = _rapidocr()(png_bytes)
    if not result:
        return "", 0.0
    text = "\n".join(line[1] for line in result)
    confs = [float(line[2]) for line in result if len(line) > 2]
    return text, (sum(confs) / len(confs) if confs else 0.0)


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
    native_pages = ocr_pages = 0
    truncated = doc.page_count > _MAX_PAGES
    for i, page in enumerate(doc):
        if i >= _MAX_PAGES:
            break
        native = page.get_text("text") or ""
        ok, _m = text_quality(native)
        if ok:
            parts.append(native.strip())
            pages_meta.append({"page": i + 1, "source": "native", "chars": len(native.strip())})
            native_pages += 1
            continue
        try:
            text, conf = ocr_page(page)
        except Exception:
            text, conf = "", 0.0
        if text.strip():
            parts.append(text.strip())
            pages_meta.append({"page": i + 1, "source": "ocr_fast",
                               "chars": len(text.strip()), "conf": round(conf, 3)})
            ocr_pages += 1
        else:
            # genuinely blank/undecodable page — record it, contribute nothing
            pages_meta.append({"page": i + 1, "source": "empty", "chars": 0})

    body = re.sub(r"\n{3,}", "\n\n", "\n\n".join(p for p in parts if p)).strip()
    if not body:
        return None
    if truncated:
        body += f"\n\n[truncated at {_MAX_PAGES} of {doc.page_count} pages — raise LORE_OCR_MAX_PAGES]"
    title = os.path.splitext(os.path.basename(path))[0]
    prov = {"pages": pages_meta, "native_pages": native_pages,
            "ocr_pages": ocr_pages, "truncated": truncated,
            "engine": "rapidocr-onnx"}
    # Numeric-confidence signal + declarative VLM-escalation flag (Sol review).
    num = numeric_check(body) if ocr_pages else None
    if num:
        prov["numeric_check"] = num
    prov["needs_vlm"] = _needs_vlm(prov, num)
    return title, f"# {title}\n\n{body}\n", prov


# --- numeric-confidence signal (Sol review): a SIGNAL, never a corrector ---
# On documents with obvious single-total structure, check the line items sum to
# the stated TOTAL. A close-but-off sum flags likely OCR damage (e.g. a
# truncated 9,485→485) and lowers confidence — it NEVER rewrites a value.
# Deliberately conservative: multi-total / transfer-from-and-to docs are
# ambiguous, so we stay silent rather than false-positive.
_CURRENCY_RE = re.compile(r"\$\s*([\d][\d,]{2,})")
_NUMERIC_TOL = 0.005          # within this of the total → "ok" (raises confidence)
_MISMATCH_LO = 0.01           # a mismatch this..hi wide reads as OCR damage
_MISMATCH_HI = 0.20           # wider than this → probably multi-section, stay silent


def _amount(s: str) -> int:
    try:
        return int(s.replace(",", ""))
    except ValueError:
        return 0


def numeric_check(text: str) -> dict | None:
    """Return {"status", "stated_total", "observed_sum", "delta"} when a
    single-total structure is clear enough to judge, else None (silent)."""
    total_vals, item_vals = [], []
    for line in text.splitlines():
        amounts = [_amount(m) for m in _CURRENCY_RE.findall(line)]
        if not amounts:
            continue
        (total_vals if re.search(r"\btotal\b", line, re.I) else item_vals).extend(amounts)
    totals = {v for v in total_vals if v > 0}
    items = [v for v in item_vals if v > 0]
    # Need exactly one distinct total and enough line items to judge.
    if len(totals) != 1 or len(items) < 4:
        return None
    total = next(iter(totals))
    observed = sum(items)
    if total <= 0:
        return None
    ratio = abs(observed - total) / total
    if ratio <= _NUMERIC_TOL:
        return {"status": "ok", "stated_total": total, "observed_sum": observed, "delta": observed - total}
    if _MISMATCH_LO <= ratio <= _MISMATCH_HI:
        return {"status": "total_mismatch", "stated_total": total,
                "observed_sum": observed, "delta": observed - total}
    return None                # far off → ambiguous multi-section doc; stay silent


def _needs_vlm(prov: dict, num: dict | None) -> bool:
    """Declarative escalation flag (no VLM is invoked): true when a page OCR'd
    at low confidence, or the numeric check found a total mismatch."""
    low_conf = any(pg.get("source") == "ocr_fast" and pg.get("conf", 1.0) < _MIN_CONF
                   for pg in prov.get("pages", []))
    return bool(low_conf or (num and num.get("status") == "total_mismatch"))


def enabled() -> bool:
    return os.environ.get("LORE_OCR_FALLBACK", "0") == "1"
