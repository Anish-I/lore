"""Recall eval against the LIVE Lore store, through the same /search HTTP API
that lore-inject.js uses — so it measures exactly what agents see injected.

Unlike run_eval.py (isolated synthetic corpus), this scores the real store:
  - hit@1 / hit@5 / MRR over a gold set of paraphrased queries with known
    expected notes (matched by title substring, case-insensitive), and
  - session-echo rate: fraction of all top-5 slots occupied by raw
    captured-session chunks ("## Prompt [...]" sections of claude-session /
    codex-session notes) — the store-pollution metric. Lower is better;
    knowledge/topic notes should win those slots.

Usage:
    python eval/run_recall_eval.py                 # backend on :8099
    LORE_PORT=8100 python eval/run_recall_eval.py  # other port
"""
import json
import os
import sys
import urllib.request

PORT = int(os.environ.get("LORE_PORT", "8099"))
URL = f"http://localhost:{PORT}/search"
TENANT = os.environ.get("LORE_TENANT", "local")
SCOPES = [s for s in os.environ.get("LORE_SCOPES", "engineering").split(",") if s]

# (query, expected-title-substring) — wording deliberately paraphrased away from
# the note titles/bodies so this tests semantic recall, not keyword echo.
GOLD = [
    # Lore's own development (fresh notes from 2026-07-02)
    ("what fixed the knowledge graph date slider", "shipped 2026-07-02"),
    ("how are notes chunked and stored with vectors", "Architecture Overview"),
    ("why did the dock icon rename almost lose user data", "Architecture Overview"),
    ("how does codex capture chain to the previous notifier", "Architecture Overview"),
    ("what happens when a section gets promoted", "Architecture Overview"),
    # Older Lore eval/benchmark work
    ("did the bigger embedding model beat the small one", "embedder A/B"),
    ("labeled query set for measuring semantic recall", "semantic gold-set"),
    ("UX problems found by the four-agent desktop audit", "UX audit"),
    # Wingman architecture (long-lived notes)
    ("which model provider did we pick for the assistant and why", "ADR-001"),
    ("why composio instead of zapier", "ADR-002"),
    ("how does the sms assistant route to its integrations", "ADR-003"),
    # Kalshi
    ("crypto 15 minute market win rate investigation", "win-rate diagnosis"),
    ("trading bot risk controls and pair sizing", "KalshiBot"),
    # Tooling / infra knowledge
    ("local model too slow for planning workflows", "throughput ceiling"),
    ("app uses npm not pnpm", "npm, NOT pnpm"),
    ("anthropic provider fails without api credits", "API credits"),
    ("windows and mac paths for each project", "where projects actually live"),
    # Cross-domain disambiguation
    ("exact identifier lookup lane hitting 100 percent", "exact-match identifier"),
    ("system prompt patterns worth copying into our claude setup", "CL4R1T4S"),
    ("orphan notes automatically connected in the vault", "Orphan Auto-Connector"),
]


def search(query, k=5):
    body = json.dumps({
        "query": query, "scopes": SCOPES, "tenant_id": TENANT, "k": k,
    }).encode()
    req = urllib.request.Request(URL, data=body, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.loads(r.read())
    return data.get("results") or data.get("hits") or []


def hit_title(h):
    return str(h.get("title") or h.get("note_title") or "")


def is_session_echo(h):
    """A raw captured-prompt chunk from a session note (the pollution class)."""
    title = hit_title(h)
    section = str(h.get("heading_path") or h.get("section") or "")
    return ("Session" in title) and ("Prompt [" in section or "Prompt [" in str(h.get("text", "")[:60]))


def main():
    ranks, echo_slots, total_slots = [], 0, 0
    print(f"{'RANK':4}  {'QUERY':52} TOP HIT")
    print("-" * 110)
    for q, expected in GOLD:
        try:
            hits = search(q)
        except Exception as e:
            print(f"ERR   {q[:52]:52} {e}")
            ranks.append(0)
            continue
        titles = [hit_title(h) for h in hits]
        rank = next((i + 1 for i, t in enumerate(titles) if expected.lower() in t.lower()), 0)
        ranks.append(rank)
        echo_slots += sum(1 for h in hits if is_session_echo(h))
        total_slots += len(hits)
        mark = "OK " if rank == 1 else (f"#{rank}" if rank else "MISS")
        print(f"{mark:4}  {q[:52]:52} {titles[0][:48] if titles else '(none)'}")

    n = len(ranks)
    hit_at = lambda k: sum(1 for r in ranks if 0 < r <= k) / n
    mrr = sum(1.0 / r for r in ranks if r) / n
    echo_rate = (echo_slots / total_slots) if total_slots else 0.0
    print("\n=== AGGREGATE ===")
    print(f"queries={n}  hit@1={hit_at(1):.0%}  hit@5={hit_at(5):.0%}  MRR={mrr:.3f}")
    print(f"session-echo rate (top-5 slots occupied by raw prompt captures): {echo_rate:.0%}"
          f"  [{echo_slots}/{total_slots}]")


if __name__ == "__main__":
    main()
