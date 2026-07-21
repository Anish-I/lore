"""Cold-start onboarding simulation (2026-07-21).

A real user's ENTIRE mailbox (beck-s, duplicates and all, no folder info)
dumped flat into a FRESH Lore. Measures what day one actually looks like:

  1. Ingest hygiene: zero-chunk notes, chunks/note, duplicate clusters,
     throughput. (Lore has no cross-note dedup — this quantifies the cost.)
  2. Retrieval on the raw dump: known-item r@1/r@5 (duplicate-tolerant) and
     the duplicate-echo rate in top-5 (hygiene cost surfaced to the user).
  3. Day-one classification: the REAL product path — classify_untagged via
     local Ollama (gemma4:e4b), honoring the 80-notes-per-run cap, simulating
     N tidy-up runs. Coverage, fragmentation vs the owner's HIDDEN real
     folders, days-to-full-classification.
  4. Auto-apply exposure: sections that would auto-create on day one, each
     scored for purity against the hidden folders.
  5. v2 merge healing on CLASSIFIER-generated topics (the lane where healing
     can actually act, unlike the preserve-real-folders test).
  6. G10: per-corpus abstention threshold calibration on raw fused scores.
  7. #2 telemetry: tokens for inject-style resolved content vs IDs-first
     digest vs digest+hydrate-one, on this store.

Usage: python eval/scenarios/run_coldstart_enron.py
       [--maildir PATH] [--user beck-s] [--cap 3000] [--classify-runs 5]
       [--workdir DIR] [--out PATH] [--no-llm]
"""
import argparse
import hashlib
import json
import os
import re
import statistics
import sys
import time
import urllib.request
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SP = Path(os.environ.get("CLAUDE_SCRATCHPAD",
                         r"C:\Users\ivatu\AppData\Local\Temp\claude"
                         r"\C--Users-ivatu-vault-kos\ab8aad04-9711-4e3c-81fb-69661ecc5f7a\scratchpad"))

TENANT = "cold"
SCOPE = "eng"
OWNER = "dump-user"
OLLAMA = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma4:e4b")


def early_env(workdir: Path):
    os.environ.setdefault("FASTEMBED_CACHE_PATH", str(SP / "fastembed-models"))
    os.environ["QDRANT_PATH"] = str(workdir / "qdrant")
    os.environ["DATABASE_URL"] = f"sqlite://{(workdir / 'cold.db').as_posix()}"


def ollama_call(prompt: str, timeout: int = 90) -> str:
    req = urllib.request.Request(
        f"{OLLAMA}/api/generate",
        data=json.dumps({"model": OLLAMA_MODEL, "prompt": prompt,
                         "stream": False, "options": {"temperature": 0}}).encode(),
        headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read()).get("response", "")


def message_text_of(body_md: str) -> str:
    """The raw message text back out of our note markdown (for body hashing)."""
    m = re.search(r"## Message\n\n(.*?)(?:\n\n## Participants|\Z)", body_md, re.DOTALL)
    return (m.group(1) if m else body_md).strip()


def body_hash(text: str) -> str:
    return hashlib.sha256(" ".join(text.casefold().split()).encode()).hexdigest()


