"""Role axis (2026-07-27 spec): classify emits correspondence|solicitation|bulk."""
from lore import db
from lore.classify import _classify_prompt, classify_untagged, parse_classification


def _conn():
    c = db.connect()
    db.bootstrap_schema(c)
    return c


def _insert_note(conn, tenant, nid, title, body):
    conn.execute(
        """insert into notes(id, tenant_id, owner_id, scope_id, title, body, updated_at)
           values(%s,%s,'me','private',%s,%s,now()) on conflict (id) do nothing""",
        (nid, tenant, title, body))


def _role_rows(conn, tenant):
    return conn.execute(
        "select note_id, tag, source from note_tags "
        "where tenant_id=%s and kind='role' order by note_id", (tenant,)).fetchall()


def test_prompt_carries_role_contract():
    p = _classify_prompt([(0, "t", "text")], [])
    for needle in ("correspondence", "solicitation", "bulk", "Omit role"):
        assert needle in p


def test_parse_role_valid_normalized():
    out = parse_classification('[{"id":0,"tags":["a"],"topic":"T","role":" Bulk "}]')
    assert out[0]["role"] == "bulk"


def test_parse_role_invalid_or_missing_is_none_and_keeps_tags():
    out = parse_classification(
        '[{"id":0,"tags":["a"],"topic":"T","role":"advertisement"},'
        '{"id":1,"tags":["b"],"topic":"U"}]')
    assert out[0]["role"] is None and out[0]["tags"] == ["a"]
    assert out[1]["role"] is None and out[1]["tags"] == ["b"]


def test_classify_untagged_stores_role_rows_only_for_roled_items():
    tenant = "role-e2e"
    conn = _conn()
    for i in range(3):
        _insert_note(conn, tenant, f"r-{i}", f"mail {i}", f"body {i}")
        # Explicit descending recency: classify orders updated_at DESC, so
        # batch index 0 is r-0 regardless of insert-clock granularity.
        conn.execute("update notes set updated_at=%s where id=%s",
                     (f"2026-01-{3 - i:02d} 12:00:00", f"r-{i}"))

    def stub_llm(prompt):
        return ('[{"id":0,"tags":["t"],"topic":"Desk","role":"solicitation"},'
                '{"id":1,"tags":["t"],"topic":"Desk","role":"nonsense"},'
                '{"id":2,"tags":["t"],"topic":"Desk"}]')

    stats = classify_untagged(conn, tenant, llm_call=stub_llm)
    assert stats["llmTagged"] == 3
    assert _role_rows(conn, tenant) == [("r-0", "solicitation", "llm")]


def test_second_run_never_adds_second_role():
    tenant = "role-invariant"
    conn = _conn()
    _insert_note(conn, tenant, "inv-0", "mail", "body")
    calls = []

    def stub_llm(prompt):
        calls.append(prompt)
        role = "bulk" if len(calls) == 1 else "solicitation"
        return f'[{{"id":0,"tags":["t"],"topic":"Desk","role":"{role}"}}]'

    classify_untagged(conn, tenant, llm_call=stub_llm)
    classify_untagged(conn, tenant, llm_call=stub_llm)
    assert _role_rows(conn, tenant) == [("inv-0", "bulk", "llm")]
    assert len(calls) == 1          # second run selected nothing


def test_fallback_stores_no_role():
    tenant = "role-fb"
    conn = _conn()
    _insert_note(conn, tenant, "fb-0", "note", "text with #hashtag inside")
    stats = classify_untagged(conn, tenant, llm_call=lambda p: "garbage not json")
    assert stats["fallbackTagged"] == 1
    assert _role_rows(conn, tenant) == []
