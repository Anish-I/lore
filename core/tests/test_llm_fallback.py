from lore.llm import extractive_answer
from lore.recall import extract_identifier


def test_extractive_fallback_uses_clean_evidence_bullets():
    chunks = [{
        "title": "DevOps > 14:20",
        "text": (
            "From note 'DevOps', section 'DevOps > 14:20'.\n\n"
            "**User:** Asked about Kalshi deployment.\n"
            "**Action:** Checked logs and planned a safer release path."
        ),
    }]
    answer = extractive_answer("Across DevOps and Kalshi, what are the concerns?", chunks)
    assert "Based on your library" not in answer
    assert "From note" not in answer
    assert "User: Asked about Kalshi deployment" in answer
    assert answer.startswith("- ")


def test_section_scoped_quotes_are_not_exact_artifacts():
    # The quoted-terms lane became the identifier lane (recall.extract_identifier):
    # prose quotes must not be treated as exact-match artifacts, real ID tokens are.
    q = 'Within the "DevOps" section, summarize what is actually in this section.'
    assert extract_identifier(q) is None
    assert extract_identifier("What does CLM-77741 cover?") == "CLM-77741"
