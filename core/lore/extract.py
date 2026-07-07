"""Text extraction for non-markdown sources (M4): PDF and DOCX.

PDF via PyMuPDF (fitz) — already a dependency of the local stack.
DOCX via stdlib zipfile + XML (a .docx is a zip; word/document.xml holds the
runs) — no python-docx dependency needed.

extract_text(path) -> (title, text) or None when the format is unsupported.
Output is markdown-ish plain text with a leading H1 so the chunker has
structure to work with.
"""
import os
import re
import zipfile
from xml.etree import ElementTree

EXTRACTABLE_EXTS = {".pdf", ".docx"}

_W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _pdf_text(path: str) -> str:
    import fitz  # PyMuPDF
    parts = []
    with fitz.open(path) as doc:
        for page in doc:
            t = page.get_text("text")
            if t and t.strip():
                parts.append(t.strip())
    return "\n\n".join(parts)


def _docx_text(path: str) -> str:
    with zipfile.ZipFile(path) as z:
        xml = z.read("word/document.xml")
    root = ElementTree.fromstring(xml)
    paras = []
    for p in root.iter(f"{_W_NS}p"):
        runs = [t.text or "" for t in p.iter(f"{_W_NS}t")]
        line = "".join(runs).strip()
        if line:
            paras.append(line)
    return "\n\n".join(paras)


def extract_text(path: str):
    """Return (title, markdown_text) for supported binary formats, else None."""
    ext = os.path.splitext(path)[1].lower()
    if ext not in EXTRACTABLE_EXTS:
        return None
    if ext == ".pdf":
        body = _pdf_text(path)
    else:
        body = _docx_text(path)
    body = re.sub(r"\n{3,}", "\n\n", body or "").strip()
    if not body:
        return None
    title = os.path.splitext(os.path.basename(path))[0]
    return title, f"# {title}\n\n{body}\n"
