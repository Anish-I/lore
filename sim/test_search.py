"""Automated search-quality battery against the Apex company (vault_company / apex).

Four batteries:
  1. EXACT-ID lexical  — sample real notes, query their ID, expect that note at rank 1.
  2. ACL invariant     — every returned chunk's scope MUST be within the asker's scope set.
  3. SEMANTIC          — paraphrased queries, expect the right topic in the top hit.
  4. CIRCLE            — circle-scoped knowledge is visible to the circle, invisible to outsiders.

Run from core/:  python ../sim/test_search.py
"""
import os, re
os.environ["QDRANT_COLLECTION"] = "vault_company"
TENANT = "apex"

from vault import db
from vault.embed import LocalEmbedder, LocalSparseEmbedder
from vault.rerank import LocalReranker
from vault.recall import retrieve_traced

E = LocalEmbedder(); S = LocalSparseEmbedder(); R = LocalReranker()
conn = db.connect()
ID_RE = re.compile(r"(CLM-\d+|POL-\d+|ENG-\d+|RF-[A-Z]{2}-\d+)")

def search(q, scopes, limit=5):
    final, tr = retrieve_traced(q, E, R, S, scopes, TENANT, limit=limit)
    return tr["final"]

def battery_exact_id():
    print("\n[1] EXACT-ID lexical (find the one note carrying this ID among 46k)")
    patterns = [("%CLM-%", "claim"), ("%POL-%", "policy"), ("%ENG-%", "incident"), ("%RF-%", "rate-filing")]
    passed = total = 0
    for like, label in patterns:
        rows = conn.execute(
            "select id,title,scope_id from notes where tenant_id=%s and title like %s order by id limit 6",
            (TENANT, like)).fetchall()
        for nid, title, scope in rows:
            m = ID_RE.search(title)
            if not m:
                continue
            ident = m.group(1)
            hits = search(f"details of {ident}", [scope, "apex-enterprise"])
            ok = bool(hits) and ident in hits[0]["title"]
            passed += ok; total += 1
            if not ok:
                print(f"   MISS {ident:16} ({label}) -> top: {hits[0]['title'][:40] if hits else '(none)'}")
    print(f"   => {passed}/{total} found at rank 1")
    return passed, total

def battery_acl():
    print("\n[2] ACL invariant (no returned chunk may sit outside the asker's scopes)")
    cases = [
        ("reinsurance treaty PML catastrophe XoL", ["team-claims", "apex-enterprise"]),
        ("compensation merit pool pay equity", ["team-marketing", "apex-enterprise"]),
        ("loss ratio and indicated rate change", ["team-hr", "apex-enterprise"]),
        ("underwriting appetite guideline", ["team-finance", "apex-enterprise"]),
        ("fraud ring staged collision", ["team-product", "apex-enterprise"]),
    ]
    passed = total = 0
    for q, scopes in cases:
        hits = search(q, scopes, limit=8)
        leaks = [h for h in hits if h["scope"] not in scopes]
        total += 1; passed += (not leaks)
        if leaks:
            print(f"   LEAK '{q[:30]}' as {scopes}: {[(h['title'][:24], h['scope']) for h in leaks[:3]]}")
    print(f"   => {passed}/{total} cases with zero scope leakage")
    return passed, total

def battery_semantic():
    print("\n[3] SEMANTIC relevance (paraphrased -> expected topic in top hit)")
    cases = [
        ("how bad is our claims frequency and severity this quarter", ["team-actuarial", "apex-enterprise"], ["Loss ratio", "Reserving", "Rate indication"]),
        ("a customer's car was stolen, what's the file", ["team-claims", "apex-enterprise"], ["Claim", "claim"]),
        ("the rating engine went down in production", ["team-it-eng", "apex-enterprise"], ["Incident", "Runbook", "Design doc"]),
        ("are we exposed to a big hurricane", ["team-finance", "apex-enterprise"], ["Reinsurance", "close", "Combined"]),
        ("usage based pricing from driving data", ["team-product", "apex-enterprise"], ["PRD", "telematics", "A/B"]),
        ("someone is faking accidents with the same body shop", ["team-fraud-siu", "apex-enterprise"], ["investigation", "Red-flag", "SIU"]),
    ]
    passed = total = 0
    for q, scopes, expect in cases:
        hits = search(q, scopes)
        top = hits[0]["title"] if hits else ""
        ok = any(e.lower() in top.lower() for e in expect)
        passed += ok; total += 1
        print(f"   {'OK ' if ok else 'MISS'} '{q[:42]}' -> {top[:40]}")
    print(f"   => {passed}/{total} top-hit on expected topic")
    return passed, total

def battery_circle():
    print("\n[4] CIRCLE visibility (rate-filing-2026 seen by members, hidden from outsiders)")
    row = conn.execute("select count(*) from notes where tenant_id=%s and scope_id='rate-filing-2026'", (TENANT,)).fetchone()
    print(f"   notes scoped rate-filing-2026: {row[0]}")
    member = search("rate filing objection and indicated change", ["rate-filing-2026", "apex-enterprise"], limit=8)
    member_hits = [h for h in member if h["scope"] == "rate-filing-2026"]
    outsider = search("rate filing objection and indicated change", ["team-customer-service", "apex-enterprise"], limit=8)
    outsider_leak = [h for h in outsider if h["scope"] == "rate-filing-2026"]
    ok = bool(member_hits) and not outsider_leak
    print(f"   circle member sees {len(member_hits)} circle note(s); outsider sees {len(outsider_leak)} (must be 0) -> {'PASS' if ok else 'FAIL'}")
    return (1 if ok else 0), 1

def main():
    print("=== Apex search-quality battery (vault_company, tenant apex) ===")
    results = [battery_exact_id(), battery_acl(), battery_semantic(), battery_circle()]
    p = sum(x for x, _ in results); t = sum(y for _, y in results)
    print(f"\n=== TOTAL: {p}/{t} checks passed ({100*p//t}%) ===")

if __name__ == "__main__":
    main()
