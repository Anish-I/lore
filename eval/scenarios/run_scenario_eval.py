"""Scenario eval harness (2026-07-20 ceiling/clustering execution).

Indexes a generated scenario vault (see gen_scenario.py) into an ISOLATED
SQLite + embedded-Qdrant store and measures, per query bucket:

  recall@1 / recall@5 / MRR
  candidates_contain_gold@40   (first-stage headroom, union of hybrid top-40)
  rerank_input_contains_gold@20 (the system's true upper bound — G1 boundary)
  p50/p95 end-to-end /retrieve latency

across an ablation matrix of the two Tier-1 fills:

  ctx0/ctx1  — G2 contextual enrichment for ALL chunks (index-time; 2 indexes)
  qp0/qp1    — G3 BGE query-side instruction prefix (query-time)

plus the clustering loop on the fragmented topic_variant tags:

  pairwise precision/recall/F1 vs topic_gold, fragmentation index,
  then propose_topic_merges() → apply alias mapping → same metrics after,
  and merge-proposal precision (false-merge rate vs gold) — Sol's ≤5% gate.

Real local models (BGE-small dense, Qdrant/bm25 sparse, ms-marco L6 rerank).
Module gates are flipped as module attributes (same pattern as the unit
tests) — env vars are read at import time and this is a single process.

Usage:
  python eval/scenarios/run_scenario_eval.py --data eval/scenarios/data/insurance.json
      [--limit-notes N] [--limit-queries-per-bucket N] [--workdir DIR] [--out PATH]
      [--skip-clustering] [--variants ctx0-qp0,ctx0-qp1,ctx1-qp0,ctx1-qp1]
"""
import argparse
import json
import os
import statistics
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCRATCH_DEFAULT = REPO / "eval" / "scenarios" / ".work"

# --- Environment BEFORE lore imports (qdrant client + settings bind at import) ---
def _early_env(workdir: Path):
    os.environ.setdefault("FASTEMBED_CACHE_PATH", str(workdir / "models"))
    os.environ["QDRANT_PATH"] = str(workdir / "qdrant")
    # DATABASE_URL unused (we call db._connect_url directly) but set defensively
    # so nothing accidentally dials the desktop Postgres.
    os.environ["DATABASE_URL"] = f"sqlite://{(workdir / 'scenario.db').as_posix()}"


TENANT = "scn"
SCOPE = "eng"
OWNER = "eval"


def p95(xs):
    return sorted(xs)[max(0, int(len(xs) * 0.95) - 1)] if xs else None


def index_scenario(notes, conn, embedder, sparse, context_all, collection,
                   fresh_store=False):
    """Index all notes into `collection` with G2 on/off. Returns elapsed s.

    fresh_store=True skips qdrant_store.delete_note during the bulk load:
    on embedded Qdrant that delete is an UNINDEXED payload scan per note, so
    bulk indexing degrades quadratically — measured on the insurance run:
    18 → 8 → 6 notes/s at 500/1000/1500 notes. On a brand-new collection
    there is nothing to delete; skipping is exact. (This measured curve is
    itself G12 evidence for the live vault, where every re-index pays it.)
    """
    from lore import contextualize, index, qdrant_store
    contextualize._CONTEXT_ALL = context_all
    qdrant_store.COLLECTION = collection
    real_delete = qdrant_store.delete_note
    if fresh_store:
        qdrant_store.delete_note = lambda note_id: None
    t0 = time.perf_counter()
    try:
        for i, n in enumerate(notes):
            index.index_document(
                source_id=n["id"], title=n["title"], text=n["body"],
                scope_id=SCOPE, owner_id=OWNER, tenant_id=TENANT,
                embedder=embedder, conn=conn, sparse_embedder=sparse,
                path=None, source_type=n.get("source_type") or "note",
            )
            if (i + 1) % 500 == 0:
                rate = (i + 1) / (time.perf_counter() - t0)
                print(f"    indexed {i + 1}/{len(notes)} ({rate:.0f} notes/s)", flush=True)
    finally:
        qdrant_store.delete_note = real_delete
    return time.perf_counter() - t0


def seed_topic_tags(conn, notes):
    """note_tags from the generator's fragmented topic_variant (simulates the
    real classifier's output). Idempotent."""
    for n in notes:
        conn.execute(
            "insert into note_tags(note_id, tenant_id, tag, kind, source) "
            "values(%s,%s,%s,'topic','llm') on conflict do nothing",
            (n["id"], TENANT, n["topic_variant"]))


