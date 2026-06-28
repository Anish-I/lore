from lore import db
from lore.embed import FakeEmbedder
from lore.watcher import handle_change

def test_handle_change_indexes_md(tmp_path):
    c = db.connect(); db.bootstrap_schema(c)
    p = tmp_path / "note.md"; p.write_text("# T\n\n## S\nHello world content here.\n", encoding="utf-8")
    n = handle_change(str(p), FakeEmbedder(), c, "alice", "alice-private", "t1")
    assert n >= 1

def test_handle_change_missing_file_returns_zero(tmp_path):
    """I4: handle_change must return 0 (not raise) when the .md file does not exist."""
    c = db.connect(); db.bootstrap_schema(c)
    missing = str(tmp_path / "ghost.md")
    result = handle_change(missing, FakeEmbedder(), c, "alice", "alice-private", "t1")
    assert result == 0
