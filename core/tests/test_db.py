from vault import db
def test_bootstrap_creates_tables():
    conn = db.connect()
    db.bootstrap_schema(conn)
    cur = conn.execute("select count(*) from information_schema.tables where table_name in ('notes','chunks','edges')")
    assert cur.fetchone()[0] == 3
