#!/usr/bin/env python3
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib import error, request


PAIR_COUNT = 12
TENANT = "stateval"


def _config():
    appdata = os.environ.get("APPDATA")
    if not appdata:
        return {}
    path = Path(appdata) / "lore-desktop" / "lore-config.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _token(config):
    return (
        os.environ.get("LORE_TOKEN")
        or os.environ.get("LORE_LOCAL_TOKEN")
        or config.get("localToken")
        or config.get("token")
    )


def _base_url():
    port = os.environ.get("LORE_PORT", "8099")
    return f"http://127.0.0.1:{port}"


def _headers(config):
    headers = {"Content-Type": "application/json"}
    token = _token(config)
    if token:
        headers["X-Lore-Token"] = token
    return headers


def _json(base, headers, method, path, payload=None, timeout=5):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    req = request.Request(base + path, data=body, headers=headers, method=method)
    with request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    if not raw:
        return None
    return json.loads(raw.decode("utf-8"))


def _try_backend(base, headers):
    for path in ("/stats", "/"):
        try:
            _json(base, headers, "GET", path, timeout=2)
            return True
        except error.HTTPError:
            return True   # any HTTP status means the server answered
        except Exception:
            continue
    return False


def _fact_pair(i):
    """One fact-stated → fact-updated pair.

    Titles carry NO values (values appear only in bodies) so rank detection by
    value string is unambiguous — the new note's supersedes-wikilink embeds the
    old TITLE, and a value-bearing title would make the new note look stale.
    """
    key = f"stateval_fact_{i:02d}"
    stale = f"stale_value_{i:02d}"
    current = f"current_value_{i:02d}"
    old_title = f"fact {key}"
    new_title = f"fact {key} revision"
    old_text = (
        "---\n"
        "created: 2025-01-01T00:00:00Z\n"
        "---\n"
        f"# {old_title}\n\n"
        f"Fact record: the configured value for {key} is {stale} as decided originally.\n"
    )
    new_text = (
        "---\n"
        "created: 2025-01-02T00:00:00Z\n"
        "---\n"
        f"# {new_title}\n\n"
        f"Fact record: the configured value for {key} is {current} as decided originally.\n"
        f"This supersedes [[{old_title}]].\n"
    )
    return {
        "key": key,
        "stale": stale,
        "current": current,
        "old_title": old_title,
        "new_title": new_title,
        "old_text": old_text,
        "new_text": new_text,
        "question": f"What is the configured value for {key}?",
    }


def _ingest(base, headers, source_id, text, title):
    payload = {
        "source_id": source_id,
        "tenant": TENANT,
        "scope": "state-eval",
        "owner": "stateval",
        "title": title,
        "text": text,
    }
    return _json(base, headers, "POST", "/ingest", payload, timeout=10)


def _search(base, headers, query):
    payload = {
        "query": query,
        "scopes": ["state-eval"],
        "tenant_id": TENANT,
        "k": 5,
    }
    return _json(base, headers, "POST", "/search", payload, timeout=10)


def _as_results(payload):
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    for key in ("results", "chunks", "items", "matches"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
    return []


def _haystack(result):
    if not isinstance(result, dict):
        return str(result)
    payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}
    parts = []
    for source in (result, payload):
        for key in ("title", "text", "content", "body", "source_path", "note_id", "id"):
            value = source.get(key)
            if value is not None:
                parts.append(str(value))
    return "\n".join(parts)


def _rank_metrics(pair, results):
    # Detect by VALUE strings only — titles are ambiguous (the revision note's
    # supersedes-wikilink embeds the old note's title).
    ranks = {}
    for idx, result in enumerate(results[:5], start=1):
        text = _haystack(result)
        if pair["current"] in text:
            ranks.setdefault("current", idx)
        if pair["stale"] in text and pair["current"] not in text:
            ranks.setdefault("stale", idx)
    current_rank = ranks.get("current")
    stale_rank = ranks.get("stale")
    return {
        "current@1": 1.0 if current_rank == 1 else 0.0,
        "current@5": 1.0 if current_rank and current_rank <= 5 else 0.0,
        "stale_above_current": 1.0
        if stale_rank and (not current_rank or stale_rank < current_rank)
        else 0.0,
    }


def _append_history(row):
    path = Path(__file__).resolve().parent / "history" / "nightly.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, sort_keys=True) + "\n")


def _print_table(row):
    keys = ("pairs", "current@1", "current@5", "stale_above_current", "state_score")
    widths = {key: max(len(key), 8) for key in keys}
    print("State correctness eval")
    print(" ".join(key.rjust(widths[key]) for key in keys))
    print(" ".join("-" * widths[key] for key in keys))
    print(
        " ".join(
            (
                str(row[key])
                if isinstance(row[key], int)
                else f"{row[key]:.3f}"
            ).rjust(widths[key])
            for key in keys
        )
    )


def main():
    config = _config()
    base = _base_url()
    headers = _headers(config)
    if not _try_backend(base, headers):
        print(f"Lore backend unavailable at {base}; skipping state eval.")
        return 0

    pairs = [_fact_pair(i) for i in range(PAIR_COUNT)]
    try:
        for i, pair in enumerate(pairs):
            # Old note FIRST so its title resolves the revision's wikilink — the
            # cue lexicon then emits the supersedes edge at ingest. Ranking picks
            # it up live: /search's note-signals provider reads edges per query.
            _ingest(base, headers, f"stateval-{i:02d}-old", pair["old_text"], pair["old_title"])
            time.sleep(0.05)
            _ingest(base, headers, f"stateval-{i:02d}-new", pair["new_text"], pair["new_title"])
    except (OSError, TimeoutError, error.URLError) as exc:
        print(f"Lore backend became unavailable during ingest: {exc}; skipping state eval.")
        return 0

    metrics = []
    try:
        for pair in pairs:
            results = _as_results(_search(base, headers, pair["question"]))
            metrics.append(_rank_metrics(pair, results))
    except (OSError, TimeoutError, error.URLError) as exc:
        print(f"Lore backend became unavailable during search: {exc}; skipping state eval.")
        return 0

    current_at_1 = sum(m["current@1"] for m in metrics) / len(metrics)
    current_at_5 = sum(m["current@5"] for m in metrics) / len(metrics)
    stale_above = sum(m["stale_above_current"] for m in metrics) / len(metrics)
    row = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "kind": "state",
        "pairs": PAIR_COUNT,
        "current@1": current_at_1,
        "current@5": current_at_5,
        "stale_above_current": stale_above,
        "state_score": current_at_5 - stale_above,
    }
    _append_history(row)
    _print_table(row)
    return 0


if __name__ == "__main__":
    sys.exit(main())
