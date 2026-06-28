"""Vault recall/ranking eval over a diverse multi-domain corpus.

Runs in an ISOLATED Qdrant collection + tenant so it never touches demo data.
Uses real local semantic embeddings (fastembed BGE) + local cross-encoder rerank
+ BM25 sparse lane (fastembed Qdrant/bm25) for hybrid retrieval.

Usage:
    cd core && python ../eval/run_eval.py            # default: hybrid + rerank
    RERANK=0 python ../eval/run_eval.py              # ablation: no rerank
    SPARSE=0 python ../eval/run_eval.py              # ablation: dense-only (no BM25)
"""
import os, sys, tempfile, pathlib

# Isolation MUST be set before importing vault.qdrant_store (reads env at import).
os.environ["QDRANT_COLLECTION"] = "vault_eval"
TENANT = "eval"
SCOPE = "eval-all"

from lore import db
from lore.embed import LocalEmbedder, LocalSparseEmbedder
from lore.rerank import LocalReranker, FakeReranker
from lore.index import index_note
from lore.recall import retrieve
from lore import qdrant_store

# ---------------------------------------------------------------------------
# CORPUS: filename -> markdown. Spread across tech / business / health / food /
# finance / travel. Content is realistic; queries below are PARAPHRASED so this
# tests semantic recall, not keyword matching.
# Exact-token notes (identifiers like PROJ-1234) test the BM25 sparse lane.
# ---------------------------------------------------------------------------
CORPUS = {
 # ---- TECH ----
 "pg_pooling.md": """# Postgres Connection Pooling
## Problem
Under heavy concurrent load our API exhausts Postgres backends and new requests hang waiting for a free connection. Postgres `max_connections` is 100 and each app worker opened its own pool.
## Fix
We put PgBouncer in transaction-pooling mode in front of Postgres so thousands of client connections multiplex onto ~20 server connections. App pool size dropped to 5 per worker.
""",
 "k8s_oom.md": """# Kubernetes Pod OOMKilled
## Symptom
Pods restart with exit code 137 during traffic spikes. `kubectl describe` shows OOMKilled.
## Cause
The container memory limit was 512Mi but the JVM heap was unbounded, so the kernel killed the process.
## Resolution
Set `-XX:MaxRAMPercentage=75` and raised the limit to 1Gi; added a memory request so the scheduler reserves it.
""",
 "rust_borrow.md": """# Rust Borrow Checker Notes
Ownership means each value has a single owner. You can have many immutable references or exactly one mutable reference, never both at once. This prevents data races at compile time. Lifetimes annotate how long references stay valid.
""",
 "tls_cert_expiry.md": """# Outage: Expired TLS Certificate
## Incident
Customers got SSL handshake failures at 02:00 UTC. The wildcard cert had expired and auto-renewal silently failed because the ACME DNS challenge could not write the TXT record.
## Action
Rotated the cert manually, fixed the DNS API token scope, and added an alert 21 days before expiry.
""",
 "redis_cache.md": """# Redis Caching Strategy
We cache expensive query results in Redis with a 5 minute TTL and cache-aside loading. To avoid thundering-herd on expiry we add a small random jitter to each key's TTL and use a single-flight lock so only one worker recomputes.
""",
 "git_bisect.md": """# Finding a Regression with git bisect
When a bug appears but you don't know which commit caused it, `git bisect` does a binary search between a known-good and known-bad commit, halving the suspect range each step until it pinpoints the offending commit.
""",
 # ---- BUSINESS ----
 "acme_renewal.md": """# Acme Account
## Renewal
Acme's annual contract renews in Q3 2026. Risk: our champion (the VP of Engineering) left the company last month and the new VP has not been briefed, so the relationship is cold.
## Pricing
List price is $120k; we approved a discount to $96k contingent on a two-year commitment.
""",
 "q3_okrs.md": """# Q3 Company OKRs
Objective: reach profitability. Key results: grow ARR to $4M, cut cloud spend 20%, lift gross margin to 78%, and ship the self-serve onboarding flow so sales-assisted deals are no longer required for small customers.
""",
 "hiring_plan.md": """# 2026 Hiring Plan
We will add two backend engineers, one designer, and a developer-advocate. Backend hires are gated on closing the Series A. The designer starts immediately to unblock the dashboard redesign.
""",
 "pricing_strategy.md": """# Pricing Strategy Memo
Move from seat-based pricing to usage-based, billing on documents processed. Seat pricing punished teams for adding viewers and capped expansion revenue. Usage pricing aligns cost with value and grows as customers grow.
""",
 "competitor_glean.md": """# Competitive: Glean
Glean sells enterprise search over a company's existing SaaS (Slack, Drive, Jira) using a knowledge graph. Their moat is connectors and permissions. We differentiate by capturing tacit individual knowledge locally and exposing per-person agents.
""",
 "churn_analysis.md": """# Customer Churn Analysis
Churn concentrates in accounts that never connected a second data source in the first 14 days. Single-source accounts churn at triple the rate. Action: push a second integration during onboarding.
""",
 # ---- HEALTH / FOOD / FINANCE / TRAVEL (other) ----
 "marathon_training.md": """# Marathon Training Block
Base phase is 8 weeks of easy mileage to build aerobic capacity, then 6 weeks of tempo runs and intervals, then a 3 week taper. Long runs peak at 20 miles. Most weekly miles stay conversational pace to avoid injury.
""",
 "sleep_hygiene.md": """# Better Sleep Habits
Keep a consistent wake time, avoid screens an hour before bed, keep the room cool and dark, and stop caffeine after early afternoon since it has a long half-life that delays sleep onset.
""",
 "sourdough.md": """# Sourdough Bread Method
Feed the starter until it doubles. Mix flour and water and autolyse 1 hour. Add salt and starter, do four sets of stretch-and-folds, bulk ferment until 50% risen, shape, cold proof overnight, then bake in a dutch oven with steam.
""",
 "carbonara.md": """# Pasta Carbonara
Render guanciale, toss hot pasta off the heat with egg yolks and pecorino, using starchy pasta water to emulsify a glossy sauce. No cream. The residual heat cooks the egg without scrambling it.
""",
 "roth_ira.md": """# Roth IRA Notes
Contributions are made with after-tax money, grow tax-free, and qualified withdrawals in retirement are untaxed. Contribution limits phase out at higher incomes; a backdoor conversion is the workaround for high earners.
""",
 "japan_trip.md": """# Japan Trip Plan
Two weeks: Tokyo for five days, day trip to Hakone for hot springs and Mt Fuji views, then the bullet train to Kyoto for temples and Osaka for food. Get a rail pass before arriving; it must be bought outside Japan.
""",
 # ---- EXACT-TOKEN NOTES (exercise the BM25 sparse lane) ----
 "bug_proj1234.md": """# Bug Report PROJ-1234
## Summary
PROJ-1234 tracks a critical null-pointer exception in the payment gateway when a card token expires mid-transaction.
## Reproduction
1. Initiate a checkout with a token expiring in <1 second.
2. Observe NullPointerException in PaymentService.charge() at line 87.
## Fix
Added a pre-flight token validity check before calling the processor API. PROJ-1234 is now resolved and deployed to production.
""",
 "doc_doc5678.md": """# Architecture Decision Record DOC-5678
## Context
DOC-5678 documents the decision to migrate our monolith to an event-driven microservices architecture.
## Decision
We adopt Apache Kafka as the message broker. Each bounded context publishes domain events; consumers subscribe and maintain their own read models.
## Consequences
Operational complexity increases but team autonomy and independent deploy cadence improve significantly. DOC-5678 is the canonical reference for this migration.
""",
 "svc_svc0042.md": """# Service Runbook SVC-0042
## Overview
SVC-0042 is the notification delivery service responsible for sending email, push, and SMS alerts to end users.
## On-call
Escalate SVC-0042 pages to the platform team. Check the dead-letter queue first; most failures are transient SMTP timeouts.
## Metrics
SVC-0042 emits delivery_success_rate and delivery_latency_p99 to Datadog dashboard #4421.
""",
}

