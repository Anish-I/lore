"""Dump-onboarding cluster (2026-07-21/22): C2 canonical vocabulary,
ingest dedup, ingest redaction, auto-apply stability gate."""
import datetime

from lore import db
from lore.classify import (
    _classify_prompt, canon_topic, classify_untagged, load_vocabulary,
    parse_classification,
)
from lore.embed import FakeEmbedder
from lore.index import index_document
from lore.sections import list_sections, propose_sections


def _conn():
    c = db.connect()
    db.bootstrap_schema(c)
    return c


def _insert_note(conn, tenant, nid, title, body):
    conn.execute(
        """insert into notes(id, tenant_id, owner_id, scope_id, title, body, updated_at)
           values(%s,%s,'me','private',%s,%s,now()) on conflict (id) do nothing""",
        (nid, tenant, title, body))


# ---------------------------------------------------------------------------
# C2: registry canonicalization
# ---------------------------------------------------------------------------

def test_canon_topic_collapses_slug_variants():
    tenant = "c2-canon"
    conn = _conn()
    assert canon_topic(conn, tenant, "Kalshi Bot") == "Kalshi Bot"
    # Same slug key in any surface form returns the FIRST registered canonical.
    assert canon_topic(conn, tenant, "kalshi-bot") == "Kalshi Bot"
    assert canon_topic(conn, tenant, "KalshiBot") == "Kalshi Bot"
    assert canon_topic(conn, tenant, "Kalshi Bots") == "Kalshi Bot"   # plural fold
    # Genuinely different key registers fresh.
    assert canon_topic(conn, tenant, "Weather Bot") == "Weather Bot"
    rows = conn.execute(
        "select count(*) from topic_registry where tenant_id=%s", (tenant,)).fetchone()
    assert rows[0] == 2


def test_vocabulary_registry_first_then_frequency():
    tenant = "c2-vocab"
    conn = _conn()
    canon_topic(conn, tenant, "Registered Topic")
    for i in range(3):
        _insert_note(conn, tenant, f"v-{i}", f"note {i}", "body")
        conn.execute(
            "insert into note_tags(note_id, tenant_id, tag, kind, source) "
            "values(%s,%s,'Legacy Topic','topic','llm')", (f"v-{i}", tenant))
    vocab = load_vocabulary(conn, tenant)
    assert vocab[0] == "Registered Topic"
    assert "Legacy Topic" in vocab


def test_prompt_carries_vocabulary_and_new_contract():
    p = _classify_prompt([(0, "t", "text")], ["Kalshi Bot", "Taxes"])
    assert "KNOWN TOPICS" in p and "- Kalshi Bot" in p and "NEW: Topic Name" in p
    # No vocabulary → no vocab block (fresh-tenant first batch).
    assert "KNOWN TOPICS" not in _classify_prompt([(0, "t", "text")], [])


def test_parse_strips_new_marker():
    out = parse_classification('[{"id":0,"tags":["a"],"topic":"NEW: Fresh Thing"}]')
    assert out[0]["topic"] == "Fresh Thing" and out[0]["is_new"] is True
    out = parse_classification('[{"id":0,"tags":[],"topic":"Kalshi Bot"}]')
    assert out[0]["topic"] == "Kalshi Bot" and out[0]["is_new"] is False


def test_classify_untagged_canonicalizes_across_batches():
    """Batch 2's variant naming lands on batch 1's canonical via the registry —
    the exact failure mode the cold-start sim measured (338 topics/400 notes)."""
    tenant = "c2-e2e"
    conn = _conn()
    for i in range(10):
        _insert_note(conn, tenant, f"n-{i}", f"note {i}", f"body {i}")
    calls = []

    def stub_llm(prompt):
        calls.append(prompt)
        # First batch (8 notes) names the canonical; second batch (2 notes)
        # returns a slug variant.
        if len(calls) == 1:
            return "[" + ",".join(
                f'{{"id":{i},"tags":["t"],"topic":"Energy Desk"}}' for i in range(8)) + "]"
        return '[{"id":0,"tags":["t"],"topic":"energy-desk"},' \
               '{"id":1,"tags":["t"],"topic":"NEW: energy desks"}]'

    stats = classify_untagged(conn, tenant, llm_call=stub_llm)
    assert stats["llmTagged"] == 10
    topics = {t for (t,) in conn.execute(
        "select distinct tag from note_tags where tenant_id=%s and kind='topic'",
        (tenant,)).fetchall()}
    assert topics == {"Energy Desk"}                     # ONE canonical, not three
    # Batch 2's prompt carried batch 1's vocabulary.
    assert "Energy Desk" in calls[1]


