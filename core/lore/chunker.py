import re

from markdown_it import MarkdownIt
import tiktoken
from .models import Chunk

_enc = tiktoken.get_encoding("cl100k_base")
def _ntokens(s: str) -> int:
    return len(_enc.encode(s))


# Frontmatter/metadata-only fragments ("tags: type/index status/auto", bare tag
# lists) chunk into near-identical low-content points that can win recall slots
# over real prose. A chunk must have some meaningful text once metadata syntax
# is stripped, or it isn't worth indexing.
_META_LINE = re.compile(
    r"^\s*(tags?|topics?|status|type|domain|created|date|aliases)\s*:.*$"
    r"|^\s*-\s*[\"']?\[\[[^\]]*\]\][\"']?\s*$"    # frontmatter wikilink list items
    r"|^\s*-?\s*[a-z0-9_-]+/[a-z0-9_/-]+\s*$",     # bare tag tokens like type/index
    re.IGNORECASE,
)


def _meaningful_text(s: str) -> str:
    kept = [ln for ln in s.splitlines() if ln.strip() and not _META_LINE.match(ln)]
    return " ".join(" ".join(kept).split())


def _is_low_content(s: str) -> bool:
    return len(_meaningful_text(s)) < 25


def chunk_markdown(note_id, md, target_min=150, target_max=350):
    mdit = MarkdownIt()
    tokens = mdit.parse(md)
    sections = []                # (heading_path, body_text)
    heading_stack = []           # (level, text)
    buf = []
    def flush():
        if buf:
            path = " > ".join(t for _, t in heading_stack)
            sections.append((path, "\n".join(buf).strip()))
            buf.clear()
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t.type == "heading_open":
            flush()
            level = int(t.tag[1])
            text = tokens[i+1].content
            while heading_stack and heading_stack[-1][0] >= level:
                heading_stack.pop()
            heading_stack.append((level, text))
            i += 3; continue
        if t.type == "inline" and t.content:
            buf.append(t.content)
        i += 1
    flush()

    chunks, idx = [], 0

    def emit(path, text):
        nonlocal idx
        if _is_low_content(text):
            return
        chunks.append(Chunk(note_id, idx, path, text))
        idx += 1

    for path, body in sections:
        if not body:
            continue
        # split body into atomic chunks respecting token budget on paragraph boundaries
        paras, cur = body.split("\n"), []
        cur_tok = 0
        for p in paras:
            pt = _ntokens(p)
            if cur and cur_tok + pt > target_max:
                emit(path, "\n".join(cur).strip())
                cur, cur_tok = [], 0
            cur.append(p); cur_tok += pt
        if cur:
            emit(path, "\n".join(cur).strip())
    return chunks
