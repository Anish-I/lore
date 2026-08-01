"""RetrievalProfile: per-caller tuning threaded through the recall pipeline.

Every retrieval knob used to be a module-level constant read from env at import
time (recall.RECENCY_WEIGHT & co), so tuning was process-wide: one daemon could
serve only one tuning. These tests pin the replacement contract —

  * the module globals still back the DEFAULT profile (env at import, and the
    ablation harnesses that monkeypatch them at runtime, both keep working), and
  * every helper accepts an explicit profile that overrides them per call.
"""
import dataclasses

import pytest

from lore import recall
from lore.embed import FakeEmbedder
from lore.profiles import RetrievalProfile
from lore.rerank import FakeReranker


# ---------------------------------------------------------------------------
# the default profile is a view over the module globals
# ---------------------------------------------------------------------------

def test_default_profile_mirrors_module_constants():
    p = recall._default_profile()
    assert p.session_weight == recall.SESSION_WEIGHT
    assert p.agent_weight == recall.AGENT_WEIGHT
    assert p.importance_weight == recall.IMPORTANCE_WEIGHT
    assert p.recency_weight == recall.RECENCY_WEIGHT
    assert p.recency_half_life_days == recall.RECENCY_HALF_LIFE_DAYS
    assert p.entity_boost == recall.ENTITY_BOOST
    assert p.superseded_weight == recall.SUPERSEDED_WEIGHT
    assert p.feedback_weight == recall.FEEDBACK_WEIGHT
    assert p.rerank_weight_semantic == recall.RERANK_WEIGHT_SEMANTIC
    assert p.rerank_weight_lexical == recall.RERANK_WEIGHT_LEXICAL


def test_default_profile_tracks_monkeypatched_globals(monkeypatch):
    """eval/scenarios/run_scenario_eval.py sweeps by assigning module globals —
    the default profile must be rebuilt from them, not frozen at import."""
    monkeypatch.setattr(recall, "SESSION_WEIGHT", 0.25)
    monkeypatch.setattr(recall, "_BGE_QUERY_PREFIX", True)
    p = recall._default_profile()
    assert p.session_weight == 0.25
    assert p.bge_query_prefix is True


def test_memory_type_weights_derive_from_profile():
    p = RetrievalProfile(agent_weight=0.5, session_weight=0.2)
    assert p.memory_type_weights == {"durable": 1.0, "agent": 0.5, "session": 0.2}


# ---------------------------------------------------------------------------
# rerank weight
# ---------------------------------------------------------------------------

def test_weight_for_uses_profile_semantic_and_lexical_weights():
    p = RetrievalProfile(rerank_weight_semantic=0.9, rerank_weight_lexical=0.1)
    assert recall._weight_for("how does chunking work", p) == 0.9
    assert recall._weight_for("what happened to PROJ-1037", p) == 0.1


def test_weight_for_honors_forced_weight():
    p = RetrievalProfile(rerank_weight_forced=0.33,
                         rerank_weight_semantic=0.9, rerank_weight_lexical=0.1)
    assert recall._weight_for("how does chunking work", p) == 0.33
    assert recall._weight_for("what happened to PROJ-1037", p) == 0.33


# ---------------------------------------------------------------------------
# query-side knobs
# ---------------------------------------------------------------------------

def test_dense_query_text_respects_profile_prefix(monkeypatch):
    monkeypatch.setattr(recall, "_BGE_QUERY_PREFIX", False)  # default says off
    on = RetrievalProfile(bge_query_prefix=True)
    off = RetrievalProfile(bge_query_prefix=False)
    assert recall.dense_query_text("what changed", on) == \
        recall._BGE_QUERY_INSTRUCTION + "what changed"
    assert recall.dense_query_text("what changed", off) == "what changed"


def test_expand_query_disabled_by_profile(monkeypatch):
    monkeypatch.setattr(recall, "_GLOSSARY", {"pooling": "pgbouncer"})
    assert "pgbouncer" in recall.expand_query("pooling", RetrievalProfile(expand=True))
    assert recall.expand_query("pooling", RetrievalProfile(expand=False)) == "pooling"


# ---------------------------------------------------------------------------
# scoring knobs
# ---------------------------------------------------------------------------

def test_downweight_sessions_uses_profile_session_weight():
    final = {"a": 1.0}
    by_id = {"a": {"source_type": "claude-session"}}
    recall._downweight_sessions(final, by_id, RetrievalProfile(session_weight=0.5))
    assert final["a"] == 0.5


