"""Unit tests for the 2026-07-20 ceiling/clustering fills.

G3 — BGE query-side instruction prefix (recall.dense_query_text, env-gated).
G2 — contextual enrichment for ALL chunks (contextualize._CONTEXT_ALL).
C4 — topic merge proposals (topic_merge.propose_topic_merges, proposals-only).

Module-level env gates are monkeypatched as module attributes (see
.learnings/2026-07-13: import-time env reads can't be tuned via setenv).
"""
from lore import contextualize, db, recall, topic_merge
from lore.chunker import chunk_markdown
from lore.contextualize import apply_context
from lore.embed import FakeEmbedder
from lore.models import Chunk
from lore.rerank import FakeReranker


def _conn():
    c = db.connect()
    db.bootstrap_schema(c)
    return c


# ---------------------------------------------------------------------------
# G3: dense_query_text + wiring
# ---------------------------------------------------------------------------

def test_dense_query_text_off_by_default(monkeypatch):
    monkeypatch.setattr(recall, "_BGE_QUERY_PREFIX", False)
    assert recall.dense_query_text("what changed") == "what changed"


def test_dense_query_text_prefixes_when_enabled(monkeypatch):
    monkeypatch.setattr(recall, "_BGE_QUERY_PREFIX", True)
    out = recall.dense_query_text("what changed")
    assert out == recall._BGE_QUERY_INSTRUCTION + "what changed"
    assert out.endswith("what changed")


class _RecordingEmbedder(FakeEmbedder):
    """FakeEmbedder that records every text it embeds."""
    def __init__(self, dim=8):
        super().__init__(dim=dim)
        self.seen = []

    def embed(self, texts):
        self.seen.extend(texts)
        return super().embed(texts)


class _RecordingSparse:
    def __init__(self):
        self.seen = []

    def embed_sparse(self, texts):
        self.seen.extend(texts)
        return [{"indices": [1], "values": [1.0]} for _ in texts]


def test_retrieve_prefixes_dense_lane_only(monkeypatch):
    """The instruction reaches the DENSE embed text; the sparse lane and the
    reranker keep the raw query (BM25 must see raw terms)."""
    monkeypatch.setattr(recall, "_BGE_QUERY_PREFIX", True)
    dense, sparse = _RecordingEmbedder(), _RecordingSparse()
    calls = {}

    def fake_hybrid(qvec, svec, scopes, tenant, limit=40, source_types=None):
        calls["hybrid"] = True
        return []
    monkeypatch.setattr(recall.qdrant_store, "search_hybrid", fake_hybrid)

    out = recall.retrieve("pipe leak flooding", dense, FakeReranker(),
                          ["s"], "t", sparse_embedder=sparse)
    assert out == [] and calls["hybrid"]
    assert dense.seen == [recall._BGE_QUERY_INSTRUCTION + "pipe leak flooding"]
    assert sparse.seen == ["pipe leak flooding"]


def test_retrieve_dense_text_unchanged_when_disabled(monkeypatch):
    monkeypatch.setattr(recall, "_BGE_QUERY_PREFIX", False)
    dense, sparse = _RecordingEmbedder(), _RecordingSparse()
    monkeypatch.setattr(recall.qdrant_store, "search_hybrid",
                        lambda *a, **k: [])
    recall.retrieve("pipe leak flooding", dense, FakeReranker(),
                    ["s"], "t", sparse_embedder=sparse)
    assert dense.seen == ["pipe leak flooding"]


# ---------------------------------------------------------------------------
# G2: enrich all chunks
# ---------------------------------------------------------------------------

_LONG_BODY = ("The adjuster completed the full inspection of the property and "
              "documented every item of contents damage in the living areas. ") * 6

_MD = f"""# Claim file

## Inspection
{_LONG_BODY}

## Status
It remains open pending the contractor estimate.
"""


def test_apply_context_default_only_short_or_pronoun(monkeypatch):
    monkeypatch.setattr(contextualize, "_CONTEXT_ALL", False)
    chunks = apply_context(chunk_markdown("n1", _MD), "CLM-10001 Baxter St")
    by_path = {c.heading_path: c for c in chunks}
    long_chunk = by_path["Claim file > Inspection"]
    short_chunk = by_path["Claim file > Status"]
    assert not long_chunk.has_context          # long prose: skipped today
    assert short_chunk.has_context             # short + pronoun-start: enriched
    assert short_chunk.context.startswith("From note 'CLM-10001 Baxter St'")


