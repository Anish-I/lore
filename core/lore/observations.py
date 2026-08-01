"""Structured observations (#4, 2026-07-21 file-anchored recall spec).

One typed work-record per captured session: what kind of work it was, what it
established, and — the deterministic spine — WHICH FILES it read and modified,
taken straight from the transcript's tool_use blocks (paths only; arguments and
file contents are never stored). Type/summary/facts/concepts may be enriched by
the configured LLM under learn.py's provider gate with STRICT JSON output; when
no provider is available a deterministic fallback still yields a useful record.

ADD-only: observations are never rewritten; deletion follows the owning
session note's lifecycle (same tenant scoping as everything else).
"""
from __future__ import annotations

import json
import re
import uuid
from typing import Any

from . import learn

# Tool names → file-activity buckets. Grep/Glob 'path' inputs are often
# directories; they still anchor "worked near these files" and are kept.
READ_TOOLS = {"Read", "Glob", "Grep", "NotebookRead"}
WRITE_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}

TYPES = ("bugfix", "discovery", "decision", "refactor", "workaround", "config")

_MAX_FILES = 40          # per bucket per observation (paths, newest-unique first)
_MAX_FACTS = 8
_MAX_CONCEPTS = 8
_MAX_SUMMARY = 300


def norm_path(p: str) -> str:
    """Casefolded, forward-slashed path for matching."""
    return str(p or "").replace("\\", "/").strip().casefold()


def path_key(p: str) -> str:
    """Last two path segments ('lore/recall.py') — the indexed lookup key.
    Absolute hook paths and repo-relative transcript paths meet at this key."""
    segs = [s for s in norm_path(p).split("/") if s]
    return "/".join(segs[-2:]) if segs else ""


def collect_file_activity(transcript: dict[str, Any]) -> tuple[list[str], list[str]]:
    """(files_read, files_modified) from tool_use events — deterministic,
    first-seen order, deduplicated by normalized path, writes win over reads."""
    read: dict[str, str] = {}
    modified: dict[str, str] = {}
    for event in transcript.get("events") or []:
        for tu in event.get("tool_uses") or []:
            fp = tu.get("file_path")
            if not fp:
                continue
            key = norm_path(fp)
            name = tu.get("name") or ""
            if name in WRITE_TOOLS:
                modified.setdefault(key, fp)
            elif name in READ_TOOLS:
                read.setdefault(key, fp)
    for key in modified:
        read.pop(key, None)   # a modified file is implicitly read; report once
    return (list(read.values())[:_MAX_FILES], list(modified.values())[:_MAX_FILES])


def deterministic_observation(evidence: dict[str, Any],
                              files_modified: list[str],
                              first_user_text: str) -> dict[str, Any]:
    """Provider-free fallback: type from evidence signals, summary from the
    session's first ask. Never invents facts."""
    outcome = str(evidence.get("outcome") or "unverified")
    saw_failure = any(code != 0 for code in evidence.get("tool_exit_codes") or []) or \
        any(r.get("kind") == "tool-failure" for r in evidence.get("refs") or [])
    if files_modified and outcome == "verified-success" and saw_failure:
        obs_type = "bugfix"
    elif files_modified and outcome == "verified-success":
        obs_type = "refactor"
    elif files_modified:
        obs_type = "workaround" if saw_failure else "config"
    else:
        obs_type = "discovery"
    summary = " ".join((first_user_text or "").split())[:_MAX_SUMMARY] or "(no user prompt captured)"
    return {"type": obs_type, "summary": summary, "facts": [], "concepts": []}


def build_prompt(evidence: dict[str, Any], files_read: list[str],
                 files_modified: list[str], raw_tail: str) -> str:
    refs = (evidence.get("refs") or [])[:12]
    ref_lines = "\n".join(f"- [{r.get('kind')}] {str(r.get('text') or '')[:200]}" for r in refs)
    return (
        "You summarize ONE coding session as a structured observation.\n"
        f"Files modified: {', '.join(files_modified[:12]) or '(none)'}\n"
        f"Files read: {', '.join(files_read[:12]) or '(none)'}\n"
        f"Outcome: {evidence.get('outcome')}\n"
        f"Evidence:\n{ref_lines}\n"
        f"Transcript tail:\n{raw_tail[-6000:]}\n\n"
        "Reply with STRICT JSON only, no prose, no fences:\n"
        '{"type":"bugfix|discovery|decision|refactor|workaround|config",'
        '"summary":"1-2 sentences, concrete","facts":["atomic claim",...],'
        '"concepts":["tag",...]}\n'
        "facts: at most 8, only claims supported by the evidence above. "
        "concepts: at most 8 short tags."
    )


