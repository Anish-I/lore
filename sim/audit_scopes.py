"""Per-scope security audit of the Apex company.

For EACH principal (every team scope, every circle, a locked-down private user,
CEO, Admin) we run a battery of ADVERSARIAL extraction probes — each probe tries
to pull another department's sensitive knowledge (HR comp, finance reinsurance,
fraud files, exec strategy, legal filings, etc.).

Invariant under test: every chunk a principal retrieves MUST carry a scope the
principal holds. Any chunk outside the principal's scope set = a LEAK (an ACL bug).
Also reports each principal's "reach" (how many probe-topics they legitimately hit).

Run from core/:  python ../sim/audit_scopes.py
"""
import os
os.environ["QDRANT_COLLECTION"] = "vault_company"
TENANT = "apex"

from lore.embed import LocalEmbedder, LocalSparseEmbedder
from lore.rerank import LocalReranker
from lore.recall import retrieve_traced

E = LocalEmbedder(); S = LocalSparseEmbedder(); R = LocalReranker()

TEAMS = ["underwriting","claims","actuarial","fraud-siu","customer-service","legal-compliance",
         "marketing","it-eng","finance","hr","sales-distribution","product"]
CIRCLES = ["exec-committee","rate-filing-2026","project-telematics","catastrophe-response","ma-diligence","data-governance"]

# Adversarial probes — each aims at some department's sensitive content.
PROBES = [
    "executive compensation merit pool pay equity bonus",      # HR
    "reinsurance treaty PML catastrophe XoL limit",            # Finance
    "SIU fraud investigation staged collision ring",           # Fraud
    "rate filing DOI objection indicated rate change",         # Legal/Actuarial
    "exec committee strategy board confidential",              # Exec
    "litigated claim demand settlement plaintiff",             # Claims
    "underwriting appetite non-renew decline account",         # Underwriting
    "loss ratio reserving IBNR tail factor",                   # Actuarial
    "M&A diligence target valuation acquisition",              # ma-diligence
    "telematics ingestion design doc usage-based",             # Eng/Product
]

def principal_scopes():
    ps = []
    for t in TEAMS:
        ps.append((f"team-{t}", [f"team-{t}", "apex-enterprise"]))
    for c in CIRCLES:
        ps.append((f"circle:{c}", [c, "apex-enterprise"]))
    ps.append(("private:claims-03", ["claims-03-private", "apex-enterprise"]))
    ps.append(("CEO", ["ceo-private","exec-committee","team-finance","team-claims","team-actuarial","apex-enterprise"]))
    ps.append(("ADMIN(all)", [f"team-{t}" for t in TEAMS] + CIRCLES + ["apex-enterprise"]))
    return ps

def audit():
    print("=== Per-scope adversarial ACL audit (vault_company / apex) ===")
    print(f"{len(principal_scopes())} principals x {len(PROBES)} probes = "
          f"{len(principal_scopes())*len(PROBES)} searches\n")
    print(f"{'PRINCIPAL':22} {'reach':>6}  {'LEAKS':>5}   leaked scopes (must be empty)")
    print("-"*78)
    total_leaks = 0; total_searches = 0
    for name, scopes in principal_scopes():
        allowed = set(scopes)
        reach = 0; leaks = []
        for q in PROBES:
            _, tr = retrieve_traced(q, E, R, S, scopes, TENANT, limit=8)
            total_searches += 1
            hits = tr["final"]
            if hits:
                reach += 1
            for h in hits:
                if h["scope"] not in allowed:
                    leaks.append(h["scope"])
        total_leaks += len(leaks)
        leaked = sorted(set(leaks))
        flag = "" if not leaked else "  <<< LEAK"
        print(f"{name:22} {reach:>4}/10  {len(leaks):>5}   {leaked}{flag}")
    print("-"*78)
    print(f"TOTAL: {total_searches} searches, {total_leaks} leaked chunks across all principals "
          f"-> {'PASS (zero leakage)' if total_leaks==0 else 'FAIL'}")

    # Demonstrate a locked-down principal CANNOT extract a secret, even targeting it directly.
    print("\n[demo] team-marketing tries hard to extract HR comp + finance reinsurance:")
    for q in ["executive compensation merit pool", "reinsurance treaty PML catastrophe"]:
        _, tr = retrieve_traced(q, E, R, S, ["team-marketing","apex-enterprise"], TENANT, limit=5)
        titles = [(h["title"][:34], h["scope"]) for h in tr["final"][:3]]
        print(f"   '{q}': {titles}")

if __name__ == "__main__":
    audit()
