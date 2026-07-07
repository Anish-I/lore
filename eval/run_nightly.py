"""Nightly recall self-test over the LIVE store (M1-D).

Reports the triple buyers compare on — accuracy + tokens + latency — together:
  recall@1 / recall@5 / MRR, split by query kind (exact vs paraphrase — the
  exact-ID lane is a separate subsystem and must not mask semantic regressions),
  p50/p95 /search latency, tokens per top-5 context pack, and session-echo rate.

Each run appends one JSON row to eval/history/nightly.jsonl.
  --history   print a trend table of the last 14 runs (the M1 dashboard)
  --gate      exit 1 if overall recall@5 drops >10pp below the 7-run median
              (use as a PR gate for ranking changes)

A down backend records a {"backend": "down"} row and exits 0 — gaps in the
trend stay visible instead of silently missing.

Schedule (dev box):
  schtasks /Create /SC DAILY /ST 03:00 /TN "LoreNightlyEval" ^
    /TR "python C:\\Users\\ivatu\\vault-kos\\eval\\run_nightly.py"

Env: LORE_PORT/LORE_TENANT/LORE_SCOPES/LORE_TOKEN as in gen_gold.py.
"""
import argparse
import datetime
import json
import os
import statistics
import sys
import time
import urllib.request

PORT = os.environ.get("LORE_PORT", "8099")
BASE = f"http://localhost:{PORT}"
TENANT = os.environ.get("LORE_TENANT", "local")
SCOPES = [s for s in os.environ.get("LORE_SCOPES", "engineering").split(",") if s]

HERE = os.path.dirname(os.path.abspath(__file__))
HISTORY = os.environ.get("LORE_EVAL_HISTORY", os.path.join(HERE, "history", "nightly.jsonl"))


def _token() -> str:
    tok = os.environ.get("LORE_TOKEN") or os.environ.get("LORE_LOCAL_TOKEN")
    if tok:
        return tok
    appdata = os.environ.get("APPDATA") or os.path.expanduser("~/.config")
    for app_name in ("lore-desktop", "Lore"):
        try:
            with open(os.path.join(appdata, app_name, "lore-config.json"), encoding="utf-8") as f:
                t = (json.load(f) or {}).get("localToken")
                if t:
                    return t
        except Exception:
            continue
    return ""


TOKEN = _token()


