import os

import tiktoken
from .models import Chunk
_enc = tiktoken.get_encoding("cl100k_base")

# G2 (2026-07-20 ceiling-gaps doc): enrich EVERY chunk, not just short/pronoun
# ones. The two-stage payload split (embed enriched text, rerank raw text) is
# already in place, so full enrichment lifts dense recall without the near-dup
# blur that made enriched-text reranking crater r@1. Env-gated for ablation;
# default OFF until the bucketed gate passes. Requires re-index to take effect.
_CONTEXT_ALL = os.environ.get("LORE_CONTEXT_ALL", "0") == "1"


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
        if _CONTEXT_ALL or needs_context(c):
            c.context = build_context(note_title, c, llm=llm)
            c.has_context = True
    return chunks
