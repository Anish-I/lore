"""doc_nodes table + notes.builder_version column (LORE_DOC_TREE persistence)."""


def test_doc_nodes_table_and_builder_version_column(conn):
    # doc_nodes must exist and accept a row (note row first: FK on note_id)
    conn.execute(
        "insert into notes(id, tenant_id, owner_id, scope_id, title) "
        "values(%s,%s,%s,%s,%s) on conflict (id) do nothing",
        ("nX", "t1", "u", "eng", "fixture"))
    conn.execute("delete from doc_nodes where note_id=%s", ("nX",))
    conn.execute(
        "insert into doc_nodes(id,tenant_id,note_id,parent_id,title,level,"
        "page_start,page_end,source,confidence,builder_version) "
        "values(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        ("d1", "t1", "nX", None, "ARTICLE I", 1, 1, 3, "regex", 0.7, "doc-tree/1"))
    row = conn.execute("select title, page_end from doc_nodes where id=%s", ("d1",)).fetchone()
    assert row[0] == "ARTICLE I" and row[1] == 3
    # notes.builder_version column exists
    conn.execute("select builder_version from notes limit 1")
