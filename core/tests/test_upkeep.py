"""Tests for upkeep.run_upkeep — converting ephemeral date/session notes INTO topic nodes.

The contract: an ephemeral date note is *folded* into its topic notes (its content becomes
a dated entry under each topic) and the date note itself is then *deleted* from Lore.  Re-runs
are idempotent (re-ingested date notes never duplicate content), and non-ephemeral notes are
left untouched.
"""
from lore import db
from lore.embed import FakeEmbedder
from lore.upkeep import run_upkeep

_TENANT = "upkeep-test-tenant"
_SCOPE = "private"


def _conn():
    return db.connect()


def _insert_note(conn, source_id, title, body, source_type="note"):
    """Insert a bare note row (no chunks/embeddings) for upkeep testing."""
    conn.execute(
        """insert into notes(id, tenant_id, owner_id, scope_id, title, source_type, body, updated_at)
           values(%s,%s,'me',%s,%s,%s,%s,now())
           on conflict (id) do update
           set title=excluded.title, source_type=excluded.source_type, body=excluded.body,
               updated_at=now()""",
        (source_id, _TENANT, _SCOPE, title, source_type, body),
    )


def test_upkeep_folds_date_note_into_topic():
    """A date-titled note with a [[Foo]] wikilink is converted: a Foo topic node is created
    with the note's content folded in, and the original date note is deleted."""
    conn = _conn()
    db.bootstrap_schema(conn)

    note_id = "upkeep-date-note-2026-01-01"
    _insert_note(
        conn, note_id, "2026-01-01",
        "# 2026-01-01\n\nWorked on [[Foo]] today. Also checked [[Bar]].\n",
    )

    stats = run_upkeep(conn, FakeEmbedder(), _TENANT, scope=_SCOPE)

    assert stats["dateNotes"] >= 1, f"Expected dateNotes >= 1, got {stats}"
    assert stats["topics"] >= 1, f"Expected topics >= 1, got {stats}"
    assert stats["folded"] >= 1, f"Expected folded >= 1, got {stats}"
    assert stats["deleted"] >= 1, f"Expected the date note to be deleted, got {stats}"

    # The Foo topic note exists, is a 'topic', and contains the folded content + source anchor.
    row = conn.execute(
        "select id, source_type, body from notes where id=%s",
        (f"topic:{_TENANT}:foo",),
    ).fetchone()
    assert row is not None, "Topic note 'topic:<tenant>:foo' was not created"
    assert row[1] == "topic", f"Expected source_type='topic', got '{row[1]}'"
    assert f"<!-- lore:from {note_id} -->" in (row[2] or ""), "Source anchor not folded into topic body"
    assert "Worked on" in (row[2] or ""), "Date note content not folded into topic body"

    # The original date note is gone (converted away).
    gone = conn.execute("select id from notes where id=%s", (note_id,)).fetchone()
    assert gone is None, "Date note should be deleted after conversion"


def test_upkeep_is_idempotent():
    """Re-folding the SAME date note (e.g. re-ingested from disk) must not duplicate content."""
    conn = _conn()
    note_id = "upkeep-idempotent-2026-02-01"
    body = "# 2026-02-01\n\nReviewed [[Baz]] architecture.\n"
    topic_id = f"topic:{_TENANT}:baz"

    _insert_note(conn, note_id, "2026-02-01", body)
    run_upkeep(conn, FakeEmbedder(), _TENANT, scope=_SCOPE)
    body1 = conn.execute("select body from notes where id=%s", (topic_id,)).fetchone()[0]

    # Simulate the file being re-ingested (same id reappears), then re-run upkeep.
    _insert_note(conn, note_id, "2026-02-01", body)
    run_upkeep(conn, FakeEmbedder(), _TENANT, scope=_SCOPE)
    body2 = conn.execute("select body from notes where id=%s", (topic_id,)).fetchone()[0]

    # The anchor must appear exactly once — no duplicated entry across runs.
    anchor = f"<!-- lore:from {note_id} -->"
    assert body2.count(anchor) == 1, f"Anchor duplicated across runs: {body2.count(anchor)}"
    assert body1.count(anchor) == 1
    # And the re-ingested date note is deleted again.
    assert conn.execute("select id from notes where id=%s", (note_id,)).fetchone() is None


def test_upkeep_skips_non_ephemeral_notes():
    """Regular notes (not date-named, not session) must be left untouched — never deleted."""
    conn = _conn()
    note_id = "upkeep-regular-note"
    _insert_note(
        conn, note_id, "Project Overview",
        "# Project Overview\n\nRegular project note about [[Foo]].\n",
    )

    run_upkeep(conn, FakeEmbedder(), _TENANT, scope=_SCOPE)

    still_there = conn.execute("select id from notes where id=%s", (note_id,)).fetchone()
    assert still_there is not None, "Regular note must not be deleted by upkeep"