def test_apply_context_all_enriches_every_chunk(monkeypatch):
    monkeypatch.setattr(contextualize, "_CONTEXT_ALL", True)
    chunks = apply_context(chunk_markdown("n1", _MD), "CLM-10001 Baxter St")
    assert chunks and all(c.has_context for c in chunks)
    for c in chunks:
        assert c.context.startswith("From note 'CLM-10001 Baxter St'")
        # Two-stage invariant: raw text is preserved separately from context.
        assert c.context not in c.text
        assert c.has_context_text().startswith(c.context)
        assert c.has_context_text().endswith(c.text)


# ---------------------------------------------------------------------------
# C4: topic merge proposals
# ---------------------------------------------------------------------------

def _seed_topic(conn, tenant, topic, n, body, prefix):
    for i in range(n):
        nid = f"{prefix}-{i}"
        conn.execute(
            """insert into notes(id, tenant_id, owner_id, scope_id, title, body, updated_at)
               values(%s,%s,'me','private',%s,%s,now()) on conflict (id) do nothing""",
            (nid, tenant, f"{topic} note {i}", f"{body} #{i}"))
        conn.execute(
            "insert into note_tags(note_id, tenant_id, tag, kind, source) "
            "values(%s,%s,%s,'topic','llm') on conflict do nothing",
            (nid, tenant, topic))


class _ClusterEmbedder:
    """Maps digests to one of two orthogonal directions by keyword, so topics
    about the same subject get cosine≈1 and unrelated ones cosine≈0."""
    def embed(self, texts):
        out = []
        for t in texts:
            tl = t.lower()
            if "subro" in tl:
                out.append([1.0, 0.0, 0.0, 0.0])
            elif "picnic" in tl:
                out.append([0.0, 1.0, 0.0, 0.0])
            else:
                out.append([0.0, 0.0, 1.0, 0.0])
        return out


def test_slug_lane_catches_separator_and_case_variants():
    tenant = "tm-slug"
    conn = _conn()
    _seed_topic(conn, tenant, "Kalshi Bot", 4, "trading bot work", "ka")
    _seed_topic(conn, tenant, "KalshiBot", 2, "more trading bot work", "kb")
    props = topic_merge.propose_topic_merges(conn, tenant, embedder=None)
    assert len(props) == 1
    p = props[0]
    assert p["reason"] == "slug" and p["score"] == 1.0
    assert p["keep"] == "Kalshi Bot" and p["merge"] == "KalshiBot"   # larger wins
    assert p["keep_count"] == 4 and p["merge_count"] == 2


def test_embedding_lane_merges_abbreviation_fragments():
    """'Subrogation' vs 'Subro Recovery': no shared whole token, but the ≥4-char
    prefix rule supplies name evidence and near-identical content clears the bar."""
    tenant = "tm-embed"
    conn = _conn()
    _seed_topic(conn, tenant, "Subrogation", 5, "subro recovery pursuit against carrier", "sa")
    _seed_topic(conn, tenant, "Subro Recovery", 3, "subro demand letter to at-fault carrier", "sb")
    _seed_topic(conn, tenant, "Company Picnic", 3, "picnic planning and vendor booking", "cp")
    props = topic_merge.propose_topic_merges(conn, tenant, embedder=_ClusterEmbedder())
    assert len(props) == 1
    p = props[0]
    assert {p["keep"], p["merge"]} == {"Subrogation", "Subro Recovery"}
    assert p["keep"] == "Subrogation"                     # 5 > 3 notes
    assert p["reason"] == "embedding" and p["score"] >= 0.99


def test_distinct_topics_with_shared_words_not_merged_below_bar():
    """Name evidence alone is not enough — centroids must also agree. 'Claims -
    Auto' vs 'Claims - Property' share 'claims' but embed orthogonally here."""
    tenant = "tm-block"
    conn = _conn()
    _seed_topic(conn, tenant, "Claims - Subro", 4, "subro files", "cx")
    _seed_topic(conn, tenant, "Claims - Picnic", 4, "picnic files", "cy")
    props = topic_merge.propose_topic_merges(conn, tenant, embedder=_ClusterEmbedder())
    assert props == []


def test_no_topics_no_proposals():
    conn = _conn()
    assert topic_merge.propose_topic_merges(conn, "tm-empty", embedder=None) == []
