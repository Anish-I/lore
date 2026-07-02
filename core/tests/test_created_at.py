"""Tests for the graph date-scrubber's data source: notes.created_at.

Covers the derivation precedence (frontmatter created: > date: > mtime > first-seen)
in isolation, plus the DB-level guarantee that upsert (re-index) never overwrites an
already-set created_at, and that /graph + /backfill/created wire it through end to end.
"""
import datetime
import time

from fastapi.testclient import TestClient
from lore.api import app, get_embedder, get_reranker
from lore.embed import FakeEmbedder
from lore.rerank import FakeReranker
from lore.index import derive_created_at, index_document, backfill_created_at

app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
app.dependency_overrides[get_reranker] = lambda: FakeReranker()
client = TestClient(app)


# ---------------------------------------------------------------------------
# Pure-logic precedence tests (no DB/IO)
# ---------------------------------------------------------------------------

def test_derive_created_at_frontmatter_created_wins():
    text = "---\ncreated: 2026-01-15\ndate: 2026-06-01\n---\n# Title\n\nBody.\n"
    dt = derive_created_at(text, mtime=time.time())
    assert dt is not None
    assert dt.date() == datetime.date(2026, 1, 15)


def test_derive_created_at_falls_back_to_date_key():
    text = "---\ntags:\n  - foo\ndate: 2026-03-14\n---\n# Title\n"
    dt = derive_created_at(text, mtime=time.time())
    assert dt is not None
    assert dt.date() == datetime.date(2026, 3, 14)


def test_derive_created_at_no_frontmatter_uses_mtime():
    text = "# Title\n\nNo frontmatter here.\n"
    mtime = datetime.datetime(2025, 11, 2, tzinfo=datetime.timezone.utc).timestamp()
    dt = derive_created_at(text, mtime=mtime)
    assert dt is not None
    assert dt.date() == datetime.date(2025, 11, 2)


def test_derive_created_at_no_signal_returns_none():
    """No frontmatter, no mtime → None (caller falls back to first-seen/now)."""
    assert derive_created_at("# Title\n\nplain body\n", mtime=None) is None
    assert derive_created_at("", mtime=None) is None


def test_derive_created_at_frontmatter_must_be_leading():
    """A `---` block that isn't at the very start of the text is not frontmatter —
    must not be mistaken for it (e.g. a horizontal rule later in the body)."""
    text = "# Title\n\nSome text.\n\n---\ncreated: 2026-01-15\n---\n"
    mtime = datetime.datetime(2025, 1, 1, tzinfo=datetime.timezone.utc).timestamp()
    dt = derive_created_at(text, mtime=mtime)
    assert dt is not None
    assert dt.date() == datetime.date(2025, 1, 1), "should fall through to mtime, not the mid-body '---' block"


def test_derive_created_at_malformed_date_falls_through():
    """An unparseable created: value must not raise — falls through to mtime."""
    text = "---\ncreated: not-a-date\n---\n# Title\n"
    mtime = datetime.datetime(2025, 6, 6, tzinfo=datetime.timezone.utc).timestamp()
    dt = derive_created_at(text, mtime=mtime)
    assert dt is not None
    assert dt.date() == datetime.date(2025, 6, 6)


# ---------------------------------------------------------------------------
# DB-backed: index_document sets created_at, and upsert never overwrites it
# ---------------------------------------------------------------------------

def test_index_document_sets_created_at_from_frontmatter():
    r = client.post("/ingest", json={
        "source_id": "created-at-fm-001",
        "title": "Frontmatter Dated Note",
        "text": "---\ncreated: 2025-08-20\n---\n# Frontmatter Dated Note\n\nBody.\n",
        "scope": "private",
        "owner": "me",
        "tenant": "created-at-tenant",
    })
    assert r.status_code == 200, r.text

    r2 = client.get("/graph", params={"tenant": "created-at-tenant", "scopes": "private"})
    assert r2.status_code == 200
    node = next(n for n in r2.json()["nodes"] if n["id"] == "created-at-fm-001")
    assert node["created"] is not None
    assert node["created"].startswith("2025-08-20"), node["created"]


