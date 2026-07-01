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
