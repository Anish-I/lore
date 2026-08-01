"""Run Lore outcome probes or score a compatible external-system artifact."""

import argparse
import json
import shutil
import statistics
import subprocess
import sys
import time
from pathlib import Path

from outcome_score import compare_results, score_result


ROOT = Path(__file__).resolve().parents[1]
NPM = shutil.which("npm") or shutil.which("npm.cmd") or "npm"

LORE_PROBES = {
    "return_weeks_later": [
        sys.executable, "-m", "pytest", "-q",
        "core/tests/test_index_recall_e2e.py", "core/tests/test_recall_signals.py",
    ],
    "natural_session_recall": [
        sys.executable, "-m", "pytest", "-q", "core/tests/test_session_recall.py",
    ],
    "personalization": [
        sys.executable, "-m", "pytest", "-q", "core/tests/test_personal_memory.py",
    ],
    "workflow_reuse": [
        sys.executable, "-m", "pytest", "-q", "core/tests/test_learn_cross_session_e2e.py",
    ],
    "false_learning_resistance": [
        sys.executable, "-m", "pytest", "-q",
        "core/tests/test_learn_evidence.py", "core/tests/test_learn_review.py",
    ],
    "understandable_undo": [
        sys.executable, "-m", "pytest", "-q",
        "core/tests/test_personal_memory.py", "core/tests/test_learn_skills.py",
    ],
    "connected_execution": [
        NPM, "test", "--", "--run", "tests/capture-hygiene.test.js",
    ],
    "capability_discovery": [
        NPM, "test", "--", "--run", "tests/suggest.test.js",
    ],
}


def _run_probe(category: str, command: list[str]) -> tuple[float, float, str]:
    cwd = ROOT / "desktop" if Path(command[0]).stem.lower() == "npm" else ROOT
    started = time.perf_counter()
    completed = subprocess.run(
        command, cwd=cwd, text=True, capture_output=True, check=False,
    )
    duration_ms = (time.perf_counter() - started) * 1000
    output = (completed.stdout + "\n" + completed.stderr).strip()
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    if completed.returncode:
        summary = output[-1200:]
    else:
        summary = next(
            (line for line in reversed(lines) if " passed" in line or line.startswith("Test Files")),
            lines[-1] if lines else "passed",
        )
    return (1.0 if completed.returncode == 0 else 0.0), duration_ms, summary


def run_lore() -> dict:
    categories = {}
    durations = []
    probes = {}
    for category, command in LORE_PROBES.items():
        value, duration_ms, summary = _run_probe(category, command)
        categories[category] = value
        durations.append(duration_ms)
        probes[category] = {
            "passed": value == 1.0,
            "duration_ms": round(duration_ms, 1),
            "summary": summary,
        }
    gates = {
        "zero_cross_user_leaks": categories["personalization"] == 1.0,
        "zero_unsafe_skill_creates": categories["false_learning_resistance"] == 1.0,
        "exact_rollback": categories["understandable_undo"] == 1.0,
    }
    ordered = sorted(durations)
    p95_index = max(0, min(len(ordered) - 1, int(len(ordered) * 0.95) - 1))
    result = score_result("lore", categories, gates, {
        "probe_p50": round(statistics.median(durations), 1),
        "probe_p95": round(ordered[p95_index], 1),
    })
    result["measurement"] = "contract-regression"
    result["probes"] = probes
    return result


def load_result(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema") == "lore-outcomes/v1" and "total" in data:
        return data
    return score_result(
        data.get("system") or path.stem,
        data.get("categories") or {},
        data.get("gates") or {},
        data.get("latencies_ms") or {},
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--system", choices=("lore", "external"), default="lore")
    parser.add_argument("--metrics", type=Path)
    parser.add_argument("--compare", type=Path, help="Compatible saved result, e.g. a Hermes run")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.system == "external" and not args.metrics:
        parser.error("--metrics is required for an external system")
    result = run_lore() if args.system == "lore" else load_result(args.metrics)
    payload = {"result": result}
    if args.compare:
        other = load_result(args.compare)
        lore, hermes = (result, other) if result.get("system") == "lore" else (other, result)
        payload["comparison"] = compare_results(lore, hermes)
    rendered = json.dumps(payload, indent=2, sort_keys=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0 if result.get("failed_gates") == [] else 2


if __name__ == "__main__":
    raise SystemExit(main())
