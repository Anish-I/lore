"""LoCoMo retrieval benchmark — a published, comparable recall number.

LoCoMo (snap-research/locomo, 10 long multi-session conversations, ~1986 QA
pairs each annotated with the gold *evidence* dialogue turn/s). This harness
measures the thing Lore's wedge actually claims: **retrieval recall@k of the
gold evidence turn.** Each dialogue turn is ingested as one note; for every
question we ask Lore's live retrieval and check whether a gold evidence turn
lands in the top-k. No LLM judge — it's a clean, deterministic recall metric.

  python eval/bench_locomo.py --conversations 2          # ingest + score a subset
  python eval/bench_locomo.py --conversations 10         # the full published set
  python eval/bench_locomo.py --cleanup                  # purge the bench tenant

Isolated tenant `bench`, scope `bench` — never touches your real vault.
Honest by construction: it prints exactly how many conversations / questions
were scored, so a subset run can't be mistaken for the full number.

Env: LORE_PORT / LORE_LOCAL_TOKEN (falls back to the desktop config), as in
run_nightly.py.
"""
import argparse
import functools
import json
import os
import statistics
import sys
import time
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
print = functools.partial(print, flush=True)

PORT = os.environ.get("LORE_PORT", "8099")
BASE = f"http://localhost:{PORT}"
TENANT = os.environ.get("LORE_BENCH_TENANT", "bench")
SCOPE = os.environ.get("LORE_BENCH_SCOPE", "bench")
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data", "locomo10.json")
HISTORY = os.path.join(HERE, "history", "locomo.jsonl")
SRC_URL = "https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json"


def _token():
    tok = os.environ.get("LORE_LOCAL_TOKEN") or os.environ.get("LORE_TOKEN")
    if tok:
        return tok
    ad = os.environ.get("APPDATA") or os.path.expanduser("~/.config")
    for a in ("lore-desktop", "Lore"):
        try:
            with open(os.path.join(ad, a, "lore-config.json"), encoding="utf-8") as f:
                t = (json.load(f) or {}).get("localToken")
                if t:
                    return t
        except Exception:
            pass
    return ""


H = {"content-type": "application/json"}
_tok = _token()
if _tok:
    H["X-Lore-Token"] = _tok


def call(method, path, payload=None, timeout=120):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=H)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or "null"), (time.perf_counter() - t0) * 1000
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200], (time.perf_counter() - t0) * 1000
    except Exception as e:
        return 0, str(e)[:200], (time.perf_counter() - t0) * 1000


def load_dataset():
    if not os.path.exists(DATA):
        os.makedirs(os.path.dirname(DATA), exist_ok=True)
        print(f"downloading LoCoMo -> {DATA}")
        raw = urllib.request.urlopen(SRC_URL, timeout=60).read()
        with open(DATA, "wb") as f:
            f.write(raw)
    with open(DATA, encoding="utf-8") as f:
        return json.load(f)


def note_id(sample_id, dia_id):
    return f"locomo:{sample_id}:{dia_id}"


def ingest_conversation(conv):
    """Ingest every dialogue turn of one conversation as a note. Returns count."""
    sample_id = conv["sample_id"]
    c = conv["conversation"]
    n = 0
    for key in sorted(k for k in c if k.startswith("session_") and not k.endswith("date_time")):
        when = c.get(f"{key}_date_time", "")
        for turn in c[key]:
            dia = turn.get("dia_id")
            if not dia:
                continue
            speaker = turn.get("speaker", "")
            text = turn.get("text", "")
            if not text.strip():
                continue
            body = f"# {speaker} — {when} ({dia})\n\n{speaker}: {text}"
            st, _, _ = call("POST", "/ingest", {
                "source_id": note_id(sample_id, dia),
                "title": f"{speaker} · {when} · {dia}",
                "text": body, "scope": SCOPE, "owner": "locomo", "tenant": TENANT,
                "source_type": "locomo"})
            if st == 200:
                n += 1
    return n


