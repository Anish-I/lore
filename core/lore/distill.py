import hashlib, os, re

from . import extract as _extract


def distill_md(path):
    """Read a source file into (note_id, title, markdown).

    .md/.txt read as-is; .pdf/.docx go through extract.extract_text (M4) so
    the import-modal's "Word docs, PDFs" promise is real, not aspirational.
    """
    ext = os.path.splitext(path)[1].lower()
    note_id = hashlib.sha1(path.encode()).hexdigest()[:16]
    if ext in _extract.EXTRACTABLE_EXTS:
        got = _extract.extract_text(path)
        if got is None:
            return note_id, os.path.splitext(os.path.basename(path))[0], ""
        title, md = got
        return note_id, title, md
    with open(path, encoding="utf-8") as f:
        md = f.read()
    m = re.search(r"^#\s+(.+)$", md, re.M)
    title = m.group(1).strip() if m else os.path.splitext(os.path.basename(path))[0]
    return note_id, title, md
