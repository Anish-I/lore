"""Run the four-category recall campaign against the LIVE Lore store.

Each valid run appends one row to eval/history/categories.jsonl and writes a
markdown report under eval/reports.  Runs fail closed when the backend is down,
no gold queries can be scored, or more than 30% of the gold targets are stale.

Usage:
  python eval/run_categories.py
  LORE_EVAL_ARM=dictionary python eval/run_categories.py --ask 2
  python eval/run_categories.py --compare
"""
import argparse
import datetime
import json
import os
import random
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


def _config_paths():
    """Desktop config candidates: Windows, XDG/Linux, then macOS."""
    appdata = os.environ.get("APPDATA")
    if appdata:
        for app_name in ("lore-desktop", "Lore"):
            yield os.path.join(appdata, app_name, "lore-config.json")
    for app_name in ("lore-desktop", "Lore"):
        yield os.path.expanduser(f"~/.config/{app_name}/lore-config.json")
    yield os.path.expanduser(
        "~/Library/Application Support/lore-desktop/lore-config.json")


def _desktop_config() -> dict:
    fallback = {}
    for path in _config_paths():
        try:
            with open(path, encoding="utf-8") as f:
                config = json.load(f) or {}
            if not fallback:
                fallback = config
            if config.get("localToken"):
                return config
        except Exception:
            continue
    return fallback


HERE = os.path.dirname(os.path.abspath(__file__))
GOLD = os.path.join(HERE, "gold", "gold-categories.json")
HISTORY = os.path.join(HERE, "history", "categories.jsonl")
REPORTS = os.path.join(HERE, "reports")
PORT = os.environ.get("LORE_PORT", "8099")
BASE = f"http://localhost:{PORT}"
TENANT = "local"
SCOPES = ["engineering"]
ARM = os.environ.get("LORE_EVAL_ARM", "baseline")
KINDS = ("dictionary", "vague", "complex", "mixed")
ASK_SEED = 7
TOKEN = os.environ.get("LORE_TOKEN") or os.environ.get("LORE_LOCAL_TOKEN") or \
    _desktop_config().get("localToken", "")


class EvalError(Exception):
    pass


