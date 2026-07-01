import datetime
from lore import db


def test_sqlite_connect_execute_and_placeholder_translation(tmp_path):
    url = f"sqlite:///{tmp_path/'lore.db'}"
    assert db.is_sqlite(url) is True
    conn = db._connect_url(url)  # test seam: connect to an explicit url
    # multi-statement DDL must go through executescript
    conn.executescript(
        "create table t(id text primary key, n int);"
        "create index t_n on t(n);"
    )
    # %s placeholders (psycopg style) must be accepted and translated to ?
    conn.execute("insert into t(id, n) values (%s, %s)", ("a", 1))
    row = conn.execute("select n from t where id = %s", ("a",)).fetchone()
    assert row[0] == 1
    conn.close()


def test_bootstrap_schema_sqlite_final_shape(tmp_path):
    url = f"sqlite:///{tmp_path/'lore.db'}"
    conn = db._connect_url(url)
    db.bootstrap_schema(conn)
    db.bootstrap_schema(conn)  # idempotent: second call must not raise

    cols = {r[1] for r in conn.execute("pragma table_info(notes)").fetchall()}
    assert {"id", "tenant_id", "scope_id", "source_type",
            "body", "content_hash", "importance"} <= cols

    ecols = {r[1] for r in conn.execute("pragma table_info(edges)").fetchall()}
    assert {"origin", "weight", "evidence", "updated_at"} <= ecols

    # reasoned-graph kind must be accepted (base SCHEMA's check would reject it)
    conn.execute("insert into notes(id, tenant_id, scope_id) values (%s,%s,%s)",
                 ("n1", "t", "private"))
    conn.execute("insert into notes(id, tenant_id, scope_id) values (%s,%s,%s)",
                 ("n2", "t", "private"))
    conn.execute(
        "insert into edges(tenant_id, src_note_id, dst_note_id, kind) "
        "values (%s,%s,%s,%s)", ("t", "n1", "n2", "supersedes"))
    n = conn.execute("select count(*) from edges where kind=%s",
                     ("supersedes",)).fetchone()[0]
    assert n == 1
    conn.close()
