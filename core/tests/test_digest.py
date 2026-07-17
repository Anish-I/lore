"""/digest — the Home tab's this-week view: notes grouped by day × section,
with a created-since-yesterday count. No LLM; summary = top note titles."""
import datetime

from fastapi.testclient import TestClient

from lore import db
from lore.api import app

client = TestClient(app)


def _conn():
    c = db.connect()
    db.bootstrap_schema(c)
    return c


def _seed(conn, tenant, tmp_path):
    """Two sections (Kalshi/, Wingman/) with fresh notes, plus one backdated
    3 days and one outside the 7-day window."""
    files = [
        ("Kalshi/pair-sizing.md", "# Pair sizing\n\nKalshi pair sizing config.\n"),
        ("Kalshi/fed-markets.md", "# Fed markets\n\nFed meeting market notes.\n"),
        ("Wingman/roadmap.md", "# Roadmap\n\nWingman v3 roadmap.\n"),
        ("Kalshi/old-strategy.md", "# Old strategy\n\nRetired strategy.\n"),
        ("Kalshi/ancient.md", "# Ancient\n\nWay out of the window.\n"),
    ]
    for rel, body in files:
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body, encoding="utf-8")
        r = client.post("/reindex", json={"path": str(p), "owner_id": "me",
                                          "scope_id": "private", "tenant_id": tenant})
        assert r.status_code == 200

    now = datetime.datetime.now(datetime.timezone.utc)
    backdate = {
        "old-strategy.md": now - datetime.timedelta(days=3),
        "ancient.md": now - datetime.timedelta(days=40),
    }
    for fname, ts in backdate.items():
        conn.execute(
            "update notes set created_at=%s, updated_at=%s "
            "where tenant_id=%s and replace(source_path,'\\','/') like %s",
            (ts, ts, tenant, f"%/{fname}"))


def test_digest_shape_and_day_grouping(tmp_path):
    tenant = "digest-shape"
    conn = _conn()
    _seed(conn, tenant, tmp_path)

    r = client.get("/digest", params={"tenant": tenant, "days": 7, "scopes": "private"})
    assert r.status_code == 200
    body = r.json()
    assert body["days"] == 7
    assert isinstance(body["rows"], list) and body["rows"]

    today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    three_ago = (datetime.datetime.now(datetime.timezone.utc)
                 - datetime.timedelta(days=3)).date().isoformat()
    by_key = {(row["day"], row["section"]): row for row in body["rows"]}

    # Today: 2 fresh Kalshi notes in one group, 1 Wingman note in another.
    assert by_key[(today, "Kalshi")]["count"] == 2
    assert set(by_key[(today, "Kalshi")]["topTitles"]) == {"Pair sizing", "Fed markets"}
    assert by_key[(today, "Wingman")]["count"] == 1
    assert by_key[(today, "Wingman")]["topTitles"] == ["Roadmap"]

    # The 3-day-old note groups under its own day; the 40-day-old one is out.
    assert by_key[(three_ago, "Kalshi")]["count"] == 1
    assert all("Ancient" not in row["topTitles"] for row in body["rows"])
    assert body["total"] == 4

    # topTitles is capped at 3 everywhere; rows come newest-day-first.
    assert all(len(row["topTitles"]) <= 3 for row in body["rows"])
    days_order = [row["day"] for row in body["rows"]]
    assert days_order == sorted(days_order, reverse=True)


def test_digest_since_yesterday_counts_only_fresh_creations(tmp_path):
    tenant = "digest-since"
    conn = _conn()
    _seed(conn, tenant, tmp_path)

    body = client.get("/digest",
                      params={"tenant": tenant, "days": 7, "scopes": "private"}).json()
    # 3 notes created now; the backdated ones (3d / 40d) don't count.
    assert body["sinceYesterday"] == 3


def test_digest_requires_tenant_and_clamps_days(tmp_path):
    assert client.get("/digest").status_code == 422
    tenant = "digest-clamp"
    conn = _conn()
    _seed(conn, tenant, tmp_path)
    body = client.get("/digest",
                      params={"tenant": tenant, "days": 999, "scopes": "private"}).json()
    assert body["days"] == 31
    body = client.get("/digest",
                      params={"tenant": tenant, "days": 0, "scopes": "private"}).json()
    assert body["days"] == 1


def test_digest_enforces_scope_acl(tmp_path):
    """The leak fix: /digest must count only notes in the caller's authorized
    scopes. Tenant alone (no scopes, no profile) can no longer surface content,
    and a note in a scope the caller can't see never appears in the digest."""
    tenant = "digest-acl"
    conn = _conn()
    _seed(conn, tenant, tmp_path)  # seeds everything under scope_id "private"

    # Add one note in a DIFFERENT scope the caller will not request.
    p = tmp_path / "Secret/hr-memo.md"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("# HR memo\n\nConfidential personnel note.\n", encoding="utf-8")
    r = client.post("/reindex", json={"path": str(p), "owner_id": "hr",
                                      "scope_id": "hr-restricted", "tenant_id": tenant})
    assert r.status_code == 200

    # Tenant param alone (no authorized scope, EMPTY_PROFILE) leaks nothing.
    body = client.get("/digest", params={"tenant": tenant, "days": 7}).json()
    assert body["rows"] == [] and body["total"] == 0

    # Caller sees only "private" — the hr-restricted memo must not appear.
    body = client.get("/digest",
                      params={"tenant": tenant, "days": 7, "scopes": "private"}).json()
    all_titles = [t for row in body["rows"] for t in row["topTitles"]]
    assert "HR memo" not in all_titles
    assert any("Roadmap" in t or "Pair sizing" in t or "Fed markets" in t for t in all_titles)

    # A caller authorized for hr-restricted sees the memo (and only its scope).
    body = client.get("/digest",
                      params={"tenant": tenant, "days": 7, "scopes": "hr-restricted"}).json()
    hr_titles = [t for row in body["rows"] for t in row["topTitles"]]
    assert hr_titles == ["HR memo"]
