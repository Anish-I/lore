from vault import db
from vault.embed import FakeEmbedder
from vault.watcher import handle_change

def test_handle_change_indexes_md(tmp_path):
    c = db.connect(); db.bootstrap_schema(c)
    p = tmp_path / "note.md"; p.write_text("# T\n\n## S\nHello world content here.\n", encoding="utf-8")
    n = handle_change(str(p), FakeEmbedder(), c, "alice", "alice-private", "t1")
    assert n >= 1