# ---------------------------------------------------------------------------
# QUERIES: (query, expected_filename, domain). Wording deliberately differs
# from the note so semantic recall is what's tested.
# Exact-token queries (identifiers) exercise the BM25 sparse lane.
# ---------------------------------------------------------------------------
QUERIES = [
 # tech
 ("our database keeps running out of connections when traffic spikes", "pg_pooling.md", "tech"),
 ("containers getting killed for using too much memory", "k8s_oom.md", "tech"),
 ("compile-time rules that stop two threads mutating the same data", "rust_borrow.md", "tech"),
 ("why did customers get handshake errors in the middle of the night", "tls_cert_expiry.md", "tech"),
 ("how do we stop everyone recomputing the same value when a cached key expires", "redis_cache.md", "tech"),
 ("binary search through history to find which change broke things", "git_bisect.md", "tech"),
 # business
 ("which big customer is at risk because our main contact quit", "acme_renewal.md", "business"),
 ("what are the goals for becoming profitable this quarter", "q3_okrs.md", "business"),
 ("who are we planning to recruit and what's blocking it", "hiring_plan.md", "business"),
 ("should we charge per user or by how much they use the product", "pricing_strategy.md", "business"),
 ("who is the main rival in enterprise knowledge search", "competitor_glean.md", "business"),
 ("what predicts whether an account stops paying us", "churn_analysis.md", "business"),
 # other
 ("how should I structure my running plan before a big race", "marathon_training.md", "health"),
 ("tips to fall asleep faster and rest better", "sleep_hygiene.md", "health"),
 ("steps to bake bread with a natural starter", "sourdough.md", "food"),
 ("how do you make that creamy egg pasta without cream", "carbonara.md", "food"),
 ("tax-free retirement account funded with post-tax dollars", "roth_ira.md", "finance"),
 ("itinerary for visiting temples and hot springs in japan", "japan_trip.md", "travel"),
 # cross-domain disambiguation (similar words, different domain)
 ("how do we reduce our cloud bill", "q3_okrs.md", "business"),
 ("connecting a second data source early keeps customers around", "churn_analysis.md", "business"),
 # exact-token queries — BM25 sparse lane must surface these at rank 1
 ("what is the status of PROJ-1234", "bug_proj1234.md", "sparse"),
 ("find DOC-5678 architecture decision", "doc_doc5678.md", "sparse"),
 ("on-call runbook for SVC-0042", "svc_svc0042.md", "sparse"),
]

