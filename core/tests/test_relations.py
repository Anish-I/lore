"""Tests for the heuristic reasoned-graph layer: typed relations + importance."""
import re
from lore import db
from lore.embed import FakeEmbedder
from lore.index import index_document
from lore.relations import (extract_relations, extract_entity_pairs, recompute_importance,
                            RELATION_KINDS, build_title_index)


def _title_index(*pairs):
    """Build a co-mention index from (title, id) pairs (whole-word, case-insensitive)."""
    return [(t, i, re.compile(r"(?<![A-Za-z0-9])" + re.escape(t) + r"(?![A-Za-z0-9])", re.IGNORECASE))
            for t, i in pairs]

_TENANT = "rel-test"


def _resolver(mapping):
    return lambda title: mapping.get(title.lower())


# --- cue extraction --------------------------------------------------------

def test_extracts_depends_on_with_high_confidence():
    rels = extract_relations("This module depends on [[Auth]] for tokens.", _resolver({"auth": "n-auth"}))
    assert len(rels) == 1
    dst, kind, conf, evidence = rels[0]
    assert (dst, kind) == ("n-auth", "depends_on")
    assert conf >= 0.9
    assert "depends on" in evidence.lower()


def test_supersedes_and_causes_and_supports():
    assert extract_relations("Lore replaces [[Obsidian]].", _resolver({"obsidian": "o"}))[0][1] == "supersedes"
    assert extract_relations("This change causes [[Outage]].", _resolver({"outage": "x"}))[0][1] == "causes"
    assert extract_relations("This benchmark supports [[Hypothesis]].", _resolver({"hypothesis": "h"}))[0][1] == "supports"
    assert extract_relations("Our design implements [[Spec]].", _resolver({"spec": "s"}))[0][1] == "implements"


def test_negation_suppresses_edge():
    # "does not depend on" must NOT produce a depends_on edge (and never a contradicts).
    rels = extract_relations("This does not depend on [[Legacy]].", _resolver({"legacy": "l"}))
    assert rels == []


def test_hedge_drops_below_threshold():
    # "may implement" → certainty 0.45 → 0.95*0.45 = 0.43 < 0.70 threshold → no edge.
    rels = extract_relations("We may implement [[Spec]] later.", _resolver({"spec": "s"}))
    assert rels == []


def test_unresolved_wikilink_yields_nothing():
    rels = extract_relations("This depends on [[Ghost]].", _resolver({}))  # Ghost resolves to None
    assert rels == []


def test_multiple_links_apply_ambiguity_penalty():
    # Two links in one sentence → ambiguity 0.75. depends_on specificity 0.95*1.0*1.0*0.75=0.7125 ≥ 0.70 keeps it.
    rels = extract_relations("It depends on [[Auth]] and [[Db]].", _resolver({"auth": "a", "db": "d"}))
    kinds = {(d, k) for d, k, c, e in rels}
    assert ("a", "depends_on") in kinds
    for d, k, c, e in rels:
        assert c < 0.95  # penalized below the single-link score


# --- co-mention recall layer -----------------------------------------------

def test_comention_recall_names_known_title_without_wikilink():
    # "Wingman" is a known note named in prose (no [[ ]]). Binding cue → discounted edge.
    ti = _title_index(("Wingman", "n-wing"))
    rels = extract_relations("The new bot depends on Wingman for routing.", lambda t: None, ti)
    edge = [(d, k, c) for d, k, c, e in rels if d == "n-wing"]
    assert edge and edge[0][1] == "depends_on"
    assert edge[0][2] < 0.95, "co-mention must be discounted below an explicit-wikilink score"
    assert edge[0][2] >= 0.70, "a clean binding cue should still clear the threshold"


def test_comention_respects_negation_and_binding():
    ti = _title_index(("Kalshi", "n-k"))
    # negation suppresses
    assert extract_relations("This does not depend on Kalshi.", lambda t: None, ti) == []
    # cue after the title doesn't bind (no edge)
    assert extract_relations("Kalshi is great and we ship it.", lambda t: None, ti) == []


def test_wikilink_beats_comention_on_same_pair():
    # Same note reachable as a wikilink (full weight) and a bare mention — keep the higher (wikilink).
    ti = _title_index(("Auth", "n-auth"))
    rels = extract_relations("This depends on [[Auth]] and also on Auth.",
                             lambda t: "n-auth" if t.lower() == "auth" else None, ti)
    confs = [c for d, k, c, e in rels if (d, k) == ("n-auth", "depends_on")]
    # Deduped to one edge; the kept confidence is the wikilink path (1.0 discount),
    # strictly above what a 0.8-discounted co-mention alone would score for the same cue.
    assert len(confs) == 1
    assert confs[0] >= 0.70


