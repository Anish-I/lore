"""Faithful directory onboarding — drive Lore's REAL ingest path over a folder.

This is NOT a bespoke adapter: it walks a directory and calls index.index_note()
per file, the exact function the backend's /reindex handler invokes. Files go
through distill_md -> extract.extract_text (PyMuPDF for PDFs, stdlib for docx)
-> chunk -> embed -> edge extraction, into a fresh store. Then the real organize
pass (classify + section proposals). Nothing is hand-massaged; whatever Lore
does to real files is what we measure.

The immediate parent folder is recorded as HIDDEN gold (never fed to Lore) so
the inferred organization can be scored against how the records are actually filed.

Usage: python eval/scenarios/run_onboard_directory.py --root "PATH" [--tenant onboard]
       [--classify-runs 40] [--limit N] [--workdir DIR] [--out PATH]
"""
import argparse
import json
import os
import statistics
import sys
import time
import urllib.request
from collections import Counter
from pathlib import Path

OLLAMA = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma4:e4b")


def ollama_call(prompt: str, timeout: int = 120) -> str:
    req = urllib.request.Request(
        f"{OLLAMA}/api/generate",
        data=json.dumps({"model": OLLAMA_MODEL, "prompt": prompt,
                         "stream": False, "options": {"temperature": 0}}).encode(),
        headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read()).get("response", "")

REPO = Path(__file__).resolve().parents[2]
SP = Path(os.environ.get("CLAUDE_SCRATCHPAD",
                         r"C:\Users\ivatu\AppData\Local\Temp\claude"
                         r"\C--Users-ivatu-vault-kos\ab8aad04-9711-4e3c-81fb-69661ecc5f7a\scratchpad"))

SCOPE = "eng"
OWNER = "onboard-user"


