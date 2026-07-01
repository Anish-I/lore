"""Tests for the optional cloud-LLM relation enrichment (origin='llm')."""
import json
from lore import db
from lore.llm_relations import parse_relations, enrich_relations

_TENANT = "llm-rel-test"


def test_parse_relations_validates_and_guards():
    cmap = {"wingman architecture": "n-wing", "composio": "n-comp"}
    raw = json.dumps([
        {"target": "Wingman Architecture", "relation": "depends_on", "confidence": 0.8, "evidence": "built on it"},
        {"target": "Ghost Note", "relation": "depends_on", "confidence": 0.9, "evidence": "x"},   # unknown target → drop
        {"target": "Composio", "relation": "teleports_to", "confidence": 0.9, "evidence": "x"},    # bad relation → drop
        {"target": "Composio", "relation": "supersedes", "confidence": 0.3, "evidence": "x"},      # below threshold → drop
        {"target": "Composio", "relation": "supersedes", "confidence": 0.9, "evidence": ""},        # no evidence → drop
    ])
    out = parse_relations(raw, cmap, min_conf=0.55)
    assert out == [("n-wing", "depends_on", 0.8, "built on it")]


def _seed_notes(conn):
    db.bootstrap_schema(conn)
    notes = [
        ("llm-src", "Migration Plan", "We moved the tool layer; the new design replaces Composio entirely."),
        ("llm-comp", "Composio", "The tool execution engine."),
        ("llm-other", "Wingman Architecture", "The bot."),
    ]
    for nid, title, body in notes:
        conn.execute(
            "insert into notes(id,tenant_id,owner_id,scope_id,title,body,updated_at) "
            "values(%s,%s,'me','private',%s,%s,now()) on conflict (id) do update set body=excluded.body, title=excluded.title",
            (nid, _TENANT, title, body))


def test_enrich_creates_llm_edges_and_respects_stronger_heuristic():
    conn = db.connect()
    _seed_notes(conn)
    conn.execute("delete from edges where tenant_id=%s and src_note_id='llm-src'", (_TENANT,))  # clean slate

    # Mock LLM: infers 'Migration Plan supersedes Composio' + a hallucinated target (must be dropped).
    def fake_llm(prompt):
        return json.dumps([
            {"target": "Composio", "relation": "supersedes", "confidence": 0.82, "evidence": "replaces Composio entirely"},
            {"target": "Nonexistent Tool", "relation": "supersedes", "confidence": 0.95, "evidence": "x"},
        ])

    enrich_relations(conn, _TENANT, llm_call=fake_llm, limit=10, force=True)
    # the inferred edge exists with origin='llm'
    row = conn.execute(
        "select kind, weight, origin from edges "
        "where tenant_id=%s and src_note_id='llm-src' and dst_note_id='llm-comp'", (_TENANT,)).fetchone()
    assert row is not None and row[0] == "supersedes" and row[2] == "llm"
    # hallucinated target created no node/edge
    assert conn.execute("select count(*) from edges where tenant_id=%s and dst_note_id='Nonexistent Tool'", (_TENANT,)).fetchone()[0] == 0

    # A stronger heuristic edge must NOT be overwritten by a weaker LLM edge.
    conn.execute("delete from edges where tenant_id=%s and src_note_id='llm-src'", (_TENANT,))
    conn.execute("insert into edges(tenant_id,src_note_id,dst_note_id,kind,weight,evidence,origin) "
                 "values(%s,'llm-src','llm-comp','supersedes',0.95,'heuristic','index')", (_TENANT,))
    enrich_relations(conn, _TENANT, llm_call=fake_llm, limit=10, force=True)
    row = conn.execute("select weight, origin from edges where tenant_id=%s "
                       "and src_note_id='llm-src' and dst_note_id='llm-comp'", (_TENANT,)).fetchone()
    assert round(float(row[0]), 2) == 0.95 and row[1] == "index", "stronger heuristic edge must survive"


def test_enrich_caches_by_body_hash():
    conn = db.connect()
    _seed_notes(conn)
    calls = []
    def counting_llm(prompt):
        calls.append(1)
        return "[]"
    enrich_relations(conn, _TENANT, llm_call=counting_llm, limit=10, force=True)
    first = len(calls)
    assert first >= 1
    # second run without force: unchanged bodies are cached → no new LLM calls
    enrich_relations(conn, _TENANT, llm_call=counting_llm, limit=10)
    assert len(calls) == first, "cached notes must not be re-sent to the LLM"
