from lore import db
from lore.learn import eligibility_gate


def _conn(tmp_path):
    conn = db._connect_url(f"sqlite:///{tmp_path / 'eligibility.db'}")
    db.bootstrap_schema(conn)
    return conn


def test_min_iterations_and_explicit_bypass(tmp_path):
    conn = _conn(tmp_path)
    cfg = {"enabled": True, "min_iters": 10, "daily_reviews": 20, "daily_tokens": 1000}
    assert eligibility_gate(conn, "t", "a", {"iteration_count": 2, "explicit_request": False}, cfg) == (
        False, "below-min-iterations"
    )
    assert eligibility_gate(conn, "t", "a", {"iteration_count": 2, "explicit_request": True}, cfg) == (
        True, None
    )


def test_disabled_and_daily_budgets_skip_before_provider(tmp_path):
    conn = _conn(tmp_path)
    evidence = {"iteration_count": 20, "explicit_request": False}
    cfg = {"enabled": False, "min_iters": 10, "daily_reviews": 20, "daily_tokens": 1000}
    assert eligibility_gate(conn, "t", "a", evidence, cfg) == (False, "disabled")
    conn.execute(
        "insert into learn_runs(id,tenant_id,transcript_sha,status,est_tokens) "
        "values('r','t','other','done',900)"
    )
    cfg.update(enabled=True, daily_reviews=1)
    assert eligibility_gate(conn, "t", "a", evidence, cfg) == (False, "daily-review-budget")
    cfg.update(daily_reviews=20, daily_tokens=800)
    assert eligibility_gate(conn, "t", "a", evidence, cfg) == (False, "daily-token-budget")
    cfg.update(daily_tokens=1000, max_input_chars=60_000)
    projected = {**evidence, "transcript_chars": 800}
    assert eligibility_gate(conn, "t", "a", projected, cfg) == (False, "daily-token-budget")