def parse_observation_json(raw: str) -> dict[str, Any] | None:
    """Strict-JSON parse with hard validation; None on any deviation
    (caller falls back deterministically — the anti-fragile-parser rule)."""
    m = re.search(r"\{.*\}", raw or "", re.DOTALL)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    obs_type = str(data.get("type") or "").strip().lower()
    if obs_type not in TYPES:
        return None
    summary = " ".join(str(data.get("summary") or "").split())[:_MAX_SUMMARY]
    if not summary:
        return None

    def str_list(value: Any, cap: int) -> list[str]:
        if not isinstance(value, list):
            return []
        out = []
        for item in value:
            if isinstance(item, str) and item.strip():
                out.append(" ".join(item.split())[:200])
            if len(out) >= cap:
                break
        return out

    return {"type": obs_type, "summary": summary,
            "facts": str_list(data.get("facts"), _MAX_FACTS),
            "concepts": str_list(data.get("concepts"), _MAX_CONCEPTS)}


def extract_and_store(conn, *, tenant: str, session_id: str,
                      transcript_path: str, origin_note_id: str | None = None,
                      llm_call=None) -> dict[str, Any]:
    """Load transcript → deterministic file activity + evidence → one
    observation row (+ file join rows). llm_call is injectable for tests;
    when None the learn.py provider gate decides, and provider-unavailable
    degrades to the deterministic fallback."""
    transcript = learn.load_transcript(transcript_path)
    evidence = learn.extract_evidence(transcript)
    files_read, files_modified = collect_file_activity(transcript)

    first_user = ""
    for event in transcript.get("events") or []:
        if event.get("role") == "user" and event.get("text"):
            first_user = str(event["text"])
            break

    if llm_call is None:
        cfg = learn.config()
        if cfg["enabled"]:
            from .llm_providers import provider_available, resolve_llm_call
            if provider_available(cfg["provider"]):
                try:
                    llm_call = resolve_llm_call(cfg["provider"])
                except Exception:
                    llm_call = None

    obs = None
    if llm_call is not None:
        try:
            obs = parse_observation_json(
                llm_call(build_prompt(evidence, files_read, files_modified,
                                      str(transcript.get("raw") or ""))))
        except Exception:
            obs = None   # model failure is never fatal
    if obs is None:
        obs = deterministic_observation(evidence, files_modified, first_user)

    obs_id = f"obs:{uuid.uuid4().hex[:20]}"
    outcome = str(evidence.get("outcome") or "unverified")
    conn.execute(
        """insert into observations(id, tenant_id, session_id, type, summary,
                                    facts, concepts, files_read, files_modified,
                                    origin_note_id, outcome)
           values(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (obs_id, tenant, session_id, obs["type"], obs["summary"],
         json.dumps(obs["facts"]), json.dumps(obs["concepts"]),
         json.dumps(files_read), json.dumps(files_modified),
         origin_note_id, outcome))
    seen_keys = set()
    for fp in files_modified + files_read:
        key = path_key(fp)
        if not key or key in seen_keys:
            continue
        seen_keys.add(key)
        conn.execute(
            "insert into observation_files(observation_id, tenant_id, path_key, path_norm)"
            " values(%s,%s,%s,%s)",
            (obs_id, tenant, key, norm_path(fp)))
    return {"id": obs_id, "type": obs["type"], "summary": obs["summary"],
            "outcome": outcome, "files_read": len(files_read),
            "files_modified": len(files_modified),
            "facts": obs["facts"], "concepts": obs["concepts"]}


def for_file(conn, *, tenant: str, file_path: str, limit: int = 5) -> list[dict]:
    """Newest-first observations touching the file (path_key exact match —
    absolute hook paths and relative stored paths meet at the last-2-segment
    key)."""
    key = path_key(file_path)
    if not key:
        return []
    rows = conn.execute(
        """select o.id, o.session_id, o.ts, o.type, o.summary, o.outcome,
                  o.files_modified
             from observations o
             join observation_files f on f.observation_id = o.id
                  and f.tenant_id = o.tenant_id
            where o.tenant_id=%s and f.path_key=%s
            order by o.ts desc limit %s""",
        (tenant, key, max(1, min(int(limit), 20)))).fetchall()
    out = []
    for oid, session_id, ts, obs_type, summary, outcome, files_modified in rows:
        try:
            fm = json.loads(files_modified) if files_modified else []
        except Exception:
            fm = []
        out.append({"id": oid, "session_id": session_id,
                    "ts": ts.isoformat() if hasattr(ts, "isoformat") else str(ts),
                    "type": obs_type, "summary": summary, "outcome": outcome,
                    "files_modified": fm})
    return out


def for_session(conn, *, tenant: str, session_id: str, limit: int = 20) -> list[dict]:
    rows = conn.execute(
        """select id, session_id, ts, type, summary, outcome, files_modified
             from observations where tenant_id=%s and session_id=%s
            order by ts desc limit %s""",
        (tenant, session_id, max(1, min(int(limit), 100)))).fetchall()
    out = []
    for oid, sid, ts, obs_type, summary, outcome, files_modified in rows:
        try:
            fm = json.loads(files_modified) if files_modified else []
        except Exception:
            fm = []
        out.append({"id": oid, "session_id": sid,
                    "ts": ts.isoformat() if hasattr(ts, "isoformat") else str(ts),
                    "type": obs_type, "summary": summary, "outcome": outcome,
                    "files_modified": fm})
    return out
