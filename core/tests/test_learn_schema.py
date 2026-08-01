from lore import db


def test_learn_schema_is_idempotent_and_enforces_uniqueness(tmp_path):
    conn = db._connect_url(f"sqlite:///{tmp_path / 'learn.db'}")
    db.bootstrap_schema(conn)
    db.bootstrap_schema(conn)

    names = {row[0] for row in conn.execute(
        "select name from sqlite_master where type='table' and name like 'learn_%' or name like 'skill%'"
    ).fetchall()}
    assert {"learn_runs", "skills", "skill_versions"}.issubset(names)

    conn.execute(
        "insert into learn_runs(id,tenant_id,transcript_sha,status) values('r1','t','sha','queued')"
    )
    conn.execute(
        "insert into learn_runs(id,tenant_id,transcript_sha,status) values('r2','t','sha','queued') "
        "on conflict (tenant_id,transcript_sha) do nothing"
    )
    assert conn.execute("select count(*) from learn_runs").fetchone()[0] == 1
    conn.close()
