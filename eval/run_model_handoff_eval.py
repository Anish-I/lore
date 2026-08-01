"""Replay sanitized Trusted Recall asks through replaceable model CLIs."""

import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from trusted_recall_score import score_model_replays


def _command(family, prompt):
    executable = shutil.which(family)
    if not executable:
        raise RuntimeError(f"{family} CLI is not installed")
    if family == "claude":
        return [
            executable,
            "-p",
            prompt,
            "--output-format",
            "text",
            "--tools",
            "",
            "--disable-slash-commands",
            "--no-session-persistence",
            "--setting-sources",
            "",
        ]
    if family == "kimi":
        return [executable, "--prompt", prompt, "--output-format", "text"]
    if family == "codex":
        return [
            executable,
            "exec",
            "--skip-git-repo-check",
            "--ephemeral",
            "--sandbox",
            "read-only",
            "--color",
            "never",
            "-",
        ]
    raise RuntimeError(f"unsupported model family: {family}")


def _run(family, prompt, cwd, timeout):
    completed = subprocess.run(
        _command(family, prompt),
        cwd=cwd,
        input=prompt if family == "codex" else None,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    output = (completed.stdout or "").strip()
    if completed.returncode:
        detail = (completed.stderr or output or "model command failed").strip()[-500:]
        raise RuntimeError(f"{family} exited {completed.returncode}: {detail}")
    return output


def _probe_prompt(case, context=None):
    parts = [
        "Answer only from supplied project context. If context does not establish the answer, say UNKNOWN.",
        "Use the exact project terminology and include supporting FACT identifiers exactly as written.",
    ]
    if context:
        parts.extend([
            "<lore-memory-context>",
            context,
            "</lore-memory-context>",
        ])
    parts.append(case["prompt"])
    return "\n\n".join(parts)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument(
        "--family", action="append", choices=("claude", "codex", "kimi"), required=True,
    )
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    payload = json.loads(args.cases.read_text(encoding="utf-8"))
    context = payload["context"]
    forbidden = [phrase.lower() for phrase in payload.get("forbidden_phrases") or []]
    rows = []
    family_errors = {}

    with tempfile.TemporaryDirectory(prefix="lore-handoff-") as temp_dir:
        for family in args.family:
            family_rows = []
            try:
                for case in payload.get("cases") or []:
                    required = [phrase.lower() for phrase in case.get("required_phrases") or []]
                    for condition in ("before", "after"):
                        prompt = _probe_prompt(case, context if condition == "after" else None)
                        output = _run(family, prompt, temp_dir, args.timeout)
                        normalized = " ".join(output.lower().split())
                        missing = [phrase for phrase in required if phrase not in normalized]
                        forbidden_found = [phrase for phrase in forbidden if phrase in normalized]
                        family_rows.append({
                            "family": family,
                            "case_id": case["id"],
                            "condition": condition,
                            "required_complete": not missing,
                            "missing_required": missing,
                            "forbidden_found": forbidden_found,
                            "response_sha256": hashlib.sha256(output.encode()).hexdigest(),
                        })
            except (RuntimeError, subprocess.TimeoutExpired) as exc:
                family_errors[family] = str(exc)[-500:]
                continue
            rows.extend(family_rows)

    scored = score_model_replays(rows)
    completed_families = scored["metrics"]["families"]
    failed_gates = list(scored["failed_gates"])
    if len(completed_families) < 2:
        failed_gates.append("fewer_than_two_model_families")
    result = {
        "schema": "lore-trusted-recall-model-handoff/v1",
        "measurement": "sanitized-before-after-model-replay",
        "metrics": scored["metrics"],
        "failed_gates": failed_gates,
        "unavailable_families": family_errors,
        "runs": rows,
        "privacy": {
            "raw_personal_notes_sent": False,
            "model_responses_persisted": False,
            "hidden_reasoning_requested": False,
        },
    }
    rendered = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0 if not result["failed_gates"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
