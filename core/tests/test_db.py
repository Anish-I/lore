from lore import db
def test_bootstrap_creates_tables(conn):
    db.bootstrap_schema(conn)
    if isinstance(conn, db._SqliteConn):
        cur = conn.execute("select count(*) from sqlite_master where type='table' and name in ('notes','chunks','edges')")
    else:
        cur = conn.execute("select count(*) from information_schema.tables where table_name in ('notes','chunks','edges')")
    assert cur.fetchone()[0] == 3
