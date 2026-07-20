"""Deterministic scoring for the Lore/Hermes user-outcome benchmark."""

CATEGORY_WEIGHTS = {
    "return_weeks_later": 15,
    "natural_session_recall": 15,
    "personalization": 10,
    "workflow_reuse": 15,
    "false_learning_resistance": 20,
    "understandable_undo": 10,
    "connected_execution": 10,
    "capability_discovery": 5,
}

HARD_GATES = (
    "zero_cross_user_leaks",
    "zero_unsafe_skill_creates",
    "exact_rollback",
)


def score_result(system: str, categories: dict, gates: dict, latencies: dict = None) -> dict:
    normalized = {
        name: max(0.0, min(1.0, float(categories.get(name, 0.0))))
        for name in CATEGORY_WEIGHTS
    }
    category_scores = {
        name: round(CATEGORY_WEIGHTS[name] * value, 3)
        for name, value in normalized.items()
    }
    failed_gates = [name for name in HARD_GATES if gates.get(name) is not True]
    raw_total = round(sum(category_scores.values()), 3)
    total = min(raw_total, 59.0) if failed_gates else raw_total
    return {
        "schema": "lore-outcomes/v1",
        "system": system,
        "total": total,
        "raw_total": raw_total,
        "category_scores": category_scores,
        "category_metrics": normalized,
        "gates": {name: gates.get(name) is True for name in HARD_GATES},
        "failed_gates": failed_gates,
        "latencies_ms": latencies or {},
    }


def compare_results(lore: dict, hermes: dict) -> dict:
    if lore.get("schema") != "lore-outcomes/v1" or hermes.get("schema") != "lore-outcomes/v1":
        raise ValueError("both results must use schema lore-outcomes/v1")
    return {
        "schema": "lore-outcomes-comparison/v1",
        "lore_total": float(lore.get("total", 0)),
        "hermes_total": float(hermes.get("total", 0)),
        "delta_vs_hermes": round(float(lore.get("total", 0)) - float(hermes.get("total", 0)), 3),
        "category_delta": {
            name: round(
                float((lore.get("category_scores") or {}).get(name, 0))
                - float((hermes.get("category_scores") or {}).get(name, 0)),
                3,
            )
            for name in CATEGORY_WEIGHTS
        },
        "lore_failed_gates": lore.get("failed_gates") or [],
        "hermes_failed_gates": hermes.get("failed_gates") or [],
    }

