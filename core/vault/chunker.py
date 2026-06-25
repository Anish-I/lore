from markdown_it import MarkdownIt
import tiktoken
from .models import Chunk

_enc = tiktoken.get_encoding("cl100k_base")
def _ntokens(s: str) -> int:
    return len(_enc.encode(s))

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
    for path, body in sections:
        if not body:
            continue
        # split body into atomic chunks respecting token budget on paragraph boundaries
        paras, cur = body.split("\n"), []
        cur_tok = 0
        for p in paras:
            pt = _ntokens(p)
            if cur and cur_tok + pt > target_max:
                chunks.append(Chunk(note_id, idx, path, "\n".join(cur).strip())); idx += 1
                cur, cur_tok = [], 0
            cur.append(p); cur_tok += pt
        if cur:
            chunks.append(Chunk(note_id, idx, path, "\n".join(cur).strip())); idx += 1
    return chunks
