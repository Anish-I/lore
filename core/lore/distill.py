import hashlib, os, re

from . import extract as _extract


def distill_document(path):
    """Read a source file into (note_id, title, markdown, extraction provenance)."""
    ext = os.path.splitext(path)[1].lower()
    note_id = hashlib.sha1(path.encode()).hexdigest()[:16]
    if ext in _extract.EXTRACTABLE_EXTS:
        got = _extract.extract_document(path)
        if got is None:
            return note_id, os.path.splitext(os.path.basename(path))[0], "", None
        return note_id, got.title, got.text, got.provenance
    with open(path, encoding="utf-8") as f:
        md = f.read()
    m = re.search(r"^#\s+(.+)$", md, re.M)
    title = m.group(1).strip() if m else os.path.splitext(os.path.basename(path))[0]
    return note_id, title, md, None


def distill_md(path):
    """Read a source file into (note_id, title, markdown).

    .md/.txt read as-is; .pdf/.docx go through extract.extract_text (M4) so
    the import-modal's "Word docs, PDFs" promise is real, not aspirational.
    """
    note_id, title, md, _provenance = distill_document(path)
    return note_id, title, md