def _request(method, path, payload=None, timeout=60):
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"X-Lore-Token": TOKEN}
    if data is not None:
        headers["content-type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            detail = ""
        suffix = f": {detail}" if detail else ""
        raise EvalError(f"{method} {path} returned HTTP {exc.code}{suffix}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise EvalError(f"backend unavailable during {method} {path}: {exc}") from exc
    except (json.JSONDecodeError, TypeError) as exc:
        raise EvalError(f"invalid JSON from {method} {path}: {exc}") from exc


def _post(path, payload, timeout=60):
    return _request("POST", path, payload, timeout)


def _store_note_ids():
    query = urllib.parse.urlencode({"tenant": TENANT, "scopes": ",".join(SCOPES)})
    graph = _request("GET", f"/graph?{query}", timeout=60)
    nodes = graph.get("nodes")
    if not isinstance(nodes, list):
        raise EvalError("GET /graph response is missing a nodes list")
    return {node.get("id") for node in nodes if isinstance(node, dict) and node.get("id")}


def _load_gold(path):
    if not os.path.exists(path):
        raise EvalError(f"gold set missing: {path}")
    try:
        with open(path, encoding="utf-8") as f:
            gold = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        raise EvalError(f"cannot read gold set {path}: {exc}") from exc

    if not isinstance(gold, dict):
        raise EvalError("gold set root must be a JSON object")
    if not isinstance(gold.get("generated_at"), str):
        raise EvalError("gold set generated_at must be a string")
    if gold.get("tenant") != TENANT or gold.get("scopes") != SCOPES:
        raise EvalError(f"gold set must use tenant={TENANT!r} and scopes={SCOPES!r}")
    queries = gold.get("queries")
    if not isinstance(queries, list):
        raise EvalError("gold set queries must be a list")
    for i, item in enumerate(queries):
        if not isinstance(item, dict):
            raise EvalError(f"gold query {i} must be an object")
        for key in ("q", "expect_note_id"):
            if not isinstance(item.get(key), str) or not item[key]:
                raise EvalError(f"gold query {i} has invalid {key}")
        if not isinstance(item.get("expect_title_sub"), str):
            raise EvalError(f"gold query {i} has invalid expect_title_sub")
        if item.get("kind") not in KINDS:
            raise EvalError(f"gold query {i} has invalid kind {item.get('kind')!r}")
    return queries


def _expected_rank(gold, hits):
    title_sub = gold["expect_title_sub"].lower()
    for rank, hit in enumerate(hits, 1):
        if not isinstance(hit, dict):
            continue
        if hit.get("note_id") == gold["expect_note_id"] or \
                (title_sub and title_sub in str(hit.get("title") or "").lower()):
            return rank
    return None


def _p95(values):
    ordered = sorted(values)
    index = max(0, (95 * len(ordered) + 99) // 100 - 1)
    return ordered[index]


def _metrics(records):
    n = len(records)
    if not n:
        return {"n": 0, "recall@1": None, "recall@5": None, "mrr@10": None,
                "p50_ms": None, "p95_ms": None}
    ranks = [record["rank"] for record in records]
    latencies = [record["latency_ms"] for record in records]
    return {
        "n": n,
        "recall@1": round(sum(rank == 1 for rank in ranks) / n, 3),
        "recall@5": round(sum(rank is not None and rank <= 5 for rank in ranks) / n, 3),
        "mrr@10": round(sum((1.0 / rank) if rank and rank <= 10 else 0.0
                            for rank in ranks) / n, 3),
        "p50_ms": round(statistics.median(latencies), 1),
        "p95_ms": round(_p95(latencies), 1),
    }


def _ask_samples(queries, per_kind):
    if not per_kind:
        return []
    rng = random.Random(ASK_SEED)
    samples = []
    for kind in KINDS:
        pool = [query for query in queries if query["kind"] == kind]
        for gold in rng.sample(pool, min(per_kind, len(pool))):
            response = _post("/ask", {
                "question": gold["q"], "tenant_id": TENANT,
                "principal_scopes": SCOPES, "provider": "claude",
            }, timeout=120)
            if not isinstance(response, dict):
                raise EvalError("POST /ask response must be a JSON object")
            samples.append({
                "question": gold["q"], "kind": kind,
                "answer": str(response.get("answer") or ""),
                "engine": str(response.get("engine") or ""),
            })
    return samples


def run_once(queries, ask_n):
    note_ids = _store_note_ids()
    records = []
    for gold in queries:
        started = time.perf_counter()
        response = _post("/search", {
            "query": gold["q"], "scopes": SCOPES,
            "tenant_id": TENANT, "limit": 10,
        })
        latency = (time.perf_counter() - started) * 1000
        hits = response.get("results") if isinstance(response, dict) else None
        if not isinstance(hits, list):
            raise EvalError("POST /search response is missing a results list")
        records.append({
            "kind": gold["kind"], "rank": _expected_rank(gold, hits),
            "latency_ms": latency, "stale": gold["expect_note_id"] not in note_ids,
        })

    stale = sum(record["stale"] for record in records)
    if records and stale * 10 > len(records) * 3:
        raise EvalError(
            f"STALE GOLD: {stale}/{len(records)} targets are absent from the store (>30%)")
    scored = [record for record in records if not record["stale"]]
    if not scored:
        raise EvalError("ZERO SCORED QUERIES: refusing to record a degenerate run")

    per_kind = {
        kind: _metrics([record for record in scored if record["kind"] == kind])
        for kind in KINDS
    }
    overall = _metrics(scored)
    overall.update({
        "gold_n": len(records), "stale_gold": stale,
        "stale_rate": round(stale / len(records), 3) if records else None,
    })
    live_queries = [query for query in queries if query["expect_note_id"] in note_ids]
    return {
        "ts": datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
        "arm": ARM,
        "per_kind": per_kind,
        "overall": overall,
        "ask_samples": _ask_samples(live_queries, ask_n),
    }


def _append_row(row):
    os.makedirs(os.path.dirname(HISTORY), exist_ok=True)
    with open(HISTORY, "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def _report_path(row):
    safe_arm = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in row["arm"])
    return os.path.join(REPORTS, f"categories-{safe_arm}-{row['ts']}.md")


def _write_report(row):
    os.makedirs(REPORTS, exist_ok=True)
    path = _report_path(row)
    lines = [
        "# Lore category recall campaign", "",
        f"- Timestamp: `{row['ts']}`", f"- Arm: `{row['arm']}`", "",
        "| Kind | n | Recall@1 | Recall@5 | MRR@10 | p50 ms | p95 ms |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for kind in (*KINDS, "overall"):
        metrics = row["overall"] if kind == "overall" else row["per_kind"][kind]
        values = [metrics[key] for key in
                  ("n", "recall@1", "recall@5", "mrr@10", "p50_ms", "p95_ms")]
        lines.append("| " + kind + " | " + " | ".join(
            "—" if value is None else str(value) for value in values) + " |")
    if row["ask_samples"]:
        lines.extend(["", "## Ask samples"])
        for sample in row["ask_samples"]:
            lines.extend([
                "", f"### {sample['kind']}: {sample['question']}", "",
                f"Engine: `{sample['engine'] or 'unknown'}`", "",
                sample["answer"] or "_(empty answer)_",
            ])
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return path


def _load_history():
    try:
        with open(HISTORY, encoding="utf-8") as f:
            return [json.loads(line) for line in f if line.strip()]
    except FileNotFoundError:
        return []
    except (OSError, json.JSONDecodeError) as exc:
        raise EvalError(f"cannot read history {HISTORY}: {exc}") from exc


def _fmt(value, metric):
    if value is None:
        return "—"
    if metric == "n":
        return str(int(value))
    return f"{value:.1f}" if metric.endswith("_ms") else f"{value:.3f}"


def compare():
    rows = _load_history()
    latest = {}
    for row in rows:
        if row.get("arm") in ("baseline", "dictionary"):
            latest[row["arm"]] = row
    missing = [arm for arm in ("baseline", "dictionary") if arm not in latest]
    if missing:
        raise EvalError(f"cannot compare: no history row for {', '.join(missing)} arm")

    print("| Kind | Metric | Baseline | Dictionary | Delta (dictionary - baseline) |")
    print("|---|---|---:|---:|---:|")
    for kind in (*KINDS, "overall"):
        for metric in ("n", "recall@1", "recall@5", "mrr@10", "p50_ms", "p95_ms"):
            def value(arm):
                bucket = latest[arm]["overall"] if kind == "overall" else \
                    latest[arm]["per_kind"].get(kind, {})
                return bucket.get(metric)
            baseline, dictionary = value("baseline"), value("dictionary")
            delta = None if baseline is None or dictionary is None else dictionary - baseline
            print(f"| {kind} | {metric} | {_fmt(baseline, metric)} | "
                  f"{_fmt(dictionary, metric)} | {_fmt(delta, metric)} |")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--gold", default=GOLD, help="category gold-set path")
    parser.add_argument("--ask", type=int, default=0, metavar="N",
                        help="sample N questions per kind for /ask grading")
    parser.add_argument("--compare", action="store_true",
                        help="compare the latest baseline and dictionary runs")
    args = parser.parse_args()

    try:
        if args.compare:
            compare()
            return 0
        if args.ask < 0:
            raise EvalError("--ask must be zero or greater")
        queries = _load_gold(args.gold)
        if not TOKEN:
            raise EvalError(
                "Lore token not found in LORE_TOKEN, LORE_LOCAL_TOKEN, or desktop config")
        row = run_once(queries, args.ask)
        report = _write_report(row)
        _append_row(row)
        print(f"recorded {row['arm']} run: n={row['overall']['n']} "
              f"recall@5={row['overall']['recall@5']} mrr@10={row['overall']['mrr@10']}")
        print(f"report: {report}")
        return 0
    except EvalError as exc:
        print(f"\n*** CATEGORY EVAL FAILED CLOSED: {exc} ***\n", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"\n*** CATEGORY EVAL FAILED CLOSED: output error: {exc} ***\n", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
