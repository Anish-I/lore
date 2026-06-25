import tiktoken
from .models import Chunk
_enc = tiktoken.get_encoding("cl100k_base")

def needs_context(chunk: Chunk) -> bool:
    # heuristic: short chunks or chunks with dangling pronouns need situating
    n = len(_enc.encode(chunk.text))
    has_pronoun_start = chunk.text.strip().lower().startswith(("it ", "they ", "this ", "the city", "risk:"))
    return n < 120 or has_pronoun_start

CONTEXT_PROMPT = (
    "<document title>{title}</document title>\n<section>{path}</section>\n"
    "<chunk>{chunk}</chunk>\nGive a 1-sentence context that situates this chunk "
    "(name the entity/section/time it refers to). Answer with only the sentence."
)

def build_context(note_title: str, chunk: Chunk, llm=None) -> str:
    if llm is None:
        # deterministic, no-network default: situate via metadata
        return f"From note '{note_title}', section '{chunk.heading_path}'."
    return llm(CONTEXT_PROMPT.format(title=note_title, path=chunk.heading_path, chunk=chunk.text)).strip()

def apply_context(chunks, note_title, llm=None):
    for c in chunks:
        if needs_context(c):
            c.context = build_context(note_title, c, llm=llm)
            c.has_context = True
    return chunks
