from vault.chunker import chunk_markdown
MD = """# Acme Account

## Renewal
Acme's contract renews in Q3. Risk: champion left the company.

## Pricing
List price is $120k; discount approved to $96k.
"""
def test_chunks_carry_heading_path():
    chunks = chunk_markdown("n1", MD)
    assert any(c.heading_path == "Acme Account > Renewal" for c in chunks)
    assert any("champion left" in c.text for c in chunks)

def test_no_chunk_exceeds_token_max():
    chunks = chunk_markdown("n1", MD, target_max=350)
    from vault.chunker import _ntokens
    assert all(_ntokens(c.text) <= 350 for c in chunks)