def load_raw_dump(maildir: Path, user: str, cap: int):
    """EVERY message, EVERY folder (inbox/sent/all_documents included),
    duplicates KEPT — the honest shape of a user dumping their data.
    Folder name is recorded as HIDDEN gold only."""
    sys.path.insert(0, str(REPO / "eval" / "scenarios"))
    import enron_adapter as EA

    root = maildir / user
    if os.name == "nt" and not str(root).startswith("\\\\?\\"):
        root = Path("\\\\?\\" + str(root.resolve()))
    notes = []
    files = sorted((p for p in root.rglob("*") if p.is_file()),
                   key=lambda p: EA.natural_key(p.as_posix()))
    title_seen = Counter()
    for p in files:
        if len(notes) >= cap:
            break
        folder = p.relative_to(root).parts[0] if len(p.relative_to(root).parts) > 1 else "(root)"
        cand = EA.read_candidate(p, root, folder)
        if cand is None or len(cand.body) < 50:
            continue
        base = cand.subject or f"(no subject) {len(notes):05d}"
        title_seen[base] += 1
        title = base if title_seen[base] == 1 else f"{base} · {title_seen[base]}"
        notes.append({
            "id": f"cold-{len(notes):05d}",
            "title": title[:200],
            "body": EA.markdown_body(cand),
            "hidden_folder": folder,
            "bhash": cand.body_hash,
        })
    return notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--maildir", default=str(SP / "enron" / "maildir"))
    ap.add_argument("--user", default="beck-s")
    ap.add_argument("--cap", type=int, default=3000)
    ap.add_argument("--classify-runs", type=int, default=5)
    ap.add_argument("--workdir", default=str(REPO / "eval" / "scenarios" / ".work" / "coldstart"))
    ap.add_argument("--out", default=str(REPO / "eval" / "history" / "coldstart-enron-2026-07-21.json"))
    ap.add_argument("--no-llm", action="store_true")
    args = ap.parse_args()

    workdir = Path(args.workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    early_env(workdir)
    sys.path.insert(0, str(REPO / "core"))

    import tiktoken

    from lore import db, mcp_server, observations as _obs  # noqa: F401 (mcp fmt reuse)
    from lore import qdrant_store, recall, relations, topic_merge
    from lore.classify import classify_untagged
    from lore.embed import LocalEmbedder, LocalSparseEmbedder
    from lore.index import index_document
    from lore.rerank import LocalReranker
    from lore.sections import propose_sections, list_sections

    enc = tiktoken.get_encoding("cl100k_base")
    tok = lambda s: len(enc.encode(s))
    R = {"user": args.user, "cap": args.cap}

    print(f"[1/7] loading RAW dump ({args.user}, cap {args.cap})...", flush=True)
    notes = load_raw_dump(Path(args.maildir), args.user, args.cap)
    dup_clusters = Counter(n["bhash"] for n in notes)
    n_dup_notes = sum(c for c in dup_clusters.values() if c > 1)
    R["notes"] = len(notes)
    R["hidden_folders"] = len({n["hidden_folder"] for n in notes})
    R["duplicate_notes"] = n_dup_notes
    R["duplicate_clusters"] = sum(1 for c in dup_clusters.values() if c > 1)
    print(f"  {len(notes)} notes · {R['hidden_folders']} hidden folders · "
          f"{n_dup_notes} notes in {R['duplicate_clusters']} duplicate clusters", flush=True)

    print("[2/7] indexing into fresh store...", flush=True)
    conn = db._connect_url(f"sqlite://{(workdir / 'cold.db').as_posix()}")
    db.bootstrap_schema(conn)
    qdrant_store.COLLECTION = "coldstart"
    embedder, sparse, reranker = LocalEmbedder(), LocalSparseEmbedder(), LocalReranker()
    real_delete = qdrant_store.delete_note
    real_ti = relations.build_title_index
    qdrant_store.delete_note = lambda note_id: None
    relations.build_title_index = lambda c, t, exclude_id=None: []
    t0 = time.perf_counter()
    zero_chunk = 0
    chunk_counts = []
    try:
        for i, n in enumerate(notes):
            k = index_document(source_id=n["id"], title=n["title"], text=n["body"],
                               scope_id=SCOPE, owner_id=OWNER, tenant_id=TENANT,
                               embedder=embedder, conn=conn, sparse_embedder=sparse,
                               path=None, source_type="note")
            chunk_counts.append(k)
            if k == 0:
                zero_chunk += 1
            if (i + 1) % 500 == 0:
                print(f"    {i+1}/{len(notes)} ({(i+1)/(time.perf_counter()-t0):.0f} n/s)", flush=True)
    finally:
        qdrant_store.delete_note = real_delete
        relations.build_title_index = real_ti
    R["index_seconds"] = round(time.perf_counter() - t0, 1)
    R["hygiene"] = {
        "zero_chunk_notes": zero_chunk,
        "avg_chunks_per_note": round(statistics.mean(chunk_counts), 2),
        "note": "no cross-note dedup at ingest; redact.py runs on /capture only, "
                "NOT on direct indexing of dumped files",
    }
    print(f"  indexed in {R['index_seconds']}s · zero-chunk {zero_chunk} · "
          f"avg chunks/note {R['hygiene']['avg_chunks_per_note']}", flush=True)

    print("[3/7] retrieval on the raw dump (duplicate-tolerant scoring)...", flush=True)
    curated = json.loads((REPO / "eval" / "scenarios" / "data" / f"enron-{args.user}.json")
                         .read_text(encoding="utf-8"))
    cur_hash = {n["id"]: body_hash(message_text_of(n["body"])) for n in curated["notes"]}
    by_hash: dict = {}
    for n in notes:
        by_hash.setdefault(n["bhash"], set()).add(n["id"])
    lat, r1 = [], 0
    r5 = 0
    dup_echo_slots = 0
    total_slots = 0
    ki = [q for q in curated["queries"] if q["bucket"] == "knownitem"]
    na = [q for q in curated["queries"] if q["bucket"] == "noanswer"]
    ans_scores, na_scores = [], []
    scored = 0
    for q in ki:
        expect_h = cur_hash.get(q["expect_note_ids"][0])
        expect_ids = by_hash.get(expect_h, set())
        if not expect_ids:
            continue           # message fell outside the cap
        scored += 1
        eq = recall.expand_query(q["q"])
        qv = embedder.embed([recall.dense_query_text(eq)])[0]
        sv = sparse.embed_sparse([eq])[0]
        cands = qdrant_store.search_hybrid(qv, sv, [SCOPE], TENANT, limit=40)
        ans_scores.append(cands[0]["score"] if cands else 0.0)
        t1 = time.perf_counter()
        hits = recall.retrieve(q["q"], embedder, reranker, [SCOPE], TENANT,
                               limit=8, sparse_embedder=sparse)
        lat.append((time.perf_counter() - t1) * 1000)
        top_notes = list(dict.fromkeys(h.note_id for h in hits))[:5]
        note_by_id = {n["id"]: n for n in notes}
        hashes_in_top = [note_by_id[t]["bhash"] for t in top_notes if t in note_by_id]
        total_slots += len(top_notes)
        dup_echo_slots += sum(c - 1 for c in Counter(hashes_in_top).values() if c > 1)
        if top_notes and top_notes[0] in expect_ids:
            r1 += 1
        if any(t in expect_ids for t in top_notes):
            r5 += 1
    for q in na:
        eq = recall.expand_query(q["q"])
        qv = embedder.embed([recall.dense_query_text(eq)])[0]
        sv = sparse.embed_sparse([eq])[0]
        cands = qdrant_store.search_hybrid(qv, sv, [SCOPE], TENANT, limit=40)
        na_scores.append(cands[0]["score"] if cands else 0.0)
    R["retrieval"] = {
        "knownitem_scored": scored,
        "recall@1": round(r1 / scored, 3) if scored else None,
        "recall@5": round(r5 / scored, 3) if scored else None,
        "dup_echo_rate_top5": round(dup_echo_slots / total_slots, 3) if total_slots else None,
        "p50_ms": round(statistics.median(lat), 1) if lat else None,
    }
    print(f"  r@1 {R['retrieval']['recall@1']} r@5 {R['retrieval']['recall@5']} "
          f"dup-echo {R['retrieval']['dup_echo_rate_top5']} p50 {R['retrieval']['p50_ms']}ms", flush=True)

    print(f"[4/7] day-one classification ({args.classify_runs} tidy-up runs × 80-note cap)...", flush=True)
    llm = None
    if not args.no_llm:
        try:
            ollama_call("Reply with exactly: ok", timeout=20)
            llm = ollama_call
            print(f"  local LLM live: {OLLAMA_MODEL}", flush=True)
        except Exception:
            print("  Ollama unavailable — deterministic fallback path (the "
                  "no-provider day-one reality)", flush=True)
    cls_stats = []
    t0 = time.perf_counter()
    for run in range(args.classify_runs):
        s = classify_untagged(conn, TENANT, llm_call=llm)
        cls_stats.append(s)
        print(f"    run {run+1}: +{s['notesTagged']} notes "
              f"(llm {s['llmTagged']} / fallback {s['fallbackTagged']})", flush=True)
        if s["notesTagged"] == 0:
            break
    tagged_total = sum(s["notesTagged"] for s in cls_stats)
    topic_rows = conn.execute(
        "select note_id, tag from note_tags where tenant_id=%s and kind='topic'",
        (TENANT,)).fetchall()
    topics = Counter(t for _, t in topic_rows)
    hidden = {n["id"]: n["hidden_folder"] for n in notes}
    assigned = {nid: t for nid, t in topic_rows if nid in hidden}
    from run_scenario_eval import _pairwise_f1
    subset_gold = {nid: hidden[nid] for nid in assigned}
    p, r, f1 = _pairwise_f1(assigned, subset_gold) if assigned else (None, None, None)
    runs_needed = (len(notes) + 79) // 80
    R["classification"] = {
        "llm": OLLAMA_MODEL if llm else None,
        "runs_simulated": len(cls_stats),
        "notes_classified": tagged_total,
        "coverage": round(tagged_total / len(notes), 3),
        "distinct_topics": len(topics),
        "top_topics": topics.most_common(8),
        "pairwise_vs_hidden_folders": {"precision": p, "recall": r, "f1": f1},
        "classify_seconds": round(time.perf_counter() - t0, 1),
        "runs_to_full_coverage_at_80_cap": runs_needed,
    }
    print(f"  {tagged_total}/{len(notes)} classified into {len(topics)} topics · "
          f"pairwise F1 vs hidden folders {f1} · full coverage needs "
          f"{runs_needed} tidy-up runs", flush=True)

    print("[5/7] auto-apply exposure + v2 healing...", flush=True)
    stats = propose_sections(conn, TENANT, threshold=5)
    secs = [s for s in list_sections(conn, TENANT) if s["status"] == "proposed"]
    sec_report = []
    for s in secs:
        ids = [nn["id"] for nn in s["notes"]]
        folds = Counter(hidden.get(i, "?") for i in ids)
        top_fold, top_n = (folds.most_common(1)[0] if folds else ("?", 0))
        sec_report.append({"name": s["name"], "notes": len(ids),
                           "purity_vs_hidden": round(top_n / len(ids), 2) if ids else None,
                           "dominant_hidden_folder": top_fold})
    merges = topic_merge.propose_topic_merges(conn, TENANT, embedder=embedder)
    def majority_hidden(topic_name):
        ids = [nid for nid, t in assigned.items() if t == topic_name]
        c = Counter(hidden[nid] for nid in ids)
        return c.most_common(1)[0][0] if c else None
    m_true = sum(1 for m in merges if majority_hidden(m["keep"]) == majority_hidden(m["merge"]))
    R["day_one_sections"] = {
        "auto_apply_default": True,
        "sections_that_would_auto_create": len(secs),
        "sections": sec_report[:12],
        "merge_proposals": len(merges),
        "merges_agreeing_with_hidden_folders": m_true,
        "merge_examples": [{"keep": m["keep"], "merge": m["merge"],
                            "reason": m["reason"], "score": m["score"]} for m in merges[:8]],
    }
    print(f"  {len(secs)} sections would auto-create · {len(merges)} merge proposals "
          f"({m_true} agree with hidden folders)", flush=True)

    print("[6/7] G10 per-corpus threshold calibration...", flush=True)
    if ans_scores and na_scores:
        thr = (statistics.mean(ans_scores) + statistics.mean(na_scores)) / 2
        tp = sum(1 for s in na_scores if s < thr)
        fp = sum(1 for s in ans_scores if s < thr)
        R["g10"] = {
            "answerable_mean": round(statistics.mean(ans_scores), 4),
            "noanswer_mean": round(statistics.mean(na_scores), 4),
            "calibrated_threshold": round(thr, 4),
            "abstain_recall_on_noanswer": round(tp / len(na_scores), 3),
            "false_abstain_on_answerable": round(fp / len(ans_scores), 3),
        }
        print(f"  threshold {R['g10']['calibrated_threshold']} → abstains on "
              f"{R['g10']['abstain_recall_on_noanswer']} of impossible, falsely on "
              f"{R['g10']['false_abstain_on_answerable']} of answerable", flush=True)

    print("[7/7] #2 SessionStart token telemetry...", flush=True)
    inj, ids_first, hyd1 = [], [], []
    note_body = {n["id"]: n["body"] for n in notes}
    for q in ki[:10]:
        hits = recall.retrieve(q["q"], embedder, reranker, [SCOPE], TENANT,
                               limit=8, sparse_embedder=sparse)
        hdicts = [{"note_id": h.note_id, "title": h.note_id, "heading_path": h.heading_path,
                   "score": h.score, "text": h.text} for h in hits]
        inj.append(tok("\n\n".join(h.text for h in hits)))
        compact = mcp_server._format_search_hits(hdicts)
        ids_first.append(tok(compact))
        top = hits[0].note_id if hits else None
        hyd1.append(tok(compact) + tok(note_body.get(top, "")[:8000]))
    R["session_start_telemetry"] = {
        "inject_resolved_top8_avg_tokens": int(statistics.mean(inj)) if inj else None,
        "ids_first_digest_avg_tokens": int(statistics.mean(ids_first)) if ids_first else None,
        "digest_plus_hydrate1_avg_tokens": int(statistics.mean(hyd1)) if hyd1 else None,
    }
    print(f"  inject-style {R['session_start_telemetry']['inject_resolved_top8_avg_tokens']} tok "
          f"vs IDs-first {R['session_start_telemetry']['ids_first_digest_avg_tokens']} tok "
          f"vs +hydrate-1 {R['session_start_telemetry']['digest_plus_hydrate1_avg_tokens']} tok", flush=True)

    Path(args.out).write_text(json.dumps(R, indent=2), encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
