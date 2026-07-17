"""People extraction (names/emails → interaction records) + scope privacy.

Runs against the real bootstrapped store (SQLite lane via conftest) — the fake
one-off table approach breaks the moment people.py touches a real column.
Bodies are dedented before insert: people's code-block stripper treats
4-space-indented lines as code, which silently blanks triple-quoted fixtures.
"""
import textwrap
import uuid

import pytest

from lore import db
from lore import people


@pytest.fixture(scope="module")
def conn():
    c = db.connect()
    db.bootstrap_schema(c)
    return c


def _tenant():
    return "people-" + uuid.uuid4().hex[:10]


def add_note(conn, tenant, note_id, body, scope="scope-a", source="note",
             title="Note", created="2026-07-14T00:00:00+00:00"):
    conn.execute(
        """insert into notes(id, tenant_id, owner_id, scope_id, source_path, title,
                             source_type, body, created_at, updated_at)
           values(%s,%s,'test',%s,null,%s,%s,%s,%s,now())""",
        (note_id, tenant, scope, title, source, textwrap.dedent(body), created),
    )


def test_name_extraction_precision_skips_single_sentence_initial_and_code_blocks(conn):
    t = _tenant()
    add_note(
        conn, t, f"{t}-n1",
        """
        Today we spoke with Dana Whitmore about the migration. Dana Whitmore confirmed the plan.
        ```python
        Alice Walker should_not_be_indexed()
        ```
        Later the same plan referenced Dana Whitmore again.
        """,
    )

    people.extract_mentions(conn, t, f"{t}-n1")
    rows = people.list_people(conn, t, "scope-a")

    names = [row["name"] for row in rows]
    assert names == ["Dana Whitmore"]
    assert "Alice Walker" not in names   # fenced code never indexed
    assert "Today" not in names          # sentence-initial single word never a name
    assert "Later" not in names


def test_email_binding_normalizes_and_attaches_to_nearby_name(conn):
    t = _tenant()
    add_note(
        conn, t, f"{t}-n1",
        "Dana Whitmore <DANA.WHITMORE@Example.COM> approved the invite. "
        "The follow up went to Dana Whitmore.",
    )

    people.extract_mentions(conn, t, f"{t}-n1")
    rows = people.list_people(conn, t, "scope-a")

    assert rows[0]["name"] == "Dana Whitmore"
    assert rows[0]["emails"] == ["dana.whitmore@example.com"]


def test_scope_privacy_filters_mentions_before_people_are_visible(conn):
    t = _tenant()
    add_note(conn, t, f"{t}-n1",
             "Dana Whitmore met Alex Rivera. The recap mentions Dana Whitmore.",
             scope="scope-a")
    add_note(conn, t, f"{t}-n2",
             "Dana Whitmore met Jordan Lee. The recap mentions Dana Whitmore.",
             scope="scope-b")

    people.extract_mentions(conn, t, f"{t}-n1")
    people.extract_mentions(conn, t, f"{t}-n2")

    # THE invariant: a mention in scope B is invisible when reading scope A.
    visible = people.list_people(conn, t, "scope-a")
    dana = next(row for row in visible if row["name"] == "Dana Whitmore")
    assert dana["mention_count"] == 1
    detail = people.person_detail(conn, t, "scope-a", dana["id"])
    assert [item["note_id"] for item in detail["interactions"]] == [f"{t}-n1"]
    assert all(row["name"] != "Jordan Lee" for row in visible)


def test_merge_and_hide_support_dedupe_cleanup(conn):
    t = _tenant()
    add_note(conn, t, f"{t}-n1",
             "Dana Whitmore met alex. Dana Whitmore sent the memo.", scope="scope-a")
    add_note(conn, t, f"{t}-n2",
             "Dana Waverly <dana@example.com> replied with a decision.", scope="scope-a")
    people.extract_mentions(conn, t, f"{t}-n1")
    people.extract_mentions(conn, t, f"{t}-n2")
    rows = people.list_people(conn, t, "scope-a")
    keep = next(row for row in rows if row["name"] == "Dana Whitmore")
    merge = next(row for row in rows if row["emails"] == ["dana@example.com"])

    assert people.merge_people(conn, t, keep["id"], merge["id"])["ok"]
    merged = people.person_detail(conn, t, "scope-a", keep["id"])
    assert merged["person"]["mention_count"] == 2
    assert merged["person"]["emails"] == ["dana@example.com"]

    people.hide_person(conn, t, keep["id"])
    assert people.list_people(conn, t, "scope-a") == []


