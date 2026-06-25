"""Rigorous accuracy benchmark against Apex (vault_company / apex).

Larger samples for stable numbers. Reports recall@1, recall@3, MRR per category.
Run from core/:  python ../sim/benchmark.py
"""
import os, re
os.environ["QDRANT_COLLECTION"] = "vault_company"
TENANT = "apex"
N_PER_TYPE = int(os.environ.get("N", "50"))

from vault import db
from vault.embed import LocalEmbedder, LocalSparseEmbedder
from vault.rerank import LocalReranker
from vault.recall import retrieve_traced

E = LocalEmbedder(); S = LocalSparseEmbedder(); R = LocalReranker()
conn = db.connect()
ID_RE = re.compile(r"(CLM-\d+|POL-\d+|ENG-\d+|RF-[A-Z]{2}-\d+)")

def rank_of(hits, predicate):
    for i, h in enumerate(hits):
        if predicate(h):
            return i + 1
    return 0

def metrics(ranks):
    n = len(ranks)
    r1 = sum(1 for r in ranks if r == 1) / n
    r3 = sum(1 for r in ranks if 0 < r <= 3) / n
    mrr = sum((1 / r) for r in ranks if r) / n
    return r1, r3, mrr

def bench_exact():
    print(f"\n[EXACT-ID]  N={N_PER_TYPE} per type, find the note carrying the literal ID")
    print(f"  {'type':14} {'recall@1':>9} {'recall@3':>9} {'MRR':>7}")
    overall = []
    for like, label in [("%CLM-%","claim"),("%ENG-%","incident"),("%RF-%","rate-filing"),("%POL-%","policy")]:
        rows = conn.execute(
            "select title,scope_id from notes where tenant_id=%s and title like %s order by id limit %s",
            (TENANT, like, N_PER_TYPE)).fetchall()
        ranks = []
        for title, scope in rows:
            m = ID_RE.search(title)
            if not m: continue
            ident = m.group(1)
            _, tr = retrieve_traced(f"details of {ident}", E, R, S, [scope, "apex-enterprise"], TENANT, limit=10)
            ranks.append(rank_of(tr["final"], lambda h: ident in h["title"]))
        r1, r3, mrr = metrics(ranks); overall += ranks
        print(f"  {label:14} {r1:8.0%} {r3:9.0%} {mrr:7.3f}  (n={len(ranks)})")
    r1, r3, mrr = metrics(overall)
    print(f"  {'ALL':14} {r1:8.0%} {r3:9.0%} {mrr:7.3f}  (n={len(overall)})")
    return r1

def bench_semantic():
    print("\n[SEMANTIC]  paraphrased -> expected topic in top hit")
    cases = [
        ("how bad is our claims frequency and severity", ["team-actuarial"], ["Loss ratio","Reserving","Rate indication"]),
        ("a customer's car was stolen what's the file", ["team-claims"], ["Claim"]),
        ("the rating engine went down in production", ["team-it-eng"], ["Incident","Runbook","Design"]),
        ("usage based pricing from driving data", ["team-product"], ["PRD","telematics","A/B"]),
        ("faking accidents with the same body shop", ["team-fraud-siu"], ["investigation","Red-flag","SIU"]),
        ("how much capital for a big hurricane", ["team-finance"], ["Reinsurance","Combined","close"]),
        ("merit increase budget for engineers", ["team-hr"], ["Compensation","Hiring"]),
        ("should we keep or drop this risky account", ["team-underwriting"], ["Account review","guideline"]),
        ("regulator is asking about claim handling time", ["team-legal-compliance"], ["Regulatory","Complaint","filing"]),
        ("which agency is writing bad business", ["team-sales-distribution"], ["Producer","pipeline"]),
        ("how is the new campaign performing", ["team-marketing"], ["Campaign","Channel"]),
        ("customer is angry about a delayed estimate", ["team-customer-service"], ["Escalation","Call summary"]),
    ]
    ranks = []
    for q, scopes, expect in cases:
        _, tr = retrieve_traced(q, E, R, S, scopes + ["apex-enterprise"], TENANT, limit=5)
        rk = rank_of(tr["final"], lambda h: any(e.lower() in h["title"].lower() for e in expect))
        ranks.append(rk)
        print(f"  {'OK ' if rk==1 else ('@'+str(rk) if rk else 'MISS')}  {q[:44]:44} -> {tr['final'][0]['title'][:34] if tr['final'] else '-'}")
    r1, r3, mrr = metrics(ranks)
    print(f"  => recall@1 {r1:.0%}  recall@3 {r3:.0%}  MRR {mrr:.3f}  (n={len(ranks)})")
    return r1

def main():
    print("=== Apex accuracy benchmark ===")
    e = bench_exact()
    s = bench_semantic()
    print(f"\n=== HEADLINE: exact-ID recall@1 {e:.0%} | semantic recall@1 {s:.0%} ===")

if __name__ == "__main__":
    main()