def build_corpus(tmp):
    paths = {}
    for name, md in CORPUS.items():
        p = pathlib.Path(tmp) / name
        p.write_text(md, encoding="utf-8")
        paths[name] = str(p)
    return paths

def main():
    use_rerank = os.environ.get("RERANK", "1") != "0"
    use_sparse = os.environ.get("SPARSE", "1") != "0"
    conn = db.connect(); db.bootstrap_schema(conn)
    # fresh isolated collection
    try: qdrant_store._client.delete_collection("vault_eval")
    except Exception: pass
    conn.execute("delete from chunks where note_id in (select id from notes where tenant_id=%s)", (TENANT,))
    conn.execute("delete from notes where tenant_id=%s", (TENANT,))

    embedder = LocalEmbedder()
    sparse_embedder = LocalSparseEmbedder() if use_sparse else None
    reranker = LocalReranker() if use_rerank else FakeReranker()

    tmp = tempfile.mkdtemp()
    paths = build_corpus(tmp)
    # map note_id -> filename for scoring
    import hashlib
    nid = lambda path: hashlib.sha1(path.encode()).hexdigest()[:16]
    id2name = {nid(p): name for name, p in paths.items()}

    total_chunks = 0
    for name, p in paths.items():
        total_chunks += index_note(p, embedder, conn, "evaluser", SCOPE, TENANT,
                                   sparse_embedder=sparse_embedder)
    sparse_label = "BM25+dense hybrid" if use_sparse else "dense-only"
    print(f"Indexed {len(paths)} notes / {total_chunks} chunks into vault_eval "
          f"(rerank={'cross-encoder' if use_rerank else 'OFF'}, retrieval={sparse_label})\n")

    ranks = []
    per_domain = {}
    print(f"{'DOMAIN':9} {'RANK':4}  QUERY  ->  TOP HIT")
    print("-" * 88)
    for q, expected, domain in QUERIES:
        hits = retrieve(q, embedder, reranker, [SCOPE], TENANT, limit=5,
                        sparse_embedder=sparse_embedder)
        hit_names = [id2name.get(h.note_id, "?") for h in hits]
        rank = next((i + 1 for i, n in enumerate(hit_names) if n == expected), 0)
        ranks.append(rank)
        per_domain.setdefault(domain, []).append(rank)
        top = hit_names[0] if hit_names else "(none)"
        mark = "OK " if rank == 1 else (f"#{rank}" if rank else "MISS")
        print(f"{domain:9} {mark:4}  {q[:46]:46} -> {top}")

    def recall_at(k): return sum(1 for r in ranks if 0 < r <= k) / len(ranks)
    mrr = sum((1.0 / r) for r in ranks if r) / len(ranks)
    print("\n=== AGGREGATE ===")
    print(f"queries={len(ranks)}  recall@1={recall_at(1):.0%}  recall@3={recall_at(3):.0%}  "
          f"recall@5={recall_at(5):.0%}  MRR={mrr:.3f}")
    print("per-domain recall@1:")
    for d, rs in sorted(per_domain.items()):
        print(f"  {d:9} {sum(1 for r in rs if r==1)}/{len(rs)}")

if __name__ == "__main__":
    main()