def _signal(**over):
    s = {"memory_type": "durable", "importance": 0.0, "age_days": None,
         "superseded": False, "entity_hit": False}
    s.update(over)
    return s


def test_apply_note_signals_uses_profile_entity_boost():
    hot = {"c1": 0.5}
    cold = {"c1": 0.5}
    by_id = {"c1": {"note_id": "n1"}}
    signals = {"n1": _signal(entity_hit=True)}
    recall._apply_note_signals(hot, by_id, "how does chunking work", signals,
                               RetrievalProfile(entity_boost=1.0))
    recall._apply_note_signals(cold, by_id, "how does chunking work", signals,
                               RetrievalProfile(entity_boost=0.0))
    assert hot["c1"] > cold["c1"]
    assert cold["c1"] == 0.5


def test_apply_note_signals_uses_profile_recency_half_life():
    short = {"c1": 0.5}
    long = {"c1": 0.5}
    by_id = {"c1": {"note_id": "n1"}}
    signals = {"n1": _signal(age_days=30.0)}
    q = "what is the current status"  # 'current' intent -> full recency weight
    recall._apply_note_signals(short, by_id, q, signals,
                               RetrievalProfile(recency_half_life_days=1.0))
    recall._apply_note_signals(long, by_id, q, signals,
                               RetrievalProfile(recency_half_life_days=365.0))
    assert long["c1"] > short["c1"], "a longer half-life must keep a 30-day note fresher"


def test_apply_note_signals_uses_profile_superseded_weight():
    final = {"c1": 1.0}
    by_id = {"c1": {"note_id": "n1"}}
    recall._apply_note_signals(final, by_id, "how does chunking work",
                               {"n1": _signal(superseded=True)},
                               RetrievalProfile(superseded_weight=0.5))
    assert final["c1"] == 0.5


# ---------------------------------------------------------------------------
# retrieve() threads the profile end to end
# ---------------------------------------------------------------------------

def _candidates():
    return [
        {"chunk_id": "c1", "note_id": "n1", "text": "chunking splits on headings",
         "heading_path": "Chunker", "score": 0.9, "source_type": "note"},
        {"chunk_id": "c2", "note_id": "n2", "text": "unrelated prose about pooling",
         "heading_path": "Pooling", "score": 0.8, "source_type": "note"},
    ]


@pytest.fixture
def _hybrid(monkeypatch):
    monkeypatch.setattr(recall.qdrant_store, "search_hybrid",
                        lambda *a, **k: _candidates())
    monkeypatch.setattr(recall.qdrant_store, "search_exact", lambda *a, **k: [])


def test_retrieve_threads_profile_rerank_weight(_hybrid):
    out = recall.retrieve("how does chunking work", FakeEmbedder(), FakeReranker(),
                          ["s"], "t", sparse_embedder=_Sparse(),
                          profile=RetrievalProfile(rerank_weight_forced=0.0))
    assert out and "w=0.00" in out[0].why


def test_retrieve_threads_profile_to_dense_lane(_hybrid):
    dense = _RecordingEmbedder()
    recall.retrieve("how does chunking work", dense, FakeReranker(), ["s"], "t",
                    sparse_embedder=_Sparse(),
                    profile=RetrievalProfile(bge_query_prefix=True))
    assert dense.seen == [recall._BGE_QUERY_INSTRUCTION + "how does chunking work"]


def test_retrieve_without_profile_uses_default(_hybrid):
    """No profile argument => identical behaviour to an explicit default profile."""
    args = ("how does chunking work", FakeEmbedder(), FakeReranker(), ["s"], "t")
    implicit = recall.retrieve(*args, sparse_embedder=_Sparse())
    explicit = recall.retrieve(*args, sparse_embedder=_Sparse(),
                               profile=recall._default_profile())
    assert [(c.chunk_id, round(c.score, 9)) for c in implicit] == \
           [(c.chunk_id, round(c.score, 9)) for c in explicit]


def test_profile_is_immutable():
    p = RetrievalProfile()
    with pytest.raises(dataclasses.FrozenInstanceError):
        p.entity_boost = 0.9


class _RecordingEmbedder(FakeEmbedder):
    def __init__(self, dim=8):
        super().__init__(dim=dim)
        self.seen = []

    def embed(self, texts):
        self.seen.extend(texts)
        return super().embed(texts)


class _Sparse:
    def embed_sparse(self, texts):
        return [{"indices": [1], "values": [1.0]} for _ in texts]
