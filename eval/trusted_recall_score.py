"""Scoring helpers for the Trusted Recall evidence lanes."""

import math
import statistics


RETRIEVAL_THRESHOLDS = {
    "hit_at_1": 0.80,
    "hit_at_3": 0.95,
    "mrr": 0.85,
    "provenance_coverage": 1.0,
    "p95_ms": 500.0,
}


def _percentile(values, percentile):
    if not values:
        return 0.0
    ordered = sorted(float(value) for value in values)
    index = max(0, math.ceil(percentile * len(ordered)) - 1)
    return ordered[index]


def score_retrieval(rows, latencies_ms):
    ranks = []
    provenance = []
    for row in rows:
        ranked = row.get("ranked_sources") or []
        expected = set(row.get("expected_sources") or [row.get("expected_source")])
        rank = next((index + 1 for index, source in enumerate(ranked) if source in expected), 0)
        ranks.append(rank)
        provenance.extend(bool(value) for value in (row.get("provenance") or []))
    count = len(rows)
    metrics = {
        "cases": count,
        "hit_at_1": sum(rank == 1 for rank in ranks) / count if count else 0.0,
        "hit_at_3": sum(0 < rank <= 3 for rank in ranks) / count if count else 0.0,
        "hit_at_5": sum(0 < rank <= 5 for rank in ranks) / count if count else 0.0,
        "mrr": sum(1.0 / rank for rank in ranks if rank) / count if count else 0.0,
        "provenance_coverage": (
            sum(provenance) / len(provenance) if provenance else 0.0
        ),
        "p50_ms": statistics.median(latencies_ms) if latencies_ms else 0.0,
        "p95_ms": _percentile(latencies_ms, 0.95),
    }
    failures = []
    for name, threshold in RETRIEVAL_THRESHOLDS.items():
        value = metrics[name]
        if name == "p95_ms":
            if value > threshold:
                failures.append(f"{name}>{threshold}")
        elif value < threshold:
            failures.append(f"{name}<{threshold}")
    return {"metrics": metrics, "failed_gates": failures}


def score_model_replays(rows):
    families = sorted({row["family"] for row in rows})
    after_rows = [row for row in rows if row["condition"] == "after"]
    before_rows = [row for row in rows if row["condition"] == "before"]
    failures = []
    for row in after_rows:
        if not row.get("required_complete"):
            failures.append(f"after_incomplete:{row['family']}:{row['case_id']}")
        if row.get("forbidden_found"):
            failures.append(f"unsupported:{row['family']}:{row['case_id']}")
    improvements = {}
    for family in families:
        before = {
            row["case_id"]: bool(row.get("required_complete"))
            for row in before_rows if row["family"] == family
        }
        after = {
            row["case_id"]: bool(row.get("required_complete"))
            for row in after_rows if row["family"] == family
        }
        improved = sum(not before.get(case_id, False) and passed for case_id, passed in after.items())
        improvements[family] = improved
        if improved < 1:
            failures.append(f"no_before_after_gain:{family}")
    total_after = len(after_rows)
    return {
        "metrics": {
            "families": families,
            "cases_per_condition": len(after_rows),
            "after_completion": (
                sum(bool(row.get("required_complete")) for row in after_rows) / total_after
                if total_after else 0.0
            ),
            "before_completion": (
                sum(bool(row.get("required_complete")) for row in before_rows) / len(before_rows)
                if before_rows else 0.0
            ),
            "unsupported_after": sum(bool(row.get("forbidden_found")) for row in after_rows),
            "improvements": improvements,
        },
        "failed_gates": failures,
    }