def test_tenant_isolation_keeps_same_names_separate(conn):
    t1, t2 = _tenant(), _tenant()
    add_note(conn, t1, f"{t1}-n1",
             "Dana Whitmore wrote the first tenant note. Dana Whitmore followed up.")
    add_note(conn, t2, f"{t2}-n1",
             "Dana Whitmore wrote the second tenant note. Dana Whitmore followed up.")

    people.extract_mentions(conn, t1, f"{t1}-n1")
    people.extract_mentions(conn, t2, f"{t2}-n1")

    a = people.list_people(conn, t1, "scope-a")
    b = people.list_people(conn, t2, "scope-a")
    assert len(a) == 1 and len(b) == 1
    assert a[0]["id"] != b[0]["id"]


def test_name_then_email_reuses_the_same_person(conn):
    """A name seen before any email must not split into an email-keyed twin."""
    t = _tenant()
    add_note(conn, t, f"{t}-n1",
             "Dana Whitmore drafted the proposal. Dana Whitmore sent it for review.")
    people.extract_mentions(conn, t, f"{t}-n1")
    add_note(conn, t, f"{t}-n2",
             "Reply from Dana Whitmore <dana@example.com> came in overnight.")
    people.extract_mentions(conn, t, f"{t}-n2")

    rows = people.list_people(conn, t, "scope-a")
    assert len(rows) == 1
    assert rows[0]["name"] == "Dana Whitmore"
    assert rows[0]["emails"] == ["dana@example.com"]
    assert rows[0]["mention_count"] == 2


def test_sentence_words_never_become_people(conn):
    """The live store's top 'person' was 'What' (44 mentions). Never again."""
    t = _tenant()
    add_note(conn, t, f"{t}-n1",
             "What happened with the deploy? What went wrong there. "
             "What is left to do. Web design needs a pass. Web fonts too. Web servers restarted. "
             "Built the demo with React Native and tested with Expo Go this week. "
             "New York trip planning continued. Met with Dana Whitmore about it.")
    people.extract_mentions(conn, t, f"{t}-n1")
    names = [p["name"] for p in people.list_people(conn, t, "scope-a")]
    assert "What" not in names
    assert "Web" not in names
    assert "New York" not in names        # 'New' is sentence furniture
    assert "React Native" not in names    # bare "with" is not a person cue
    assert "Expo Go" not in names
    assert "Dana Whitmore" in names


def test_note_titles_are_topics_not_people(conn):
    t = _tenant()
    add_note(conn, t, f"{t}-topic", "the knowledge graph description note body here",
             title="Wingman Knowledge")
    add_note(conn, t, f"{t}-n1",
             "Wingman Knowledge got restructured today. Priya Natarajan reviewed the change.")
    people.extract_mentions(conn, t, f"{t}-n1")
    names = [p["name"] for p in people.list_people(conn, t, "scope-a")]
    assert "Wingman Knowledge" not in names
    assert "Priya Natarajan" in names


def test_single_names_only_via_email_binding(conn):
    t = _tenant()
    add_note(conn, t, f"{t}-n1",
             "Talked to Priya about the rollout. Priya agreed. Priya will follow up. "
             "Also synced with Marcus <marcus@example.com> about hiring.")
    people.extract_mentions(conn, t, f"{t}-n1")
    rows = people.list_people(conn, t, "scope-a")
    names = {p["name"]: p for p in rows}
    assert "Priya" not in names          # recurrence lane is dead — no email, no single name
    assert "Marcus" in names             # email-bound single name survives
    assert names["Marcus"]["emails"] == ["marcus@example.com"]


def test_backfill_wipes_junk_from_older_extraction_version(conn):
    t = _tenant()
    add_note(conn, t, f"{t}-n1",
             "Weekly sync with Dana Whitmore covered the budget line and the hiring plan.")
    # Simulate junk from extraction v1 sitting in the store.
    people.ensure_schema(conn)
    conn.execute(
        "insert into people (id, tenant_id, name, emails, first_seen, last_seen, hidden)"
        " values ('junk1', %s, 'What', '', now(), now(), 0)", (t,))
    conn.execute(
        "insert into person_mentions (tenant_id, person_id, note_id, scope_id, source_type, evidence, created_at)"
        " values (%s, 'junk1', %s, 'scope-a', 'note', 'What happened', now())", (t, f"{t}-n1"))

    people.backfill_people(conn, tenant_id=t)

    names = [p["name"] for p in people.list_people(conn, t, "scope-a")]
    assert "What" not in names
    assert "Dana Whitmore" in names
