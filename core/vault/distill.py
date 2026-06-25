import hashlib, os, re

def distill_md(path):
    with open(path, encoding="utf-8") as f:
        md = f.read()
    note_id = hashlib.sha1(path.encode()).hexdigest()[:16]
    m = re.search(r"^#\s+(.+)$", md, re.M)
    title = m.group(1).strip() if m else os.path.splitext(os.path.basename(path))[0]
    return note_id, title, md