def test_upsert_never_overwrites_existing_created_at():
    """Re-indexing the same note (e.g. a routine re-scrape) must NOT bump created_at
    even though updated_at (index time) changes on every call."""
    from lore import db

    base = {
        "source_id": "created-at-upsert-001",
        "title": "Stable Created Note",
        "text": "---\ncreated: 2024-02-02\n---\n# Stable Created Note\n\nv1.\n",
        "scope": "private",
        "owner": "me",
        "tenant": "created-at-tenant",
    }
    r1 = client.post("/ingest", json=base)
    assert r1.status_code == 200

    conn = db.connect()
    row1 = conn.execute(
        "select created_at, updated_at from notes where id=%s", (base["source_id"],)
    ).fetchone()
    assert row1[0] is not None

    # Re-ingest with a DIFFERENT (or absent) created: frontmatter value — the stored
    # created_at must remain the original 2024-02-02, only updated_at may move.
    time.sleep(0.01)
    r2 = client.post("/ingest", json={
        **base,
        "text": "---\ncreated: 2099-01-01\n---\n# Stable Created Note\n\nv2, edited.\n",
    })
    assert r2.status_code == 200

    row2 = conn.execute(
        "select created_at, updated_at from notes where id=%s", (base["source_id"],)
    ).fetchone()
    assert row2[0] == row1[0], "created_at must be write-once (preserved across upsert)"
    assert row2[0].year == 2024, "the ORIGINAL created: value must win, not the re-ingested one"


def test_index_document_no_frontmatter_gets_a_created_at_anyway():
    """A note with no frontmatter and no path (e.g. /ingest, no mtime) still gets a
    created_at (first-seen = now), so it always has a scrubbable date."""
    r = client.post("/ingest", json={
        "source_id": "created-at-noffm-001",
        "title": "No Frontmatter Note",
        "text": "# No Frontmatter Note\n\nJust prose, no created:/date: keys.\n",
        "scope": "private",
        "owner": "me",
        "tenant": "created-at-tenant",
    })
    assert r.status_code == 200, r.text
    r2 = client.get("/graph", params={"tenant": "created-at-tenant", "scopes": "private"})
    node = next(n for n in r2.json()["nodes"] if n["id"] == "created-at-noffm-001")
    assert node["created"] is not None


# ---------------------------------------------------------------------------
# /backfill/created — legacy notes (created_at IS NULL) get one, once
# ---------------------------------------------------------------------------

def test_backfill_created_at_fills_null_rows_only():
    from lore import db
    conn = db.connect()

    # Simulate a pre-migration note: indexed normally, then created_at forced to NULL
    # (as a real upgrade would see for rows written before the column existed).
    r = client.post("/ingest", json={
        "source_id": "created-at-legacy-001",
        "title": "Legacy Note",
        "text": "# Legacy Note\n\nIndexed before created_at existed.\n",
        "scope": "private",
        "owner": "me",
        "tenant": "created-at-tenant",
    })
    assert r.status_code == 200
    conn.execute("update notes set created_at=null where id=%s", ("created-at-legacy-001",))
    row = conn.execute(
        "select created_at from notes where id=%s", ("created-at-legacy-001",)
    ).fetchone()
    assert row[0] is None

    n = backfill_created_at(conn, "created-at-tenant")
    assert n >= 1

    row2 = conn.execute(
        "select created_at from notes where id=%s", ("created-at-legacy-001",)
    ).fetchone()
    assert row2[0] is not None, "backfill must populate created_at for legacy NULL rows"


def test_backfill_created_at_endpoint():
    r = client.post("/backfill/created", json={"tenant": "created-at-tenant"})
    assert r.status_code == 200
    assert "updated" in r.json()
