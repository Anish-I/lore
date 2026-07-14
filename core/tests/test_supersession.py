"""Auto-supersession detection, superseded ranking via note signals, and the
append-only fold audit.

Covers the loop: propose (token overlap + recency) → accept/dismiss →
`superseded` signal through recall's note-signals path → upkeep's append-only
audit blocks. FakeEmbedder is hash-based (similar text != similar vectors), so
every test rides the token-overlap detection path — which is what ships.
"""
import uuid

import pytest

from lore import db
from lore import recall
from lore import supersede
from lore import upkeep
from lore.embed import FakeEmbedder
from lore.rerank import FakeReranker
from lore.index import index_document


@pytest.fixture(scope="module")
def conn():
    c = db.connect()
    db.bootstrap_schema(c)
    return c


def _tenant():
    return f"supersession-{uuid.uuid4().hex[:12]}"


def _index_note(conn, tenant_id, title, body, created, scope="supersession"):
    """Index a synthetic note with a controlled created: date; returns note_id."""
    text = f"---\ncreated: {created}\n---\n# {title}\n\n{body}\n"
    note_id = f"n-{uuid.uuid4().hex[:12]}"
    index_document(
        source_id=note_id, title=title, text=text, scope_id=scope,
        owner_id="test", tenant_id=tenant_id, embedder=FakeEmbedder(), conn=conn,
    )
    return note_id


def _edge_origin(conn, tenant_id, src, dst):
    row = conn.execute(
        "select origin from edges where tenant_id=%s and kind='supersedes'"
        " and src_note_id=%s and dst_note_id=%s",
        (tenant_id, src, dst),
    ).fetchone()
    return row[0] if row else None


def _signals_provider(conn, tenant):
    """Test-side mirror of api._note_signals_provider's superseded semantics:
    accepted edges only (NON_RANKING_ORIGINS excluded)."""
    def provider(note_ids):
        stale = supersede.superseded_note_ids(conn, tenant)
        return {nid: {"importance": 0.0, "age_days": None,
                      "memory_type": "durable", "entity_hit": False,
                      "superseded": nid in stale, "feedback_net": 0}
                for nid in note_ids}
    return provider


def test_proposes_newer_overlapping_note(conn):
    tenant = _tenant()
    old = _index_note(
        conn, tenant, "project alpaca deployment plan",
        "alpaca rollout window remains friday with owner dana and guardrail amber",
        "2025-01-01T00:00:00Z",
    )
    new = _index_note(
        conn, tenant, "project alpaca deployment plan update",
        "alpaca rollout window remains friday with owner dana and guardrail green",
        "2025-01-02T00:00:00Z",
    )

    proposed = supersede.propose_supersessions(conn, tenant, new)

    assert old in proposed
    proposals = supersede.list_proposals(conn, tenant)
    assert any(p["src"] == new and p["dst"] == old for p in proposals)
    assert _edge_origin(conn, tenant, new, old) == "auto-proposed"


def test_unrelated_titles_do_not_propose(conn):
    tenant = _tenant()
    _index_note(conn, tenant, "billing archive",
                "invoice remit account ledger", "2025-01-01T00:00:00Z")
    new = _index_note(conn, tenant, "garden checklist",
                      "mulch tomato basil watering", "2025-01-02T00:00:00Z")

    assert supersede.propose_supersessions(conn, tenant, new) == []
    assert supersede.list_proposals(conn, tenant) == []


def test_candidate_newer_than_note_is_not_proposed(conn):
    tenant = _tenant()
    newer = _index_note(
        conn, tenant, "project zephyr launch plan",
        "zephyr launch plan owner taylor status current", "2025-01-03T00:00:00Z",
    )
    older = _index_note(
        conn, tenant, "project zephyr launch roadmap",
        "zephyr launch plan owner taylor status stale", "2025-01-02T00:00:00Z",
    )

    assert newer not in supersede.propose_supersessions(conn, tenant, older)


def test_accept_flips_origin_and_marks_superseded(conn):
    tenant = _tenant()
    old = _index_note(conn, tenant, "atlas budget",
                      "atlas budget is 10 for the whole quarter including "
                      "hardware software and the contingency reserve line",
                      "2025-01-01T00:00:00Z")
    new = _index_note(conn, tenant, "atlas budget revision",
                      "atlas budget is 20 for the whole quarter including "
                      "hardware software and the contingency reserve line",
                      "2025-01-02T00:00:00Z")
    supersede.propose_supersessions(conn, tenant, new)

    assert supersede.resolve_proposal(conn, tenant, new, old, "accept") is True
    assert _edge_origin(conn, tenant, new, old) == "auto"
    assert old in supersede.superseded_note_ids(conn, tenant)
    assert supersede.is_superseded(conn, tenant, old) is True
    assert supersede.is_superseded(conn, tenant, new) is False