def note_signals_for(conn):
    """Mini note-signals provider mirroring api._note_signals_provider: real
    ages from created_at + superseded edges (relations.extract_relations may
    have created them from 'Supersedes <title>' lines at index time). Without
    this, retrieve() runs with zero temporal machinery and the temporal bucket
    measures nothing but tie-breaking luck."""
    import datetime as _dt

    from lore.sqlutil import in_clause

    now = _dt.datetime.now(_dt.timezone.utc)

    def provider(note_ids):
        ids = [n for n in set(note_ids) if n]
        if not ids:
            return {}
        frag, params = in_clause("id", ids)
        rows = conn.execute(
            f"select id, created_at, memory_type from notes where tenant_id=%s and {frag}",
            (TENANT, *params)).fetchall()
        frag2, params2 = in_clause("dst_note_id", ids)
        superseded = {r[0] for r in conn.execute(
            f"select distinct dst_note_id from edges where tenant_id=%s "
            f"and kind='supersedes' and {frag2}",
            (TENANT, *params2)).fetchall()}
        out = {}
        for nid, created_at, memory_type in rows:
            age = None
            if created_at is not None:
                dt = created_at if getattr(created_at, "tzinfo", None) else \
                    created_at.replace(tzinfo=_dt.timezone.utc)
                age = max(0.0, (now - dt).total_seconds() / 86400.0)
            out[nid] = {"importance": 0.0, "age_days": age,
                        "memory_type": memory_type or "durable",
                        "superseded": nid in superseded,
                        "entity_hit": False, "feedback_net": 0}
        return out

    return provider


def eval_retrieval(queries, embedder, sparse, reranker, qp_on, collection,
                   note_signals=None):
    """Bucketed retrieval metrics + boundary metrics for one variant."""
    from lore import qdrant_store, recall
    recall._BGE_QUERY_PREFIX = qp_on
    qdrant_store.COLLECTION = collection

    buckets = {}
    latencies = []
    noans_scores, ans_scores = [], []
    for q in queries:
        expect = set(q.get("expect_note_ids") or [])
        # Boundary probe: same lanes retrieve() uses, visible candidate set.
        eq = recall.expand_query(q["q"])
        qvec = embedder.embed([recall.dense_query_text(eq)])[0]
        svec = sparse.embed_sparse([eq])[0]
        cands = qdrant_store.search_hybrid(qvec, svec, [SCOPE], TENANT, limit=40)
        cand_notes = [c["note_id"] for c in cands]
        in40 = bool(expect & set(cand_notes))
        in20 = bool(expect & set(cand_notes[:20]))

        t0 = time.perf_counter()
        hits = recall.retrieve(q["q"], embedder, reranker, [SCOPE], TENANT,
                               limit=8, sparse_embedder=sparse,
                               note_signals=note_signals)
        latencies.append((time.perf_counter() - t0) * 1000)

        # Separation signal for the no-answer bucket must be the RAW fused
        # score: the blended hit score is minmax-normalized per query, so its
        # top-1 is ~1.0 by construction and separates nothing.
        top_score = cands[0]["score"] if cands else 0.0
        if q["bucket"] == "noanswer":
            noans_scores.append(top_score)
            b = buckets.setdefault("noanswer", {"n": 0})
            b["n"] += 1
            continue
        ans_scores.append(top_score)

        rank = None
        seen_notes = []
        for h in hits:
            if h.note_id not in seen_notes:
                seen_notes.append(h.note_id)
        for i, nid in enumerate(seen_notes, 1):
            if nid in expect:
                rank = i
                break
        b = buckets.setdefault(q["bucket"], {
            "n": 0, "r1": 0, "r5": 0, "mrr": 0.0, "in40": 0, "in20": 0})
        b["n"] += 1
        b["in40"] += int(in40)
        b["in20"] += int(in20)
        if rank == 1:
            b["r1"] += 1
        if rank is not None and rank <= 5:
            b["r5"] += 1
        b["mrr"] += (1.0 / rank) if rank else 0.0

    out = {}
    for k, b in buckets.items():
        if k == "noanswer":
            out[k] = {"n": b["n"]}
            continue
        n = b["n"] or 1
        out[k] = {
            "n": b["n"],
            "recall@1": round(b["r1"] / n, 3),
            "recall@5": round(b["r5"] / n, 3),
            "mrr": round(b["mrr"] / n, 3),
            "candidates_contain_gold@40": round(b["in40"] / n, 3),
            "rerank_input_contains_gold@20": round(b["in20"] / n, 3),
        }
    scored = [b for k, b in buckets.items() if k != "noanswer"]
    tot_n = sum(b["n"] for b in scored) or 1
    out["_overall"] = {
        "n": tot_n,
        "recall@5": round(sum(b["r5"] for b in scored) / tot_n, 3),
        "recall@1": round(sum(b["r1"] for b in scored) / tot_n, 3),
        "mrr": round(sum(b["mrr"] for b in scored) / tot_n, 3),
        "rerank_input_contains_gold@20": round(sum(b["in20"] for b in scored) / tot_n, 3),
        "candidates_contain_gold@40": round(sum(b["in40"] for b in scored) / tot_n, 3),
        "p50_ms": round(statistics.median(latencies), 1) if latencies else None,
        "p95_ms": round(p95(latencies), 1) if latencies else None,
        # G10 precursor: score separation between answerable and no-answer tops.
        "top1_score_answerable_mean": round(statistics.mean(ans_scores), 4) if ans_scores else None,
        "top1_score_noanswer_mean": round(statistics.mean(noans_scores), 4) if noans_scores else None,
    }
    return out


