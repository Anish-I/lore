from lore.models import Chunk
from lore.contextualize import needs_context, apply_context

def test_short_chunk_needs_context():
    c = Chunk("n1", 0, "Acme Account > Renewal", "Risk: champion left.")
    assert needs_context(c) is True

def test_selfcontained_chunk_skips_context():
    big = "Acme Corporation renewal for fiscal Q3 2026. " * 12
    c = Chunk("n1", 0, "Acme Account > Renewal", big)
    assert needs_context(c) is False

def test_apply_context_prepends_metadata_blurb_without_llm():
    c = Chunk("n1", 0, "Acme Account > Renewal", "Risk: champion left.")
    out = apply_context([c], "Acme Account", llm=None)[0]
    assert out.context != "" and "Acme Account" in out.context
    assert out.has_context_text().startswith(out.context)