def score_conversation(conv, k, max_q):
    sample_id = conv["sample_id"]
    r1 = r5 = r10 = mrr = 0
    lat = []
    scored = 0
    for qa in conv["qa"]:
        ev = qa.get("evidence") or []
        if not ev:
            continue                       # unanswerable/adversarial — no gold turn
        # Some evidence entries pack multiple dia_ids into one semicolon-joined
        # string (e.g. "D8:6; D9:17") instead of separate list items — split
        # them, else the compound string never matches a real ingested note_id.
        gold_dia_ids = []
        for e in ev:
            if isinstance(e, str):
                gold_dia_ids.extend(part.strip() for part in e.split(";") if part.strip())
        gold = {note_id(sample_id, d) for d in gold_dia_ids}
        if not gold:
            continue
        st, b, ms = call("POST", "/search", {
            "query": qa["question"], "scopes": [SCOPE], "tenant_id": TENANT, "k": max(k, 10)})
        if st != 200 or not isinstance(b, dict):
            continue
        scored += 1
        lat.append(ms)
        ranked = [h.get("note_id") for h in b.get("results", [])]
        hit_rank = next((i for i, nid in enumerate(ranked) if nid in gold), None)
        if hit_rank is not None:
            if hit_rank == 0:
                r1 += 1
            if hit_rank < 5:
                r5 += 1
            if hit_rank < 10:
                r10 += 1
            mrr += 1.0 / (hit_rank + 1)
        if max_q and scored >= max_q:
            break
    return {"sample_id": sample_id, "scored": scored,
            "r1": r1, "r5": r5, "r10": r10, "mrr": mrr, "lat": lat}


def run(n_conv, k, max_q):
    ds = load_dataset()
    convs = ds[:n_conv]
    print(f"== LoCoMo retrieval benchmark ==")
    print(f"   conversations: {len(convs)}/{len(ds)} · tenant={TENANT} · k={k}")

    print("-- ingest --")
    total_notes = 0
    for i, conv in enumerate(convs):
        c = ingest_conversation(conv)
        total_notes += c
        print(f"   [{i+1}/{len(convs)}] {conv['sample_id']}: {c} turns")
    print(f"   ingested {total_notes} dialogue-turn notes")

    print("-- score (retrieval recall of gold evidence turn) --")
    agg = {"scored": 0, "r1": 0, "r5": 0, "r10": 0, "mrr": 0.0, "lat": []}
    for i, conv in enumerate(convs):
        res = score_conversation(conv, k, max_q)
        for key in ("scored", "r1", "r5", "r10", "mrr"):
            agg[key] += res[key]
        agg["lat"] += res["lat"]
        s = res["scored"] or 1
        print(f"   [{i+1}/{len(convs)}] {res['sample_id']}: "
              f"n={res['scored']} r@1={res['r1']/s:.3f} r@5={res['r5']/s:.3f} r@10={res['r10']/s:.3f}")

    n = agg["scored"] or 1
    p50 = statistics.median(agg["lat"]) if agg["lat"] else 0
    p95 = sorted(agg["lat"])[int(len(agg["lat"]) * 0.95) - 1] if len(agg["lat"]) > 1 else p50
    summary = {
        "benchmark": "LoCoMo-retrieval",
        "conversations": len(convs), "questions_scored": agg["scored"],
        "recall@1": round(agg["r1"] / n, 4),
        "recall@5": round(agg["r5"] / n, 4),
        "recall@10": round(agg["r10"] / n, 4),
        "mrr": round(agg["mrr"] / n, 4),
        "p50_ms": round(p50), "p95_ms": round(p95),
        "notes_ingested": total_notes,
        "metric": "retrieval recall@k of gold evidence turn (not end-to-end QA F1)",
    }
    print("\n== RESULT ==")
    print(f"   recall@1  {summary['recall@1']:.3f}")
    print(f"   recall@5  {summary['recall@5']:.3f}")
    print(f"   recall@10 {summary['recall@10']:.3f}")
    print(f"   MRR       {summary['mrr']:.3f}")
    print(f"   latency   p50 {summary['p50_ms']}ms · p95 {summary['p95_ms']}ms")
    print(f"   scored on {agg['scored']} questions across {len(convs)} conversation(s)")
    if len(convs) < len(ds):
        print(f"   NOTE: subset run ({len(convs)}/{len(ds)} conversations) — not the full published set.")
    os.makedirs(os.path.dirname(HISTORY), exist_ok=True)
    with open(HISTORY, "a", encoding="utf-8") as f:
        f.write(json.dumps(summary) + "\n")
    print(f"   appended -> {HISTORY}")
    return summary


def cleanup():
    print(f"== cleanup: purge tenant={TENANT} ==")
    st, b, _ = call("DELETE", f"/capture?source_type=locomo&tenant={TENANT}")
    print(f"   delete locomo: {st} {b}")
    st, b, _ = call("GET", f"/stats?tenant={TENANT}")
    print(f"   stats after: {b}")


def main():
    import urllib.error  # noqa: F401 (used in call())
    ap = argparse.ArgumentParser()
    ap.add_argument("--conversations", type=int, default=2)
    ap.add_argument("--k", type=int, default=10)
    ap.add_argument("--max-questions", type=int, default=0, help="cap per conversation (0 = all)")
    ap.add_argument("--cleanup", action="store_true")
    args = ap.parse_args()
    if args.cleanup:
        cleanup()
        return
    run(args.conversations, args.k, args.max_questions)


if __name__ == "__main__":
    import urllib.error
    main()