def _pairwise_f1(assignment_a: dict, assignment_b: dict):
    """Pair-counting P/R/F1 of clustering A (predicted) against B (gold).
    assignment: {note_id: label}. O(n) via label group sizes."""
    from collections import Counter

    def pair_count(groups):
        return sum(c * (c - 1) // 2 for c in groups.values())

    notes = sorted(set(assignment_a) & set(assignment_b))
    ga = Counter(assignment_a[n] for n in notes)
    gb = Counter(assignment_b[n] for n in notes)
    gab = Counter((assignment_a[n], assignment_b[n]) for n in notes)
    tp = pair_count(gab)                    # same cluster in both
    pred_pairs = pair_count(ga)
    gold_pairs = pair_count(gb)
    prec = tp / pred_pairs if pred_pairs else 1.0
    rec = tp / gold_pairs if gold_pairs else 1.0
    f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
    return round(prec, 3), round(rec, 3), round(f1, 3)


def eval_clustering(conn, notes, embedder):
    """Fragmentation before/after topic merges, with merge precision vs gold."""
    from lore import topic_merge

    gold = {n["id"]: n["topic_gold"] for n in notes}
    variant = {n["id"]: n["topic_variant"] for n in notes}
    gold_topics = len(set(gold.values()))
    var_topics = len(set(variant.values()))
    p0, r0, f0 = _pairwise_f1(variant, gold)

    t0 = time.perf_counter()
    proposals = topic_merge.propose_topic_merges(conn, TENANT, embedder=embedder)
    merge_s = time.perf_counter() - t0

    # Merge precision vs gold: a proposal is CORRECT iff both topic names map to
    # the same gold topic (majority gold label of their member notes).
    def majority_gold(topic_name):
        from collections import Counter
        ids = [nid for nid, t in variant.items() if t == topic_name]
        c = Counter(gold[nid] for nid in ids)
        return c.most_common(1)[0][0] if c else None

    correct = sum(1 for p in proposals
                  if majority_gold(p["keep"]) == majority_gold(p["merge"]))
    false_merges = len(proposals) - correct

    # Apply accepted merges (all of them — synthetic run) as alias mapping with
    # union-find so chains (A<-B, B<-C) collapse to one canonical name.
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for p in proposals:
        ra, rb = find(p["keep"]), find(p["merge"])
        if ra != rb:
            parent[rb] = ra
    merged = {nid: find(t) for nid, t in variant.items()}
    p1, r1_, f1 = _pairwise_f1(merged, gold)

    return {
        "gold_topics": gold_topics,
        "variant_topics": var_topics,
        "fragmentation_index": round(var_topics / gold_topics, 2),
        "before": {"pairwise_precision": p0, "pairwise_recall": r0, "pairwise_f1": f0},
        "merge_proposals": len(proposals),
        "false_merges": false_merges,
        "merge_precision": round(correct / len(proposals), 3) if proposals else None,
        "after": {"pairwise_precision": p1, "pairwise_recall": r1_, "pairwise_f1": f1,
                  "topics": len(set(merged.values()))},
        "merge_seconds": round(merge_s, 1),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--workdir", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--limit-notes", type=int, default=0)
    ap.add_argument("--limit-queries-per-bucket", type=int, default=0)
    ap.add_argument("--variants", default="ctx0-qp0,ctx0-qp1,ctx1-qp0,ctx1-qp1")
    ap.add_argument("--skip-clustering", action="store_true")
    args = ap.parse_args()

    data = json.loads(Path(args.data).read_text(encoding="utf-8"))
    scenario = data["scenario"]
    workdir = Path(args.workdir) if args.workdir else SCRATCH_DEFAULT / scenario
    workdir.mkdir(parents=True, exist_ok=True)
    _early_env(workdir)

    sys.path.insert(0, str(REPO / "core"))
    from lore import db
    from lore.embed import LocalEmbedder, LocalSparseEmbedder
    from lore.rerank import LocalReranker

    notes = data["notes"][: args.limit_notes or None]
    queries = data["queries"]
    if args.limit_queries_per_bucket:
        by_bucket = {}
        for q in queries:
            by_bucket.setdefault(q["bucket"], []).append(q)
        queries = [q for qs in by_bucket.values()
                   for q in qs[: args.limit_queries_per_bucket]]
    kept_ids = {n["id"] for n in notes}
    queries = [q for q in queries
               if not q.get("expect_note_ids")
               or set(q["expect_note_ids"]) & kept_ids]

    print(f"scenario={scenario} notes={len(notes)} queries={len(queries)} workdir={workdir}")
    print("loading local models (BGE-small dense, bm25 sparse, L6 reranker)...", flush=True)
    embedder, sparse, reranker = LocalEmbedder(), LocalSparseEmbedder(), LocalReranker()

    variants = [v.strip() for v in args.variants.split(",") if v.strip()]
    ctx_needed = sorted({v.split("-")[0] for v in variants})

    conns, index_secs = {}, {}
    for ctx in ctx_needed:
        collection = f"scn_{scenario}_{ctx}"
        dbfile = workdir / f"{ctx}.db"
        conn = db._connect_url(f"sqlite://{dbfile.as_posix()}")
        db.bootstrap_schema(conn)
        already = conn.execute(
            "select count(*) from notes where tenant_id=%s", (TENANT,)).fetchone()[0]
        if already >= len(notes):
            print(f"  [{ctx}] reusing existing index ({already} notes)")
            index_secs[ctx] = 0.0
        elif already > 0:
            # Partial store (e.g. a killed run): fresh-store fast path would
            # duplicate the already-indexed notes. Refuse — wipe the workdir.
            print(f"  [{ctx}] ERROR: partial store ({already}/{len(notes)} notes). "
                  f"Delete the workdir and rerun.", flush=True)
            raise SystemExit(2)
        else:
            print(f"  [{ctx}] indexing {len(notes)} notes (context_all={ctx == 'ctx1'})...",
                  flush=True)
            index_secs[ctx] = index_scenario(
                notes, conn, embedder, sparse, ctx == "ctx1", collection,
                fresh_store=True)
            print(f"  [{ctx}] indexed in {index_secs[ctx]:.0f}s")
        seed_topic_tags(conn, notes)
        conns[ctx] = (conn, collection)

    results = {"scenario": scenario, "notes": len(notes), "queries": len(queries),
               "index_seconds": index_secs, "variants": {}}
    for v in variants:
        ctx, qp = v.split("-")
        conn, collection = conns[ctx]
        print(f"  [eval {v}] running {len(queries)} queries...", flush=True)
        t0 = time.perf_counter()
        results["variants"][v] = eval_retrieval(
            queries, embedder, sparse, reranker, qp == "qp1", collection,
            note_signals=note_signals_for(conn))
        print(f"  [eval {v}] done in {time.perf_counter() - t0:.0f}s "
              f"overall r@5={results['variants'][v]['_overall']['recall@5']}")

    if not args.skip_clustering:
        ctx0 = conns.get("ctx0") or next(iter(conns.values()))
        print("  [clustering] fragmentation → merge recovery...", flush=True)
        results["clustering"] = eval_clustering(ctx0[0], notes, embedder)

    out_path = Path(args.out) if args.out else (
        REPO / "eval" / "history" / f"scenario-{scenario}-{time.strftime('%Y-%m-%d')}.json")
    out_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"wrote {out_path}")

    # --- console summary ---
    for v, r in results["variants"].items():
        o = r["_overall"]
        print(f"{v}: r@1 {o['recall@1']}  r@5 {o['recall@5']}  mrr {o['mrr']}  "
              f"in20 {o['rerank_input_contains_gold@20']}  in40 {o['candidates_contain_gold@40']}  "
              f"p50 {o['p50_ms']}ms")
    if "clustering" in results:
        c = results["clustering"]
        print(f"clustering: {c['variant_topics']} variant topics over {c['gold_topics']} gold "
              f"(frag x{c['fragmentation_index']}) | F1 {c['before']['pairwise_f1']} -> "
              f"{c['after']['pairwise_f1']} via {c['merge_proposals']} merges "
              f"({c['false_merges']} false, precision {c['merge_precision']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