def _post(path, payload):
    req = urllib.request.Request(
        BASE + path, data=json.dumps(payload).encode(),
        headers={"content-type": "application/json", **({"X-Lore-Token": TOKEN} if TOKEN else {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def _tokens_of(texts) -> int:
    joined = "\n".join(t or "" for t in texts)
    try:
        import tiktoken
        return len(tiktoken.get_encoding("cl100k_base").encode(joined))
    except Exception:
        return int(len(joined.split()) * 1.3)


def is_session_echo(h) -> bool:
    """Raw captured-prompt chunk from a session note (the store-pollution class);
    mirrors run_recall_eval.py."""
    title = str(h.get("title") or h.get("note_id") or "")
    section = str(h.get("heading_path") or "")
    return ("Session" in title) and ("Prompt [" in section or "Prompt [" in str(h.get("text", "")[:60]))


def run_once(gold_path):
    with open(gold_path, encoding="utf-8") as f:
        gold = json.load(f)
    queries = gold.get("queries", [])
    per_kind = {}
    latencies = []
    token_counts = []
    echo_slots = 0
    total_slots = 0
    stale = 0

    for g in queries:
        t0 = time.perf_counter()
        try:
            res = _post("/search", {"query": g["q"], "scopes": SCOPES, "k": 5, "tenant_id": TENANT})
        except Exception:
            stale += 1
            continue
        latencies.append((time.perf_counter() - t0) * 1000)
        hits = res.get("results", [])
        token_counts.append(_tokens_of([h.get("text") for h in hits]))
        for h in hits:
            total_slots += 1
            if is_session_echo(h):
                echo_slots += 1

        # Rank of the expected note (by id, falling back to title substring).
        rank = None
        sub = (g.get("expect_title_sub") or "").lower()
        for i, h in enumerate(hits, 1):
            if h.get("note_id") == g["expect_note_id"] or (sub and sub in str(h.get("title") or "").lower()):
                rank = i
                break
        if rank is None and not hits:
            stale += 1
            continue
        k = g.get("kind", "paraphrase")
        b = per_kind.setdefault(k, {"n": 0, "r1": 0, "r5": 0, "mrr": 0.0})
        b["n"] += 1
        if rank == 1:
            b["r1"] += 1
        if rank is not None and rank <= 5:
            b["r5"] += 1
        b["mrr"] += (1.0 / rank) if rank else 0.0

    kinds = {}
    tot_n = tot_r5 = 0
    for k, b in per_kind.items():
        kinds[k] = {
            "n": b["n"],
            "recall@1": round(b["r1"] / b["n"], 3) if b["n"] else None,
            "recall@5": round(b["r5"] / b["n"], 3) if b["n"] else None,
            "mrr": round(b["mrr"] / b["n"], 3) if b["n"] else None,
        }
        tot_n += b["n"]
        tot_r5 += b["r5"]
    row = {
        "ts": datetime.datetime.now().isoformat(timespec="seconds"),
        "tenant": TENANT,
        "queries": len(queries),
        "scored": tot_n,
        "stale_gold": stale,
        "kinds": kinds,
        "recall@5": round(tot_r5 / tot_n, 3) if tot_n else None,
        "p50_ms": round(statistics.median(latencies), 1) if latencies else None,
        "p95_ms": round(sorted(latencies)[max(0, int(len(latencies) * 0.95) - 1)], 1) if latencies else None,
        "tokens_top5_avg": int(statistics.mean(token_counts)) if token_counts else None,
        "session_echo": round(echo_slots / total_slots, 3) if total_slots else None,
    }
    return row


def append_row(row):
    os.makedirs(os.path.dirname(HISTORY), exist_ok=True)
    with open(HISTORY, "a", encoding="utf-8") as f:
        f.write(json.dumps(row) + "\n")


def load_history():
    try:
        with open(HISTORY, encoding="utf-8") as f:
            return [json.loads(ln) for ln in f if ln.strip()]
    except FileNotFoundError:
        return []


def print_row(row):
    if row.get("backend") == "down":
        print(f"{row['ts']}  BACKEND DOWN")
        return
    kinds = row.get("kinds", {})

    def fmt(k):
        b = kinds.get(k)
        return f"{k}: r@1 {b['recall@1']} r@5 {b['recall@5']} mrr {b['mrr']} (n={b['n']})" if b else f"{k}: —"
    print(f"{row['ts']}  r@5 {row.get('recall@5')}  |  {fmt('exact')}  |  {fmt('paraphrase')}")
    print(f"  p50 {row.get('p50_ms')}ms  p95 {row.get('p95_ms')}ms  tokens(top5) {row.get('tokens_top5_avg')}"
          f"  echo {row.get('session_echo')}  stale_gold {row.get('stale_gold')}")
    if row.get("queries") and row.get("stale_gold", 0) > 0.2 * row["queries"]:
        print("  WARNING: >20% of gold targets missing from the store — regenerate gold (eval/gen_gold.py)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gold", default=os.path.join(HERE, "gold", f"gold-{TENANT}.json"))
    ap.add_argument("--history", action="store_true", help="print the last-14-runs trend table")
    ap.add_argument("--gate", action="store_true",
                    help="exit 1 if recall@5 drops >10pp below the 7-run median")
    args = ap.parse_args()

    if args.history:
        rows = load_history()[-14:]
        if not rows:
            print("no history yet — run without --history first")
            return 0
        for r in rows:
            print_row(r)
        return 0

    # Backend up?
    try:
        urllib.request.urlopen(f"{BASE}/presets", timeout=5)
    except Exception:
        row = {"ts": datetime.datetime.now().isoformat(timespec="seconds"), "backend": "down"}
        append_row(row)
        print_row(row)
        return 0

    if not os.path.exists(args.gold):
        print(f"gold set missing: {args.gold} — run eval/gen_gold.py first", file=sys.stderr)
        return 1

    row = run_once(args.gold)
    append_row(row)
    print_row(row)

    if args.gate:
        prior = [r.get("recall@5") for r in load_history()[:-1] if r.get("recall@5") is not None][-7:]
        if prior and row.get("recall@5") is not None:
            med = statistics.median(prior)
            if row["recall@5"] < med - 0.10:
                print(f"GATE FAIL: recall@5 {row['recall@5']} < median {med:.3f} - 0.10", file=sys.stderr)
                return 1
            print(f"gate ok: recall@5 {row['recall@5']} vs 7-run median {med:.3f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
