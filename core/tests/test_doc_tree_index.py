"""LORE_DOC_TREE wiring: structure pass + doc_nodes persistence in index_document."""
from lore import index, structure
from lore.embed import FakeEmbedder


def test_flag_off_leaves_flat_paths(conn, monkeypatch):
    monkeypatch.delenv("LORE_DOC_TREE", raising=False)
    md = "# Ord\n\n## Page 1\n\nARTICLE I\n\nSection 3. Fees\n\nThe fee is ten dollars.\n"
    index.index_document(source_id="flatnote", title="Ord", text=md, scope_id="eng",
                         owner_id="u", tenant_id="t1", embedder=FakeEmbedder(), conn=conn)
    paths = [r[0] for r in conn.execute(
        "select heading_path from chunks where note_id=%s", ("flatnote",)).fetchall()]
    assert paths and all("Page" in p for p in paths)
    assert not any("ARTICLE" in p for p in paths)         # flat when flag off
    bv = conn.execute("select builder_version from notes where id=%s",
                      ("flatnote",)).fetchone()[0]
    assert bv is None


def test_flag_on_enriches_paths_and_persists_nodes(conn, monkeypatch):
    monkeypatch.setenv("LORE_DOC_TREE", "1")
    md = "# Ord\n\n## Page 1\n\nARTICLE I\n\nSection 3. Fees\n\nThe recording fee is ten dollars.\n"
    prov = {"pages": [{"page": 1, "source": "native"}]}
    index.index_document(source_id="treenote", title="Ord", text=md, scope_id="eng",
                         owner_id="u", tenant_id="t1", embedder=FakeEmbedder(),
                         conn=conn, provenance=prov)
    paths = [r[0] for r in conn.execute(
        "select heading_path from chunks where note_id=%s", ("treenote",)).fetchall()]
    assert any("ARTICLE I" in p for p in paths)
    assert any("Page 1" in p for p in paths)              # page anchor preserved in path
    nodes = [t[0] for t in conn.execute(
        "select title from doc_nodes where note_id=%s", ("treenote",)).fetchall()]
    assert "ARTICLE I" in nodes
    bv = conn.execute("select builder_version from notes where id=%s",
                      ("treenote",)).fetchone()[0]
    assert bv == structure.BUILDER_VERSION


def test_flag_on_without_page_markers_is_noop(conn, monkeypatch):
    monkeypatch.setenv("LORE_DOC_TREE", "1")
    md = "# Plain\n\njust a normal note body with no page markers at all here.\n"
    index.index_document(source_id="plainnote", title="Plain", text=md, scope_id="eng",
                         owner_id="u", tenant_id="t1", embedder=FakeEmbedder(), conn=conn)
    bv = conn.execute("select builder_version from notes where id=%s",
                      ("plainnote",)).fetchone()[0]
    assert bv is None
    assert conn.execute("select count(*) from doc_nodes where note_id=%s",
                        ("plainnote",)).fetchone()[0] == 0


def test_stale_notes_flags_version_mismatch(conn, monkeypatch):
    monkeypatch.setenv("LORE_DOC_TREE", "1")
    conn.execute("update notes set builder_version=%s where id=%s",
                 ("doc-tree/OLD", "treenote"))
    stale = structure.stale_notes(conn, "t1")
    assert "treenote" in stale
    # restore the current version -> no longer stale
    conn.execute("update notes set builder_version=%s where id=%s",
                 (structure.BUILDER_VERSION, "treenote"))
    assert "treenote" not in structure.stale_notes(conn, "t1")
    # flag OFF: any note still carrying doc_nodes is stale (tree must not linger)
    monkeypatch.setenv("LORE_DOC_TREE", "0")
    assert "treenote" in structure.stale_notes(conn, "t1")


def test_rendered_pages_recoverable_by_widened_eval_regex():
    """Contract with eval/scenarios/run_onboard_directory.py: per-page provenance
    is recovered by splitting on `^#+ Page N$` — must match tree-rendered bodies."""
    import re
    md = "# T\n\n## Page 1\n\nARTICLE I\n\nbody one\n\n## Page 2\n\nbody two\n"
    prov = {"pages": [{"page": 1, "source": "native"}, {"page": 2, "source": "native"}]}
    out_md, _ = structure.build("T", md, prov, note_id="n1")
    old = re.split(r"(?m)^## Page (\d+)\s*$", out_md)
    widened = re.split(r"(?m)^#+ Page (\d+)\s*$", out_md)
    assert old.count("1") == 0            # deep markers invisible to the old regex
    assert widened.count("1") == 1 and widened.count("2") == 1
    assert "body two" in widened[widened.index("2") + 1]