def early_env(workdir: Path):
    os.environ.setdefault("FASTEMBED_CACHE_PATH", str(SP / "fastembed-models"))
    os.environ["QDRANT_PATH"] = str(workdir / "qdrant")
    os.environ["DATABASE_URL"] = f"sqlite://{(workdir / 'onboard.db').as_posix()}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--tenant", default="onboard")
    ap.add_argument("--classify-runs", type=int, default=40)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workdir", default=str(REPO / "eval" / "scenarios" / ".work" / "onboard"))
    ap.add_argument("--out", default=str(REPO / "eval" / "history" / "onboard-directory-2026-07-22.json"))
    args = ap.parse_args()
    tenant = args.tenant

    workdir = Path(args.workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    early_env(workdir)
    sys.path.insert(0, str(REPO / "core"))

    from lore import db, qdrant_store, relations
    from lore.classify import classify_untagged, load_vocabulary
    from lore.embed import LocalEmbedder, LocalSparseEmbedder
    from lore.extract import EXTRACTABLE_EXTS
    from lore.index import index_note
    from lore.sections import propose_sections, list_sections
    from run_scenario_eval import _pairwise_f1

    root = Path(args.root)
    # Walk like the desktop reconcile: every file, deterministic order.
    all_files = sorted(p for p in root.rglob("*") if p.is_file())
    supported = {".md", ".txt"} | EXTRACTABLE_EXTS
    files = [p for p in all_files if p.suffix.lower() in supported]
    if args.limit:
        files = files[: args.limit]

    R = {"root": str(root), "total_files": len(all_files),
         "supported_files": len(files)}
    ext_counts = Counter(p.suffix.lower() for p in all_files)
    R["file_types"] = dict(ext_counts.most_common())
    print(f"onboarding {len(files)} supported / {len(all_files)} files from {root.name}", flush=True)

    conn = db._connect_url(os.environ["DATABASE_URL"])
    db.bootstrap_schema(conn)
    qdrant_store.COLLECTION = "onboard"
    embedder, sparse = LocalEmbedder(), LocalSparseEmbedder()

    # Hidden gold: immediate parent folder name, per note id. index_note derives
    # the note id from the path, so re-derive it the same way to join later.
    from lore.distill import distill_md

    indexed = extracted_empty = errored = 0
    chunk_counts = []
    hidden = {}          # note_id -> parent folder
    t0 = time.perf_counter()
    for i, p in enumerate(files):
        parent = p.parent.name
        try:
            note_id, _title, md = distill_md(str(p))
        except Exception:
            errored += 1
            continue
        if not md or not md.strip():
            extracted_empty += 1
            continue
        try:
            k = index_note(str(p), embedder, conn, OWNER, SCOPE, tenant,
                           sparse_embedder=sparse)
        except Exception as e:
            errored += 1
            if errored <= 3:
                print(f"    ERROR on {p.name}: {str(e)[:120]}", flush=True)
            continue
        hidden[note_id] = parent
        chunk_counts.append(k)
        if k > 0:
            indexed += 1
        else:
            extracted_empty += 1
        if (i + 1) % 50 == 0:
            print(f"    {i+1}/{len(files)} · indexed {indexed} · empty {extracted_empty} "
                  f"· err {errored} · {(i+1)/(time.perf_counter()-t0):.1f} files/s", flush=True)

    R["ingest"] = {
        "indexed_with_chunks": indexed,
        "extracted_but_empty": extracted_empty,
        "errored": errored,
        "extraction_success_rate": round(indexed / len(files), 3) if files else None,
        "avg_chunks_per_doc": round(statistics.mean([c for c in chunk_counts if c]), 2)
                              if any(chunk_counts) else 0,
        "seconds": round(time.perf_counter() - t0, 1),
        "docs_per_sec": round(len(files) / (time.perf_counter() - t0), 2),
    }
    print(f"  ingest: {indexed} indexed, {extracted_empty} empty (scanned/no text layer), "
          f"{errored} errored in {R['ingest']['seconds']}s", flush=True)

    # Connections Lore built on its own (edges) — the "creating connections" claim.
    edge_rows = conn.execute(
        "select kind, count(*) from edges where tenant_id=%s group by kind", (tenant,)).fetchall()
    R["connections"] = {kind: n for kind, n in edge_rows}
    R["connections"]["total"] = sum(n for _, n in edge_rows)
    print(f"  connections: {R['connections']}", flush=True)

    # Real organize pass: classify (with C2 vocabulary) until coverage, then
    # section proposals. Local Ollama = the desktop's use_llm path; deterministic
    # fallback (frontmatter/hashtags/wikilinks) finds nothing in raw PDFs.
    llm = None
    try:
        ollama_call("Reply with exactly: ok", timeout=20)
        llm = ollama_call
        print(f"  classifying with local LLM {OLLAMA_MODEL} (up to {args.classify_runs} runs)...",
              flush=True)
    except Exception:
        print(f"  Ollama down — classifying via deterministic fallback (the "
              f"no-provider reality; raw PDFs have no frontmatter/tags to key on)", flush=True)
    tagged = llm_tagged = 0
    for run in range(args.classify_runs):
        s = classify_untagged(conn, tenant, llm_call=llm)
        tagged += s["notesTagged"]
        llm_tagged += s["llmTagged"]
        if s["notesTagged"] == 0:
            break
    topic_rows = conn.execute(
        "select note_id, tag from note_tags where tenant_id=%s and kind='topic'",
        (tenant,)).fetchall()
    topics = Counter(t for _, t in topic_rows)
    assigned = {nid: t for nid, t in topic_rows if nid in hidden}
    subset_gold = {nid: hidden[nid] for nid in assigned}
    p_, r_, f1 = _pairwise_f1(assigned, subset_gold) if assigned else (None, None, None)
    R["organization"] = {
        "classified": tagged,
        "distinct_topics": len(topics),
        "gold_folders": len(set(hidden.values())),
        "top_topics": topics.most_common(15),
        "pairwise_vs_folders": {"precision": p_, "recall": r_, "f1": f1},
        "classifier": OLLAMA_MODEL if llm else "deterministic-fallback",
        "llm_tagged": llm_tagged,
    }
    print(f"  organization: {tagged} classified into {len(topics)} topics vs "
          f"{len(set(hidden.values()))} real folders · F1 {f1}", flush=True)

    propose_sections(conn, tenant, threshold=5)
    secs = [s for s in list_sections(conn, tenant) if s["status"] == "proposed"]
    sec_report = []
    for s in secs:
        ids = [nn["id"] for nn in s["notes"]]
        folds = Counter(hidden.get(i, "?") for i in ids)
        top = folds.most_common(1)[0] if folds else ("?", 0)
        sec_report.append({"name": s["name"], "notes": len(ids),
                           "purity_vs_folder": round(top[1] / len(ids), 2) if ids else None,
                           "dominant_folder": top[0]})
    R["sections"] = {"proposed": len(secs), "detail": sec_report[:20]}
    print(f"  sections: {len(secs)} proposed", flush=True)

    Path(args.out).write_text(json.dumps(R, indent=2), encoding="utf-8")
    print(f"wrote {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