# ---------------------------------------------------------------------------
# Ingest hygiene: dedup + redaction
# ---------------------------------------------------------------------------

def test_ingest_skips_exact_duplicates():
    tenant = "hyg-dup"
    conn = _conn()
    body = "# Note\n\nThe adjuster completed the inspection and filed the report today. " * 4
    k1 = index_document(source_id="dump-orig", title="Original", text=body,
                        scope_id="s", owner_id="o", tenant_id=tenant,
                        embedder=FakeEmbedder(), conn=conn)
    k2 = index_document(source_id="dump-copy", title="Copy", text=body,
                        scope_id="s", owner_id="o", tenant_id=tenant,
                        embedder=FakeEmbedder(), conn=conn)
    assert k1 > 0 and k2 == 0
    chunks = {nid for (nid,) in conn.execute(
        "select distinct note_id from chunks where note_id in ('dump-orig','dump-copy')").fetchall()}
    assert chunks == {"dump-orig"}
    # The copy's body is still stored and readable.
    row = conn.execute("select body from notes where id='dump-copy'").fetchone()
    assert row and "adjuster" in row[0]
    # Re-indexing the ORIGINAL id is not self-deduped.
    assert index_document(source_id="dump-orig", title="Original", text=body,
                          scope_id="s", owner_id="o", tenant_id=tenant,
                          embedder=FakeEmbedder(), conn=conn) > 0


def test_ingest_redacts_secrets_in_stored_body_and_chunks():
    tenant = "hyg-redact"
    conn = _conn()
    secret = "AKIA" + "A" * 16
    body = ("# Config notes\n\nDeploy uses key " + secret +
            " for the S3 sync and the rest of this paragraph exists to clear "
            "the low-content chunk gate with plenty of ordinary prose around it.")
    index_document(source_id="sec-1", title="Config", text=body,
                   scope_id="s", owner_id="o", tenant_id=tenant,
                   embedder=FakeEmbedder(), conn=conn)
    stored = conn.execute("select body from notes where id='sec-1'").fetchone()[0]
    assert secret not in stored
    for (text,) in conn.execute(
            "select text from chunks where note_id='sec-1'").fetchall():
        assert secret not in text


# ---------------------------------------------------------------------------
# Auto-apply stability gate
# ---------------------------------------------------------------------------

def test_sections_expose_topic_first_seen():
    tenant = "gate-t"
    conn = _conn()
    for i in range(5):
        _insert_note(conn, tenant, f"gatefresh-{i}", f"g {i}", "body")
        conn.execute("update notes set source_path=%s where id=%s",
                     (f"/lib/gatefresh-{i}.md", f"gatefresh-{i}"))
        conn.execute(
            "insert into note_tags(note_id, tenant_id, tag, kind, source) "
            "values(%s,%s,'Fresh Topic','topic','llm')", (f"gatefresh-{i}", tenant))
    canon_topic(conn, tenant, "Fresh Topic")             # registered => young
    propose_sections(conn, tenant, threshold=5)
    secs = list_sections(conn, tenant)
    assert len(secs) == 1
    fs = secs[0]["topic_first_seen"]
    assert fs is not None
    age = datetime.datetime.now(datetime.timezone.utc) - \
        datetime.datetime.fromisoformat(fs).replace(tzinfo=datetime.timezone.utc)
    assert age.total_seconds() < 3600                    # clearly "young"


def test_unregistered_topic_first_seen_is_none():
    tenant = "gate-old"
    conn = _conn()
    for i in range(5):
        _insert_note(conn, tenant, f"gateold-{i}", f"o {i}", "body")
        conn.execute("update notes set source_path=%s where id=%s",
                     (f"/lib/gateold-{i}.md", f"gateold-{i}"))
        conn.execute(
            "insert into note_tags(note_id, tenant_id, tag, kind, source) "
            "values(%s,%s,'Pre Registry Topic','topic','llm')", (f"gateold-{i}", tenant))
    propose_sections(conn, tenant, threshold=5)
    secs = list_sections(conn, tenant)
    assert secs[0]["topic_first_seen"] is None           # grandfathered as stable
