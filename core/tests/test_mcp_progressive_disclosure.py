"""Progressive-disclosure retrieval contract (2026-07-20).

lore_search returns a compact ID-first index; lore_get(ids) hydrates full
note bodies. Covers the shared formatters/hydrator directly plus the FastMCP
lore_get surface (same env-default/backend-down conventions as the other
tools — see test_mcp_env_defaults.py).
"""
import pytest

from lore import mcp_server


# ---------------------------------------------------------------------------
# _format_search_hits: the compact index MUST carry the hydration handle
# ---------------------------------------------------------------------------

def test_search_hits_are_id_first_with_snippet_and_hint():
    hits = [
        {"note_id": "ins-00042", "title": "CLM-77741 Hail Roof", "heading_path": "Claim > Summary",
         "score": 0.912, "text": "  The adjuster completed   the inspection " + "x" * 300},
        {"note_id": "ins-00007", "title": None, "heading_path": "", "score": 0.5, "text": ""},
    ]
    out = mcp_server._format_search_hits(hits)
    assert "id: ins-00042" in out                      # hydration handle present
    assert "[CLM-77741 Hail Roof]" in out
    assert "[ins-00007]" in out                        # falls back to id as label
    assert "The adjuster completed the inspection" in out   # whitespace collapsed
    # snippet is clipped, not the whole body
    assert "x" * 200 not in out
    assert "lore_get(ids=[...])" in out                # the loop is self-describing


# ---------------------------------------------------------------------------
# _hydrate_notes
# ---------------------------------------------------------------------------

def _fake_note(nid, body):
    return {"id": nid, "title": f"Title {nid}", "scope": "eng", "body": body}


def test_hydrate_returns_full_bodies(monkeypatch):
    monkeypatch.setattr(mcp_server, "_safe_get",
                        lambda path: (_fake_note("n1", "full body text"), None))
    out = mcp_server._hydrate_notes(["n1"], ["eng"], "acme")
    assert "Title n1" in out and "full body text" in out and "id: n1" in out


def test_hydrate_truncates_long_bodies(monkeypatch):
    long_body = "y" * (mcp_server._GET_MAX_CHARS + 500)
    monkeypatch.setattr(mcp_server, "_safe_get",
                        lambda path: (_fake_note("n1", long_body), None))
    out = mcp_server._hydrate_notes(["n1"], ["eng"], "acme")
    assert "truncated" in out
    assert str(len(long_body)) in out                  # reports true total size
    assert len(out) < len(long_body)                   # actually clipped


def test_hydrate_caps_ids_and_reports_dropped(monkeypatch):
    monkeypatch.setattr(mcp_server, "_GET_MAX_IDS", 2)
    calls = []

    def fake_get(path):
        calls.append(path)
        return _fake_note("n", "b"), None
    monkeypatch.setattr(mcp_server, "_safe_get", fake_get)
    out = mcp_server._hydrate_notes(["a", "b", "c", "d"], ["eng"], "acme")
    assert len(calls) == 2                             # only the cap is fetched
    assert "2 dropped: c, d" in out


def test_hydrate_not_found_is_reported_not_leaked(monkeypatch):
    monkeypatch.setattr(mcp_server, "_safe_get", lambda path: (None, "backend 404"))
    out = mcp_server._hydrate_notes(["ghost"], ["eng"], "acme")
    assert "ghost" in out and "not found or not visible" in out


def test_hydrate_requires_ids():
    out = mcp_server._hydrate_notes([], ["eng"], "acme")
    assert out.startswith("Error: ids is required")


def test_hydrate_scopes_reach_the_query(monkeypatch):
    seen = {}

    def fake_get(path):
        seen["path"] = path
        return _fake_note("n1", "b"), None
    monkeypatch.setattr(mcp_server, "_safe_get", fake_get)
    mcp_server._hydrate_notes(["n1"], ["eng", "private"], "acme")
    assert "tenant=acme" in seen["path"]
    assert "scopes=eng%2Cprivate" in seen["path"]      # ACL filter forwarded


# ---------------------------------------------------------------------------
# FastMCP surface (mirrors test_mcp_env_defaults conventions)
# ---------------------------------------------------------------------------

_HAS_FASTMCP = hasattr(mcp_server, "_mcp")


@pytest.mark.skipif(not _HAS_FASTMCP, reason="FastMCP path not active in this environment")
class TestLoreGetSurface:
    def test_backend_down_message(self, monkeypatch):
        monkeypatch.setenv("LORE_SCOPES", "a,b")
        monkeypatch.setenv("LORE_TENANT", "acme")
        monkeypatch.setattr(mcp_server, "_backend_up", lambda: False)
        assert mcp_server.lore_get(["n1"]) == mcp_server._BACKEND_DOWN_MSG

    def test_scopes_required_without_env(self, monkeypatch):
        monkeypatch.delenv("LORE_SCOPES", raising=False)
        monkeypatch.delenv("LORE_TENANT", raising=False)
        assert mcp_server.lore_get(["n1"]) == mcp_server._SCOPES_REQUIRED_MSG
