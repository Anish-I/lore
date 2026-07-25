"""AWS Textract OCR tier (LORE_OCR_TEXTRACT, default off).

Third per-page tier for the municipal router: native -> ocr_fast (RapidOCR) ->
ocr_textract. COST-ROUTED: only pages that FAILED the native gate and came back
low-confidence/review-flagged from RapidOCR are worth Textract money — native
pages already get free structure from PyMuPDF + deterministic detectors.

Uses the sync AnalyzeDocument API with LAYOUT analysis on a rendered page PNG
(<=10 MB, no S3 round-trip). LAYOUT_TITLE / LAYOUT_SECTION_HEADER blocks double
as a structure detector for the doc-tree (structure.build detectors arg), which
is exactly the gap where scanned pages otherwise stay honest-flat.

Region defaults to us-east-1 (override LORE_TEXTRACT_REGION). Credentials come
from the standard boto3 chain (env/profile) — never stored here. All parsing is
offline-testable; boto3 is imported lazily only when a live call is made.
"""
from __future__ import annotations

import os

from .structure import HeadingEvent, PageText, _next_order

_REGION_DEFAULT = "us-east-1"

# Textract LAYOUT block type -> doc-tree level.
_LAYOUT_LEVEL = {
    "LAYOUT_TITLE": 1,
    "LAYOUT_SECTION_HEADER": 2,
}


class TextractUnavailable(RuntimeError):
    """LORE_OCR_TEXTRACT is on but boto3/credentials are missing."""


def enabled() -> bool:
    return os.environ.get("LORE_OCR_TEXTRACT", "0") == "1"


def region() -> str:
    return os.environ.get("LORE_TEXTRACT_REGION", _REGION_DEFAULT)


# --- offline response parsing (unit-testable without AWS) --------------------

def parse_text(response: dict) -> tuple[str, float]:
    """(text, mean_confidence in [0,1]) from AnalyzeDocument LINE blocks —
    same contract as ocr.ocr_image so the router can treat tiers uniformly."""
    lines, confs = [], []
    for b in response.get("Blocks", []):
        if b.get("BlockType") == "LINE" and (b.get("Text") or "").strip():
            lines.append(b["Text"].strip())
            confs.append(float(b.get("Confidence", 0.0)) / 100.0)
    if not lines:
        return "", 0.0
    return "\n".join(lines), sum(confs) / len(confs)


def parse_headings(response: dict) -> list[dict]:
    """[{title, level, conf}] from LAYOUT_TITLE / LAYOUT_SECTION_HEADER blocks.
    Titles are the joined text of the layout block's CHILD LINE blocks — i.e.
    OBSERVED text, satisfying the doc-tree confidence guard (nothing invented)."""
    by_id = {b.get("Id"): b for b in response.get("Blocks", [])}
    heads = []
    for b in response.get("Blocks", []):
        level = _LAYOUT_LEVEL.get(b.get("BlockType"))
        if level is None:
            continue
        texts = []
        for rel in b.get("Relationships", []) or []:
            if rel.get("Type") != "CHILD":
                continue
            for cid in rel.get("Ids", []):
                child = by_id.get(cid) or {}
                if child.get("BlockType") == "LINE" and (child.get("Text") or "").strip():
                    texts.append(child["Text"].strip())
        title = " ".join(texts).strip()
        if title:
            heads.append({"title": title, "level": level,
                          "conf": float(b.get("Confidence", 0.0)) / 100.0})
    return heads


def detect_textract(page: PageText) -> list[HeadingEvent]:
    """Doc-tree detector: emit heading events from Textract LAYOUT results the
    router stashed on the page (page.textract_headings). Pages without stashed
    headings emit nothing — this detector never re-calls AWS."""
    heads = getattr(page, "textract_headings", None) or []
    return [HeadingEvent(page.page, _next_order(), h["level"], h["title"],
                         "textract", h["conf"]) for h in heads]


# --- live client (lazy; used by the router only when flag + creds are present) ---

_client = None


def _textract_client():
    global _client
    if _client is None:
        try:
            import boto3
            _client = boto3.client("textract", region_name=region())
        except Exception as exc:                      # ImportError or NoCredentials
            raise TextractUnavailable(
                "LORE_OCR_TEXTRACT requires boto3 with configured AWS credentials"
            ) from exc
    return _client


def analyze_page_png(png_bytes: bytes) -> dict:
    """AnalyzeDocument(LAYOUT) on one rendered page image. Raises
    TextractUnavailable when the client can't be built; other AWS errors
    propagate to the router, which falls back to the RapidOCR result."""
    client = _textract_client()
    return client.analyze_document(Document={"Bytes": png_bytes},
                                   FeatureTypes=["LAYOUT"])
