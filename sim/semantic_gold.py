"""50-query labeled SEMANTIC gold set against Apex (vault_company / apex).

Each query is paraphrased in business/insurance jargon (NOT keyword-copied from the
note titles) and labeled with the note-kind keyword(s) that a correct top hit must
contain. Topic-level ground truth (any note of the right kind counts), which is the
right granularity over 46k notes. Reports recall@1/@3/MRR + per-team + the misses.

Run from core/:  python ../sim/semantic_gold.py
"""
import os
os.environ["QDRANT_COLLECTION"] = "vault_company"
TENANT = "apex"

from lore.embed import LocalEmbedder, LocalSparseEmbedder
from lore.rerank import LocalReranker
from lore.recall import retrieve_traced

E = LocalEmbedder(); S = LocalSparseEmbedder(); R = LocalReranker()

# (query, team, [acceptable title-substrings for a correct top hit])
GOLD = [
 # underwriting
 ("should we keep writing this risky account or walk away", "underwriting", ["Account review", "guideline"]),
 ("what's our appetite for insuring young high-risk drivers", "underwriting", ["guideline", "appetite"]),
 ("rules for kicking a renewal up to a senior underwriter", "underwriting", ["guideline", "Account review"]),
 ("is this policyholder worth renewing given their loss history", "underwriting", ["Account review"]),
 # claims
 ("a driver rear-ended someone, where's the loss file", "claims", ["Claim"]),
 ("we're being sued over a bodily injury claim", "claims", ["Litigated", "Claim"]),
 ("we need to set aside more money on this open claim", "claims", ["Reserve", "Claim"]),
 ("how much are we holding for this collision loss", "claims", ["Reserve", "Claim"]),
 # actuarial
 ("are accidents happening more often and costing more", "actuarial", ["Loss ratio", "Rate indication", "Reserving"]),
 ("how much do we need to raise premiums in this state", "actuarial", ["Rate indication", "Loss ratio"]),
 ("estimate of claims incurred but not yet reported", "actuarial", ["Reserving", "IBNR"]),
 ("is our book running above or below the expected loss plan", "actuarial", ["Loss ratio"]),
 # fraud-siu
 ("someone keeps staging crashes with the same repair shop", "fraud-siu", ["investigation", "Red-flag", "SIU"]),
 ("a cluster of suspicious claims tied to one tow operator", "fraud-siu", ["Red-flag", "investigation"]),
 ("we think there's an organized fraud ring", "fraud-siu", ["investigation", "Red-flag"]),
 ("phantom passengers and inflated medical bills", "fraud-siu", ["investigation", "SIU"]),
 # customer-service
 ("an angry customer is upset about a slow estimate", "customer-service", ["Escalation", "Call summary"]),
 ("caller wants to cancel their policy", "customer-service", ["Call summary", "Escalation"]),
 ("someone phoned in about a billing problem", "customer-service", ["Call summary"]),
 ("dissatisfied insured escalated to a supervisor", "customer-service", ["Escalation"]),
 # legal-compliance
 ("we filed a rate increase with the state regulator", "legal-compliance", ["Rate filing", "filing"]),
 ("the department of insurance is asking about our claim handling", "legal-compliance", ["Regulatory", "Complaint"]),
 ("a policyholder filed a complaint about a denial", "legal-compliance", ["Complaint"]),
 ("regulator objection to our use of credit scoring", "legal-compliance", ["Rate filing", "Regulatory"]),
 # marketing
 ("how is the new bundle advertising campaign doing", "marketing", ["Campaign", "Channel"]),
 ("what's our cost to acquire a customer by channel", "marketing", ["Channel", "Campaign"]),
 ("plan for a safe-driver promotion in Texas", "marketing", ["Campaign"]),
 ("are agents or direct cheaper to acquire through", "marketing", ["Channel"]),
 # it-eng
 ("the quoting system went down during a traffic spike", "it-eng", ["Incident", "Runbook"]),
 ("design for streaming driving data from devices", "it-eng", ["Design doc", "telematics"]),
 ("steps to fail the rating engine over to another region", "it-eng", ["Runbook"]),
 ("production outage in the payments service", "it-eng", ["Incident"]),
 # finance
 ("how much capital protects us against a huge hurricane", "finance", ["Reinsurance", "close", "Combined"]),
 ("what was the combined ratio at month end", "finance", ["close", "Combined"]),
 ("our catastrophe excess-of-loss cover terms", "finance", ["Reinsurance"]),
 ("expenses came in over plan this period", "finance", ["Budget", "variance"]),
 # hr
 ("what's the merit increase pool for engineers", "hr", ["Compensation", "Hiring"]),
 ("how many open roles do we have in claims", "hr", ["Hiring"]),
 ("pay equity audit findings", "hr", ["Compensation"]),
 ("equity refresh for key technical staff", "hr", ["Compensation"]),
 # sales-distribution
 ("which agency is writing unprofitable business", "sales-distribution", ["Producer", "pipeline"]),
 ("how many new agencies did we appoint this quarter", "sales-distribution", ["pipeline", "Producer"]),
 ("contingent commission at risk for an agency", "sales-distribution", ["Producer"]),
 ("distribution onboarding cycle time", "sales-distribution", ["pipeline"]),
 # product
 ("a discount program for low-mileage safe drivers", "product", ["PRD", "usage-based"]),
 ("did the checkout experiment improve bind rate", "product", ["A/B", "test"]),
 ("requirements for usage-based insurance", "product", ["PRD"]),
 ("results of the quote funnel variant test", "product", ["A/B"]),
 # cross / enterprise-ish
 ("what's our strategy to reach profitability", "actuarial", ["Loss ratio", "Combined", "close", "Rate"]),
 ("how do we reduce loss costs with telematics", "actuarial", ["Rate indication", "Loss ratio"]),
]

def metrics(ranks):
    n = len(ranks)
    return (sum(r == 1 for r in ranks)/n, sum(0 < r <= 3 for r in ranks)/n,
            sum((1/r) for r in ranks if r)/n)

def main():
    print(f"=== SEMANTIC gold set: {len(GOLD)} queries ===")
    ranks, per = [], {}
    misses = []
    for q, team, expect in GOLD:
        _, tr = retrieve_traced(q, E, R, S, [f"team-{team}", "apex-enterprise"], TENANT, limit=5)
        rk = 0
        for i, h in enumerate(tr["final"]):
            if any(e.lower() in h["title"].lower() for e in expect):
                rk = i + 1; break
        ranks.append(rk); per.setdefault(team, []).append(rk)
        if rk != 1:
            top = tr["final"][0]["title"][:38] if tr["final"] else "-"
            misses.append((rk, q, top, expect))
    r1, r3, mrr = metrics(ranks)
    print(f"\nOVERALL  recall@1 {r1:.0%}  recall@3 {r3:.0%}  MRR {mrr:.3f}  (n={len(ranks)})")
    print("\nper-team recall@1:")
    for t, rs in sorted(per.items()):
        print(f"  {t:18} {sum(r==1 for r in rs)}/{len(rs)}")
    print(f"\nMISSES ({len(misses)}):")
    for rk, q, top, expect in misses:
        print(f"  [{'@'+str(rk) if rk else 'MISS'}] {q[:46]:46} -> {top}  (wanted {expect})")

if __name__ == "__main__":
    main()
