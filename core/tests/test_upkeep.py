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


def test_upkeep_is_add_only_across_runs():
    """ADD-only invariant (M1-C): a later upkeep run must never rewrite what a
    prior run put in a topic note — the first entry's bytes and position are
    identical after run 2 appends a new entry."""
    conn = _conn()
    db.bootstrap_schema(conn)
    topic_id = f"topic:{_TENANT}:addonly"

    _insert_note(conn, "upkeep-ao-2026-03-01", "2026-03-01",
                 "# 2026-03-01\n\nFirst decision about [[AddOnly]].\n")
    run_upkeep(conn, FakeEmbedder(), _TENANT, scope=_SCOPE)
    body1 = conn.execute("select body from notes where id=%s", (topic_id,)).fetchone()[0]

    _insert_note(conn, "upkeep-ao-2026-03-05", "2026-03-05",
                 "# 2026-03-05\n\nSecond, CONTRADICTING decision about [[AddOnly]].\n")
    run_upkeep(conn, FakeEmbedder(), _TENANT, scope=_SCOPE)
    body2 = conn.execute("select body from notes where id=%s", (topic_id,)).fetchone()[0]

    # Everything run 1 wrote is still there, byte-for-byte, at the same offset.
    assert body2.startswith(body1.rstrip()), "Prior topic content was rewritten — ADD-only violated"
    assert "First decision" in body2 and "CONTRADICTING decision" in body2


def test_upkeep_preserves_hand_edits():
    """A user's manual edit to a topic body survives the next fold verbatim."""
    conn = _conn()
    db.bootstrap_schema(conn)
    topic_id = f"topic:{_TENANT}:handedit"

    _insert_note(conn, "upkeep-he-2026-04-01", "2026-04-01",
                 "# 2026-04-01\n\nAuto entry about [[HandEdit]].\n")
    run_upkeep(conn, FakeEmbedder(), _TENANT, scope=_SCOPE)

    hand = "\n\nMY OWN NOTES: do not touch this line.\n"
    body = conn.execute("select body from notes where id=%s", (topic_id,)).fetchone()[0]
    conn.execute("update notes set body=%s where id=%s", (body + hand, topic_id))

    _insert_note(conn, "upkeep-he-2026-04-02", "2026-04-02",
                 "# 2026-04-02\n\nAnother auto entry about [[HandEdit]].\n")
    run_upkeep(conn, FakeEmbedder(), _TENANT, scope=_SCOPE)
    body2 = conn.execute("select body from notes where id=%s", (topic_id,)).fetchone()[0]

    assert "MY OWN NOTES: do not touch this line." in body2
    assert "Another auto entry" in body2


def test_append_entries_contract():
    """append_entries is ADD-only by construction: for any input, the output
    starts with existing.rstrip() byte-for-byte, blocks land newest-first, and
    the AppendOnlyViolation tripwire is exported for run_upkeep's fail-loud
    handling of future refactors."""
    from lore.upkeep import append_entries, AppendOnlyViolation

    assert issubclass(AppendOnlyViolation, Exception)

    cases = [
        "# Topic\n\nexisting entry\n",
        "",                      # brand-new topic
        "# T\n\ntrailing ws \n\n\n",
        "# Tópic — unicode ± entry\n",
    ]
    blocks = [("2026-01-02", "\n## older\nold block\n"), ("2026-01-05", "\n## newer\nnew block\n")]
    for existing in cases:
        out = append_entries(existing, list(blocks))
        assert out.startswith(existing.rstrip()), f"contract broken for {existing!r}"
        # Newest-first ordering of the appended blocks.
        assert out.index("## newer") < out.index("## older")


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
