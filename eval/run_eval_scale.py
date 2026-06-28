"""ADVERSARIAL scale eval: prove BM25's value where dense embeddings fail.

Generates many NEAR-DUPLICATE notes that share almost all their tokens and differ
only by an exact identifier (ticket / account / SKU). Dense vectors cluster these
tightly and cannot reliably pick the right one; BM25 locks onto the exact token.

Run both modes from core/:
    SPARSE=0 python ../eval/run_eval_scale.py     # dense-only
    SPARSE=1 python ../eval/run_eval_scale.py     # dense + BM25 hybrid
"""
import os, tempfile, pathlib, hashlib

os.environ["QDRANT_COLLECTION"] = "vault_eval_scale"
TENANT = "evalscale"
SCOPE = "evalscale-all"

from lore import db
from lore.embed import LocalEmbedder, LocalSparseEmbedder
from lore.rerank import LocalReranker
from lore.index import index_note
from lore.recall import retrieve
from lore import qdrant_store

# ---- adversarial corpus: 3 families of near-duplicate notes -------------------
SERVICES = ["checkout", "billing", "auth", "search", "inventory", "notifications"]
CAUSES = [
    "a null pointer in the coupon validator",
    "an unbounded retry loop saturating the thread pool",
    "a missing database index causing full table scans",
    "a memory leak in the session cache",
    "a misconfigured connection timeout",
    "a race condition in the order state machine",
    "an expired downstream API token",
    "a deadlock between the writer and compactor",
]
RISKS = [
    "champion left the company", "budget freeze this fiscal year",
    "evaluating a competitor", "low product usage", "merger uncertainty",
    "security review pending", "renewal owner changed", "pricing pushback",
]
COLORS = ["matte black", "brushed steel", "anodized blue", "powder white"]

def make_corpus():
    c = {}
    for i in range(40):  # incidents
        tid = f"PROJ-{1000+i}"
        c[f"incident_{tid}.md"] = (
            f"# Incident {tid}\n\nThe {SERVICES[i%len(SERVICES)]} service returned HTTP 500 errors "
            f"under production load. Root cause: {CAUSES[i%len(CAUSES)]}. Mitigated by a rollback and "
            f"permanently fixed in build 2.{i%9}.{i%7}.\n")
    for i in range(30):  # accounts
        aid = f"ACME-{2000+i}"
        c[f"account_{aid}.md"] = (
            f"# Account {aid}\n\nAnnual enterprise contract; renewal scheduled for Q{1+i%4} 2026. "
            f"Account owner is sales rep #{i%12}. Renewal risk: {RISKS[i%len(RISKS)]}.\n")
    for i in range(30):  # SKUs
        sid = f"SKU-{3000+i}"
        c[f"product_{sid}.md"] = (
            f"# Product {sid}\n\nIndustrial-grade widget with a {COLORS[i%len(COLORS)]} finish, "
            f"{20+i}mm diameter. MSRP ${100+i}. Standard lead time is {1+i%6} weeks.\n")
    return c

def make_queries():
    q = []
    # exact-identifier queries (the BM25 thesis): wording is generic, ID is the only discriminator
    for i in (3, 11, 19, 27, 37):
        q.append((f"what was the root cause of incident PROJ-{1000+i}", f"incident_PROJ-{1000+i}.md", "id-incident"))
    for i in (2, 9, 14, 22, 29):
        q.append((f"renewal risk for account ACME-{2000+i}", f"account_ACME-{2000+i}.md", "id-account"))
    for i in (5, 13, 21, 28):
        q.append((f"lead time and price for SKU-{3000+i}", f"product_SKU-{3000+i}.md", "id-sku"))
    # semantic sanity queries (no identifier) — hybrid must not break these.
    # Each cause/risk phrase is unique enough only for the FIRST note that uses it.
    q.append(("which incident was caused by a deadlock between writer and compactor", "incident_PROJ-1007.md", "semantic"))
    q.append(("show the account at risk because of a merger", "account_ACME-2004.md", "semantic"))
    return q

def main():
    use_sparse = os.environ.get("SPARSE", "1") != "0"
    conn = db.connect(); db.bootstrap_schema(conn)
    try: qdrant_store._client.delete_collection("vault_eval_scale")
    except Exception: pass
    conn.execute("delete from chunks where note_id in (select id from notes where tenant_id=%s)", (TENANT,))
    conn.execute("delete from notes where tenant_id=%s", (TENANT,))

    embedder = LocalEmbedder()
    sparse = LocalSparseEmbedder() if use_sparse else None
    reranker = LocalReranker()

    tmp = tempfile.mkdtemp()
    corpus = make_corpus()
    paths = {}
    for name, md in corpus.items():
        p = pathlib.Path(tmp) / name; p.write_text(md, encoding="utf-8"); paths[name] = str(p)
    nid = lambda path: hashlib.sha1(path.encode()).hexdigest()[:16]
    id2name = {nid(p): name for name, p in paths.items()}

    n = 0
    for name, p in paths.items():
        n += index_note(p, embedder, conn, "evaluser", SCOPE, TENANT, sparse_embedder=sparse)
    mode = "dense+BM25 hybrid" if use_sparse else "dense-only"
    print(f"Indexed {len(paths)} near-duplicate notes / {n} chunks  (mode: {mode})\n")

    queries = make_queries()
    ranks, per = [], {}
    print(f"{'TYPE':12} {'RANK':4}  QUERY")
    print("-" * 78)
    for q, expected, typ in queries:
        hits = retrieve(q, embedder, reranker, [SCOPE], TENANT, limit=5, sparse_embedder=sparse)
        names = [id2name.get(h.note_id, "?") for h in hits]
        rank = next((i+1 for i, nm in enumerate(names) if nm == expected), 0)
        ranks.append(rank); per.setdefault(typ, []).append(rank)
        mark = "OK" if rank == 1 else (f"#{rank}" if rank else "MISS")
        print(f"{typ:12} {mark:4}  {q[:54]}")

    r1 = sum(1 for r in ranks if r == 1) / len(ranks)
    r3 = sum(1 for r in ranks if 0 < r <= 3) / len(ranks)
    mrr = sum((1/r) for r in ranks if r) / len(ranks)
    print(f"\n=== {mode} ===  queries={len(ranks)}  recall@1={r1:.0%}  recall@3={r3:.0%}  MRR={mrr:.3f}")
    for t, rs in sorted(per.items()):
        print(f"  {t:12} recall@1 {sum(1 for r in rs if r==1)}/{len(rs)}")

if __name__ == "__main__":
    main()
