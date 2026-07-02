import datetime
import importlib
from lore import db
from lore import tenancy
from lore.sqlutil import in_clause


def test_connect_selects_sqlite_from_env(tmp_path, monkeypatch):
    # env → Settings → connect() scheme selection. Reload ONLY lore.config (its
    # dataclass defaults re-read the env); never reload lore.db — that re-creates
    # the _SqliteConn class object and breaks isinstance() checks for connections
    # other tests created earlier in the session.
    import lore.config as cfg
    import lore.db as dbmod
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path/'x.db'}")
    try:
        importlib.reload(cfg)
        monkeypatch.setattr(dbmod, "settings", cfg.settings)
        conn = dbmod.connect()
        assert isinstance(conn, dbmod._SqliteConn)
        conn.close()
    finally:
        monkeypatch.undo()      # restores DATABASE_URL and dbmod.settings
        importlib.reload(cfg)   # re-evaluate config under the restored env


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


def test_bootstrap_tenancy_sqlite_idempotent(tmp_path):
    url = f"sqlite:///{tmp_path/'lore.db'}"
    conn = db._connect_url(url)
    tenancy.bootstrap_tenancy(conn)
    tenancy.bootstrap_tenancy(conn)  # must not raise
    for t in ("orgs", "teams", "memberships", "audit_log"):
        conn.execute(f"select count(*) from {t}").fetchone()
    # audit_log autoincrement id works without an explicit value
    conn.execute("insert into audit_log(actor_user_id, action) values (%s,%s)",
                 ("alice", "test"))
    rid = conn.execute("select id from audit_log").fetchone()[0]
    assert isinstance(rid, int)
    conn.close()


def test_timestamp_columns_read_as_aware_datetime(tmp_path):
    url = f"sqlite:///{tmp_path/'lore.db'}"
    conn = db._connect_url(url)
    db.bootstrap_schema(conn)
    conn.execute("insert into notes(id, tenant_id, scope_id) values (%s,%s,%s)",
                 ("n1", "t", "private"))
    ts = conn.execute("select updated_at from notes where id=%s", ("n1",)).fetchone()[0]
    assert isinstance(ts, datetime.datetime)
    assert ts.tzinfo is not None                      # tz-aware
    _ = ts.isoformat()                                # api.py depends on this
    now = datetime.datetime.now(datetime.timezone.utc)
    _ = (now - ts).total_seconds()                    # relations.py depends on this
    conn.close()


def test_in_clause_and_scope_filter_on_sqlite(tmp_path):
    frag, params = in_clause("scope_id", ["private", "team"])
    assert frag == "scope_id in (%s,%s)"
    assert params == ["private", "team"]
    assert in_clause("scope_id", []) == ("1=0", [])

    url = f"sqlite:///{tmp_path/'lore.db'}"
    conn = db._connect_url(url)
    db.bootstrap_schema(conn)
    for i, sc in enumerate(["private", "team", "enterprise"]):
        conn.execute("insert into notes(id, tenant_id, scope_id) values (%s,%s,%s)",
                     (f"n{i}", "t", sc))
    frag, params = in_clause("scope_id", ["private", "team"])
    rows = conn.execute(
        f"select id from notes where tenant_id=%s and {frag} order by id",
        ["t", *params]).fetchall()
    assert [r[0] for r in rows] == ["n0", "n1"]
    conn.close()


def test_sqlite_path_windows_drive_letters():
    assert db._sqlite_path("sqlite:///C:/Users/x/lore.db") == "C:/Users/x/lore.db"
    assert db._sqlite_path(r"sqlite:///C:\Users\x\lore.db") == r"C:\Users\x\lore.db"
    assert db._sqlite_path("sqlite:///tmp/x.db") == "/tmp/x.db"          # POSIX keeps leading slash
    assert db._sqlite_path("sqlite:////Users/x/lore.db") == "//Users/x/lore.db"
