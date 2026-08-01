from trusted_recall_score import score_model_replays, score_retrieval


def test_retrieval_score_passes_rank_provenance_and_latency_gates():
    rows = [
        {
            "expected_source": f"note-{index}",
            "ranked_sources": [f"note-{index}", "other"],
            "provenance": [True, True],
        }
        for index in range(20)
    ]
    result = score_retrieval(rows, [20 + index for index in range(20)])
    assert result["failed_gates"] == []
    assert result["metrics"]["hit_at_1"] == 1.0


def test_retrieval_score_reports_quality_and_latency_failures():
    rows = [{
        "expected_source": "right",
        "ranked_sources": ["wrong"],
        "provenance": [False],
    }]
    result = score_retrieval(rows, [900])
    assert "hit_at_1<0.8" in result["failed_gates"]
    assert "hit_at_3<0.95" in result["failed_gates"]
    assert "provenance_coverage<1.0" in result["failed_gates"]
    assert "p95_ms>500.0" in result["failed_gates"]


def test_retrieval_score_accepts_multiple_relevant_sources():
    result = score_retrieval([{
        "expected_sources": ["decision", "deep-dive"],
        "ranked_sources": ["decision", "other"],
        "provenance": [True, True],
    }], [20])
    assert result["metrics"]["hit_at_1"] == 1.0


def test_model_score_requires_complete_safe_after_answers_and_family_gain():
    rows = []
    for family in ("claude", "kimi"):
        rows.extend([
            {
                "family": family,
                "case_id": "milestone",
                "condition": "before",
                "required_complete": False,
                "forbidden_found": [],
            },
            {
                "family": family,
                "case_id": "milestone",
                "condition": "after",
                "required_complete": True,
                "forbidden_found": [],
            },
        ])
    result = score_model_replays(rows)
    assert result["failed_gates"] == []
    assert result["metrics"]["after_completion"] == 1.0
    assert result["metrics"]["improvements"] == {"claude": 1, "kimi": 1}
