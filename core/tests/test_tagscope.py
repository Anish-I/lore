"""Tag-scoped retrieval: query→tag matching + the bounded ranking boost.

Contract (tagscope.py + recall.TAG_BOOST): deterministic matching (exact
token, plural fold, >=5-char prefix extension, multi-word phrase; <3-char
tags never match), hits capped at 3, applied as a BOOST inside
_apply_note_signals — never a filter.
"""
from lore import db
from lore.recall import TAG_BOOST, _apply_note_signals
from lore.tagscope import (
    load_tag_vocabulary, match_tags, tag_hits_by_note, tag_note_ids,
)

_SCOPE = "private"


def test_match_tags_rules():
    tags = ["dogs", "algebra", "crypto-bots", "ai", "art", "elections", "math"]
    q = "I am looking for algebraic terms in the mathematics of dogs"
    got = match_tags(tags, q)
    assert "dogs" in got                    # exact token
    assert "algebra" in got                 # prefix extension (algebraic)
    assert "math" not in got                # 4-char tag: no prefix lane (mathematics)
    assert "ai" not in got                  # too short, never matches
    assert "art" not in got                 # not in query as a token
    assert "crypto-bots" not in got

    # plural fold both directions
    assert match_tags(["dog"], "my dogs are loud") == {"dog"}
    assert match_tags(["elections"], "the election results") == {"elections"}
    # multi-word tag as dash-joined phrase
    assert match_tags(["crypto-bots"], "status of the crypto bots fleet") == {"crypto-bots"}
    # multi-word last-word plural fold, both directions (live Ellington gap:
    # topic "Dog Licenses" must match "renew her dog license")
    assert match_tags(["dog-licenses"], "renew her dog license today") == {"dog-licenses"}
    assert match_tags(["dog-license"], "the dog licenses are ready") == {"dog-license"}
    # empty / no-op safety
    assert match_tags(tags, "") == set()
    assert match_tags([], "dogs") == set()


def test_tag_hits_capped_and_scoped():
    conn = db.connect()
    db.bootstrap_schema(conn)
    tenant = "tagscope-hits"
    conn.execute(
        """insert into notes(id, tenant_id, owner_id, scope_id, title, body,
                             source_type, updated_at)
           values('ts-1',%s,'me',%s,'t','b','note',now()) on conflict (id) do nothing""",
        (tenant, _SCOPE))
    for tag, kind in (("dogs", "tag"), ("algebra", "tag"), ("geometry", "tag"),
                      ("calculus", "tag"), ("Math Notes", "topic")):
        conn.execute(
            "insert into note_tags(note_id, tenant_id, tag, kind, source) "
            "values('ts-1',%s,%s,%s,'llm') on conflict do nothing", (tenant, tag, kind))

    vocab = load_tag_vocabulary(conn, tenant)
    assert set(vocab) == {"dogs", "algebra", "geometry", "calculus", "Math Notes"}

    matched = {"dogs", "algebra", "geometry", "calculus"}
    hits = tag_hits_by_note(conn, tenant, matched, ["ts-1", "missing"])
    assert hits == {"ts-1": 3}              # 4 matched tags on the note, capped at 3

    assert tag_hits_by_note(conn, tenant, set(), ["ts-1"]) == {}
    assert tag_hits_by_note(conn, tenant, matched, []) == {}


def test_tag_note_ids_ordering_and_scope():
    conn = db.connect()
    db.bootstrap_schema(conn)
    tenant = "tagscope-seed"

    def note(nid, scope=_SCOPE):
        conn.execute(
            """insert into notes(id, tenant_id, owner_id, scope_id, title, body,
                                 source_type, updated_at)
               values(%s,%s,'me',%s,'t','b','note',now()) on conflict (id) do nothing""",
            (nid, tenant, scope))

    def tag(nid, t):
        conn.execute(
            "insert into note_tags(note_id, tenant_id, tag, kind, source) "
            "values(%s,%s,%s,'tag','llm') on conflict do nothing", (nid, tenant, t))

    note("tsd-both"); tag("tsd-both", "dogs"); tag("tsd-both", "algebra")
    note("tsd-one"); tag("tsd-one", "dogs")
    note("tsd-foreign", scope="team:x"); tag("tsd-foreign", "dogs"); tag("tsd-foreign", "algebra")

    ids = tag_note_ids(conn, tenant, {"dogs", "algebra"}, [_SCOPE])
    assert ids[0] == "tsd-both"                 # two matched tags beats one
    assert "tsd-one" in ids
    assert "tsd-foreign" not in ids             # ACL: out-of-scope never seeds
    assert tag_note_ids(conn, tenant, set(), [_SCOPE]) == []
    assert tag_note_ids(conn, tenant, {"dogs"}, []) == []


def test_seed_injection_rescues_vector_miss():
    """A note whose text shares no tokens with the query (invisible to the fake
    dense lane and the lexical lane) still reaches results when tag-seeded —
    the whole point of the 2026-07-29 candidate-injection fix."""
    from lore.embed import FakeEmbedder
    from lore.index import index_document
    from lore.recall import retrieve
    from lore.rerank import FakeReranker

    conn = db.connect()
    db.bootstrap_schema(conn)
    tenant = "tagscope-inject"
    emb = FakeEmbedder()
    # target: token-disjoint from the query (and long enough to survive the
    # chunker's low-content gate), but tagged
    index_document(source_id="inj-target", title="Canine registry fees",
                   text=("Canine registry window opens June first and runs through "
                         "the month. Owners pay eight dollars per animal at the town "
                         "office or by mail using the enclosed form. Late filings add "
                         "one dollar per month per animal."),
                   scope_id=_SCOPE, owner_id="me", tenant_id=tenant,
                   embedder=emb, conn=conn, source_type="note")
    conn.execute(
        "insert into note_tags(note_id, tenant_id, tag, kind, source) "
        "values('inj-target',%s,'dog-licenses','tag','llm') on conflict do nothing",
        (tenant,))
    # filler notes that lexically shadow the query
    for i in range(30):
        index_document(source_id=f"inj-fill-{i}", title=f"minutes {i}",
                       text=f"the committee discussed the dog park and license plates item {i}",
                       scope_id=_SCOPE, owner_id="me", tenant_id=tenant,
                       embedder=emb, conn=conn, source_type="note")

    query = "what does a dog license renewal cost?"
    with_seeds = retrieve(query, emb, FakeReranker(), [_SCOPE], tenant,
                          limit=30, seed_note_ids=["inj-target"])
    assert any(h.note_id == "inj-target" for h in with_seeds)


def test_tag_hits_boost_ranking_not_filter():
    final = {"c1": 1.0, "c2": 1.0}
    by_id = {"c1": {"note_id": "n1"}, "c2": {"note_id": "n2"}}
    signals = {
        "n1": {"memory_type": "durable", "tag_hits": 2},
        "n2": {"memory_type": "durable", "tag_hits": 0},
    }
    _apply_note_signals(final, by_id, "algebra dogs", signals)
    assert final["c1"] > final["c2"]                       # boosted above
    assert abs(final["c1"] - (1.0 + TAG_BOOST * 2)) < 1e-9
    assert final["c2"] == 1.0                              # unmatched: untouched, never dropped
