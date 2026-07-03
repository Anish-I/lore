"""Store-hygiene guards: low-content chunk skip + session-source recall downweight."""
from lore.chunker import chunk_markdown, _is_low_content
from lore.recall import _downweight_sessions, SESSION_WEIGHT


def test_frontmatter_only_chunk_skipped():
    md = "---\ntags:\n  - type/index\n  - status/auto\n---\n"
    assert chunk_markdown("n1", md) == []


def test_bare_tag_list_skipped():
    md = "# T\n\ntags:\ntype/index\nstatus/auto\n"
    assert chunk_markdown("n1", md) == []


def test_real_prose_kept():
    md = ("# Postgres Pooling\n\nUnder heavy concurrent load the API exhausts "
          "Postgres backends; PgBouncer in transaction mode fixes it.\n")
    chunks = chunk_markdown("n1", md)
    assert len(chunks) == 1
    assert "PgBouncer" in chunks[0].text


def test_low_content_boundary():
    assert _is_low_content("tags: type/topic\n- kalshi/bot")
    assert not _is_low_content("The scheduler reserves memory before placing the pod on a node.")


def test_session_chunks_downweighted():
    final = {"a": 0.9, "b": 0.8}
    by_id = {
        "a": {"source_type": "claude-session"},
        "b": {"source_type": "note"},
    }
    _downweight_sessions(final, by_id)
    assert final["a"] == 0.9 * SESSION_WEIGHT
    assert final["b"] == 0.8  # untouched


def test_missing_source_type_untouched():
    # Pre-existing points indexed before the payload field existed must not be penalized.
    final = {"a": 0.5}
    _downweight_sessions(final, {"a": {}})
    assert final["a"] == 0.5