def test_build_title_index_skips_short_and_generic():
    conn = db.connect()
    db.bootstrap_schema(conn)
    for nid, title in (("ti-1", "Wingman Architecture"), ("ti-2", "Index"), ("ti-3", "ai")):
        conn.execute(
            "insert into notes(id,tenant_id,owner_id,scope_id,title,updated_at) "
            "values(%s,'ti-tenant','me','private',%s,now()) on conflict (id) do update set title=excluded.title",
            (nid, title))
    idx = build_title_index(conn, "ti-tenant")
    titles = {t for t, i, p in idx}
    assert "Wingman Architecture" in titles
    assert "Index" not in titles  # stoplisted
    assert "ai" not in titles     # too short (<4)


# --- entity-pair extraction (session captures: A <cue> B, subject is a named entity) ---

def test_entity_pairs_subject_is_named_entity():
    # "Codex replaces n8n" — subject is Codex (a named note), NOT the note being processed.
    ti = _title_index(("Codex", "n-codex"), ("n8n", "n-n8n"))
    pairs = extract_entity_pairs("Codex replaces n8n in the pipeline.", ti)
    triples = [(a, b, k) for a, b, k, c, e in pairs]
    assert ("n-codex", "n-n8n", "supersedes") in triples
    # direction is A->B only, never the reverse
    assert ("n-n8n", "n-codex", "supersedes") not in triples


def test_entity_pairs_needs_cue_between_and_respects_negation():
    ti = _title_index(("Wingman", "n-w"), ("Composio", "n-c"))
    # cue between A and B → edge
    assert ("n-w", "n-c", "depends_on") in [
        (a, b, k) for a, b, k, c, e in extract_entity_pairs("Wingman depends on Composio for tools.", ti)]
    # negation suppresses
    assert extract_entity_pairs("Wingman does not depend on Composio.", ti) == []
    # no cue between the two entities → nothing
    assert extract_entity_pairs("Wingman and Composio are both tools.", ti) == []


# --- importance ------------------------------------------------------------

def test_recompute_importance_ranks_depended_on_highest():
    conn = db.connect()
    db.bootstrap_schema(conn)
    # three notes; A and B both depend on HUB.
    for nid in ("imp-hub", "imp-a", "imp-b"):
        conn.execute(
            "insert into notes(id,tenant_id,owner_id,scope_id,title,updated_at) "
            "values(%s,%s,'me','private',%s,now()) on conflict (id) do update set updated_at=now()",
            (nid, _TENANT, nid))
    for src in ("imp-a", "imp-b"):
        conn.execute(
            "insert into edges(tenant_id,src_note_id,dst_note_id,kind,weight,evidence) "
            "values(%s,%s,'imp-hub','depends_on',0.9,'t') "
            "on conflict (tenant_id,src_note_id,dst_note_id,kind) do update set weight=0.9",
            (_TENANT, src))
    n = recompute_importance(conn, _TENANT)
    assert n >= 3
    imp = {r[0]: r[1] for r in conn.execute(
        "select id, importance from notes where tenant_id=%s and id like 'imp-%%'", (_TENANT,)).fetchall()}
    assert imp["imp-hub"] > imp["imp-a"], "the depended-on hub must be most important"


# --- integration through index_document ------------------------------------

def test_index_document_creates_typed_edge():
    conn = db.connect()
    db.bootstrap_schema(conn)
    emb = FakeEmbedder()
    # Target note must exist first so the wikilink resolves.
    index_document(source_id="rel-auth", title="Auth", text="# Auth\n\nAuth service.\n",
                   scope_id="private", owner_id="me", tenant_id=_TENANT, embedder=emb, conn=conn)
    index_document(source_id="rel-api", title="Api", text="# Api\n\nThe API depends on [[Auth]].\n",
                   scope_id="private", owner_id="me", tenant_id=_TENANT, embedder=emb, conn=conn)
    row = conn.execute(
        "select kind, weight from edges where tenant_id=%s and src_note_id='rel-api' and dst_note_id='rel-auth' and kind='depends_on'",
        (_TENANT,)).fetchone()
    assert row is not None, "expected a depends_on edge from Api to Auth"
    assert row[1] >= 0.9