def test_dismiss_does_not_resurrect_on_reproposal(conn):
    tenant = _tenant()
    old = _index_note(conn, tenant, "orion rota",
                      "orion rota owner sam monday", "2025-01-01T00:00:00Z")
    new = _index_note(conn, tenant, "orion rota revision",
                      "orion rota owner sam tuesday", "2025-01-02T00:00:00Z")
    supersede.propose_supersessions(conn, tenant, new)

    assert supersede.resolve_proposal(conn, tenant, new, old, "dismiss") is True
    assert _edge_origin(conn, tenant, new, old) == "auto-dismissed"
    # Re-running detection must not resurrect the pair (on conflict do nothing).
    assert old not in supersede.propose_supersessions(conn, tenant, new)
    assert _edge_origin(conn, tenant, new, old) == "auto-dismissed"
    # And a dismissed edge never counts as superseded.
    assert old not in supersede.superseded_note_ids(conn, tenant)


def test_recall_downweights_superseded_via_note_signals(conn, monkeypatch):
    tenant = _tenant()
    scope = "recall-" + uuid.uuid4().hex[:8]
    old = _index_note(
        conn, tenant, "mira endpoint",
        "mira endpoint uses port seven thousand shared query token",
        "2025-01-01T00:00:00Z", scope=scope,
    )
    new = _index_note(
        conn, tenant, "mira endpoint revision",
        "mira endpoint uses port nine thousand shared query token",
        "2025-01-02T00:00:00Z", scope=scope,
    )
    supersede.propose_supersessions(conn, tenant, new)
    supersede.resolve_proposal(conn, tenant, new, old, "accept")
    monkeypatch.setattr(recall, "SUPERSEDED_WEIGHT", 0.5)

    hits = recall.retrieve("mira endpoint shared query token",
                           FakeEmbedder(), FakeReranker(),
                           allowed_scope_ids=[scope], tenant_id=tenant,
                           note_signals=_signals_provider(conn, tenant))
    scores = {}
    for h in hits:
        scores.setdefault(h.note_id, h.score)
    assert old in scores and new in scores, f"both notes must be retrieved: {scores}"
    assert scores[old] < scores[new]


def test_proposed_only_edge_does_not_downweight(conn, monkeypatch):
    tenant = _tenant()
    scope = "prop-" + uuid.uuid4().hex[:8]
    old = _index_note(
        conn, tenant, "nova risk",
        "nova risk score medium across the shared review board today",
        "2025-01-01T00:00:00Z", scope=scope,
    )
    new = _index_note(
        conn, tenant, "nova risk revision",
        "nova risk score low across the shared review board today",
        "2025-01-02T00:00:00Z", scope=scope,
    )
    assert old in supersede.propose_supersessions(conn, tenant, new)

    # Proposal pending — the invariant: it must NOT rank-penalize the old note.
    assert old not in supersede.superseded_note_ids(conn, tenant)
    provider = _signals_provider(conn, tenant)
    assert provider({old})[old]["superseded"] is False


def test_superseded_audit_blocks_append_only(conn):
    tenant = _tenant()
    old = _index_note(conn, tenant, "delta policy",
                      "delta policy allow beta", "2025-01-01T00:00:00Z")
    new = _index_note(conn, tenant, "delta policy revision",
                      "delta policy deny beta", "2025-01-02T00:00:00Z")
    supersede.propose_supersessions(conn, tenant, new)
    supersede.resolve_proposal(conn, tenant, new, old, "accept")
    body = (
        "# Topic\n\n"
        "## 2025-01-01 — Delta Policy\n"
        f"<!-- lore:from {old} -->\n\n"
        "The old policy allows beta.\n"
    )

    blocks = upkeep._superseded_audit_blocks(conn, tenant, body)
    assert len(blocks) == 1
    date_key, block = blocks[0]
    assert f"<!-- lore:superseded {old} -->" in block
    assert "[[delta policy revision]]" in block
    assert "[!superseded]" in block

    # Append through the guarded path — invariant must hold byte-for-byte.
    appended = upkeep.append_entries(body, blocks)
    assert appended.startswith(body.rstrip())
    # Idempotent: once the audit anchor is in the body, no new blocks.
    assert upkeep._superseded_audit_blocks(conn, tenant, appended) == []


def test_audit_blocks_skip_unsuperseded_entries(conn):
    tenant = _tenant()
    note = _index_note(conn, tenant, "epsilon notes",
                       "epsilon current fact", "2025-01-01T00:00:00Z")
    body = f"# Topic\n\n## 2025-01-01\n<!-- lore:from {note} -->\n\ncontent line\n"
    assert upkeep._superseded_audit_blocks(conn, tenant, body) == []
