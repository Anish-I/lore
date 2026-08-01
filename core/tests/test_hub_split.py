"""Hub-topic splitting: numeric trigger + LLM sub-topic reassignment.

Contract under test (hub_split.py): a topic crossing BOTH numeric bars is a
hub; its notes are re-classified batch-wise with their stored tags in the
prompt; a note moves only when the model names a genuinely different topic;
the hub name survives as a kind='tag' row; junk-roled notes are invisible;
no provider -> no changes.
"""
import json

from lore import db
from lore.hub_split import find_hubs, parse_split, split_hubs, _split_prompt

_SCOPE = "private"


def _conn():
    c = db.connect()
    db.bootstrap_schema(c)
    return c


def _note(conn, tenant, nid, title="t", body="b"):
    conn.execute(
        """insert into notes(id, tenant_id, owner_id, scope_id, title, body,
                             source_type, updated_at)
           values(%s,%s,'me',%s,%s,%s,'note',now()) on conflict (id) do nothing""",
        (nid, tenant, _SCOPE, title, body))


def _tag_row(conn, tenant, nid, tag, kind, source="llm"):
    conn.execute(
        "insert into note_tags(note_id, tenant_id, tag, kind, source) "
        "values(%s,%s,%s,%s,%s) on conflict do nothing",
        (nid, tenant, tag, kind, source))


def _seed(conn, tenant, topic, n, prefix, tags=(), role=None):
    for i in range(n):
        nid = f"{prefix}-{i}"
        _note(conn, tenant, nid, f"{prefix} {i}", f"body of {prefix} {i}")
        _tag_row(conn, tenant, nid, topic, "topic")
        for t in tags:
            _tag_row(conn, tenant, nid, t, "tag")
        if role:
            _tag_row(conn, tenant, nid, role, "role")


def _topic_of(conn, tenant, nid):
    row = conn.execute(
        "select tag, source from note_tags where tenant_id=%s and note_id=%s and kind='topic'",
        (tenant, nid)).fetchone()
    return row


def test_find_hubs_numeric_trigger():
    tenant = "hub-trigger"
    conn = _conn()
    _seed(conn, tenant, "Everything", 12, "ev")          # 12/16 = 75% share
    _seed(conn, tenant, "Small Topic", 4, "sm")
    # junk-roled notes are invisible to the trigger
    _seed(conn, tenant, "Junk Pile", 20, "jk", role="bulk")

    hubs = find_hubs(conn, tenant, share=0.5, min_notes=10)
    assert hubs == [("Everything", 12)]
    # bars are AND-ed: share met but absolute count not
    assert find_hubs(conn, tenant, share=0.5, min_notes=13) == []
    # share not met
    assert find_hubs(conn, tenant, share=0.9, min_notes=5) == []


def test_split_moves_notes_and_preserves_hub_as_tag():
    tenant = "hub-move"
    conn = _conn()
    _seed(conn, tenant, "Everything", 12, "mv", tags=("deeds", "land"))
    _seed(conn, tenant, "Dog Licenses", 4, "mvdg")

    def fake_llm(prompt):
        assert 'The topic "Everything"' in prompt
        assert "tags=[deeds, land]" in prompt          # stored tags reach the model
        assert "STRICT JSON" in prompt
        import re as _re
        out = []
        for m in _re.finditer(r'NOTE (\d+): title="mv (\d+)"', prompt):
            idx, num = int(m.group(1)), int(m.group(2))
            out.append({"id": idx,
                        "topic": "Property Deeds" if num % 2 == 0 else "NEW: Land Use"})
        return json.dumps(out)

    stats = split_hubs(conn, tenant, llm_call=fake_llm, limit=100, share=0.5, min_notes=10)
    assert stats["status"] == "ok"
    assert stats["moved"] == 12
    assert stats["hubs"][0]["topic"] == "Everything"

    tag, source = _topic_of(conn, tenant, "mv-0")
    assert tag == "Property Deeds" and source == "split"
    tag, _ = _topic_of(conn, tenant, "mv-1")
    assert tag == "Land Use"                            # NEW: prefix stripped
    # hub name survives as a plain tag on moved notes
    tags = {r[0] for r in conn.execute(
        "select tag from note_tags where tenant_id=%s and note_id='mv-0' and kind='tag'",
        (tenant,)).fetchall()}
    assert "everything" in tags
    # registry knows the children (stability gate / future vocabulary)
    canon = {r[0] for r in conn.execute(
        "select canonical from topic_registry where tenant_id=%s", (tenant,)).fetchall()}
    assert {"Property Deeds", "Land Use"} <= canon
    # untouched topic stays
    assert _topic_of(conn, tenant, "mvdg-0")[0] == "Dog Licenses"


def test_same_name_and_malformed_replies_keep_the_hub():
    tenant = "hub-keep"
    conn = _conn()
    _seed(conn, tenant, "Everything", 12, "kp")

    def stubborn_llm(prompt):
        import re as _re
        out = []
        for m in _re.finditer(r'NOTE (\d+):', prompt):
            idx = int(m.group(1))
            # slug-equal answer ("everythings" folds to the same key) and garbage
            out.append({"id": idx, "topic": "Everythings"} if idx % 2 == 0
                       else {"id": "nope"})
        return json.dumps(out)

    stats = split_hubs(conn, tenant, llm_call=stubborn_llm, limit=100, share=0.5, min_notes=10)
    assert stats["moved"] == 0
    assert stats["hubs"][0]["kept"] == 12
    assert _topic_of(conn, tenant, "kp-0")[0] == "Everything"


def test_junk_members_are_not_examined():
    tenant = "hub-junk"
    conn = _conn()
    _seed(conn, tenant, "Everything", 12, "jk2")
    _seed(conn, tenant, "Everything", 6, "jspam", role="solicitation")

    calls = []

    def fake_llm(prompt):
        calls.append(prompt)
        return "[]"

    stats = split_hubs(conn, tenant, llm_call=fake_llm, limit=100, share=0.5, min_notes=10)
    assert stats["hubs"][0]["examined"] == 12           # the 6 junk notes never sent
    assert all("jspam" not in p for p in calls)


def test_no_provider_changes_nothing(monkeypatch):
    import lore.hub_split as hs
    monkeypatch.setattr(hs, "provider_available", lambda p: False)
    tenant = "hub-noprov"
    conn = _conn()
    _seed(conn, tenant, "Everything", 40, "np")
    stats = split_hubs(conn, tenant)
    assert stats["status"] == "provider-unavailable"
    assert stats["moved"] == 0
    assert _topic_of(conn, tenant, "np-0")[0] == "Everything"


def test_parse_split_tolerates_prose_and_fences():
    raw = 'Sure! ```json\n[{"id":0,"topic":"NEW: Land Use"},{"id":1,"topic":" Zoning "}]\n```'
    parsed = parse_split(raw)
    assert parsed == {0: "Land Use", 1: "Zoning"}


def test_prompt_forbids_hub_and_catch_alls():
    p = _split_prompt("Records Management", [(0, "t", "x", ["a"])], ["Property Deeds"])
    assert 'NEVER answer "Records Management"' in p
    assert "Miscellaneous" in p
    assert "- Property Deeds" in p
