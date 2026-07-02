"""LORE_SCOPES / LORE_TENANT env-default behavior for the MCP tools.

Covers the shared `_apply_env_defaults` helper directly, plus the FastMCP tool
functions end-to-end (mocking `_backend_up` so we don't need a running server):

  (a) no args + env set        -> env values applied, call gets past the
                                   scope/tenant checks (backend-down message).
  (b) no args + no env         -> the existing required-error strings.
  (c) explicit args override env.
"""
import pytest

from lore import mcp_server


# ---------------------------------------------------------------------------
# Helper-level tests
# ---------------------------------------------------------------------------

def test_env_scopes_parses_and_strips(monkeypatch):
    monkeypatch.setenv("LORE_SCOPES", " a, b ,,c")
    assert mcp_server._env_scopes() == ["a", "b", "c"]


def test_env_scopes_defaults_to_empty_when_unset(monkeypatch):
    monkeypatch.delenv("LORE_SCOPES", raising=False)
    assert mcp_server._env_scopes() == []


def test_env_tenant_reads_env(monkeypatch):
    monkeypatch.setenv("LORE_TENANT", "acme")
    assert mcp_server._env_tenant() == "acme"


def test_env_tenant_none_when_unset(monkeypatch):
    monkeypatch.delenv("LORE_TENANT", raising=False)
    assert mcp_server._env_tenant() is None


def test_apply_env_defaults_uses_env_when_args_falsy(monkeypatch):
    monkeypatch.setenv("LORE_SCOPES", "a,b")
    monkeypatch.setenv("LORE_TENANT", "acme")
    scopes, tenant = mcp_server._apply_env_defaults(None, None)
    assert scopes == ["a", "b"]
    assert tenant == "acme"

    scopes, tenant = mcp_server._apply_env_defaults([], "")
    assert scopes == ["a", "b"]
    assert tenant == "acme"


def test_apply_env_defaults_explicit_args_override_env(monkeypatch):
    monkeypatch.setenv("LORE_SCOPES", "a,b")
    monkeypatch.setenv("LORE_TENANT", "acme")
    scopes, tenant = mcp_server._apply_env_defaults(["x"], "other-tenant")
    assert scopes == ["x"]
    assert tenant == "other-tenant"


def test_apply_env_defaults_no_env_no_args(monkeypatch):
    monkeypatch.delenv("LORE_SCOPES", raising=False)
    monkeypatch.delenv("LORE_TENANT", raising=False)
    scopes, tenant = mcp_server._apply_env_defaults(None, None)
    assert scopes == []
    assert tenant is None


# ---------------------------------------------------------------------------
# FastMCP tool-function-level tests (only run if the FastMCP path loaded)
# ---------------------------------------------------------------------------

_HAS_FASTMCP = hasattr(mcp_server, "_mcp")


@pytest.fixture(autouse=True)
def _backend_down(monkeypatch):
    """Force _backend_up() False so tools that get past scope/tenant checks
    return the deterministic backend-down message instead of making a real
    HTTP call."""
    monkeypatch.setattr(mcp_server, "_backend_up", lambda: False)


@pytest.mark.skipif(not _HAS_FASTMCP, reason="FastMCP path not active in this environment")
class TestFastMCPToolEnvDefaults:
    def test_lore_ask_no_args_env_set_reaches_backend_check(self, monkeypatch):
        monkeypatch.setenv("LORE_SCOPES", "a,b")
        monkeypatch.setenv("LORE_TENANT", "acme")
        result = mcp_server.lore_ask("what is lore?")
        assert result == mcp_server._BACKEND_DOWN_MSG

    def test_lore_search_no_args_env_set_reaches_backend_check(self, monkeypatch):
        monkeypatch.setenv("LORE_SCOPES", "a,b")
        monkeypatch.setenv("LORE_TENANT", "acme")
        result = mcp_server.lore_search("query")
        assert result == mcp_server._BACKEND_DOWN_MSG

    def test_lore_graph_no_args_env_set_reaches_backend_check(self, monkeypatch):
        monkeypatch.setenv("LORE_SCOPES", "a,b")
        monkeypatch.setenv("LORE_TENANT", "acme")
        result = mcp_server.lore_graph()
        assert result == mcp_server._BACKEND_DOWN_MSG

    def test_lore_ask_no_args_no_env_returns_scopes_required(self, monkeypatch):
        monkeypatch.delenv("LORE_SCOPES", raising=False)
        monkeypatch.delenv("LORE_TENANT", raising=False)
        result = mcp_server.lore_ask("what is lore?")
        assert result == mcp_server._SCOPES_REQUIRED_MSG

    def test_lore_ask_env_scopes_set_but_no_tenant_returns_tenant_required(self, monkeypatch):
        monkeypatch.setenv("LORE_SCOPES", "a,b")
        monkeypatch.delenv("LORE_TENANT", raising=False)
        result = mcp_server.lore_ask("what is lore?")
        assert result == mcp_server._TENANT_REQUIRED_MSG

    def test_lore_ask_falsy_explicit_args_still_fall_back_to_env(self, monkeypatch):
        # Per spec, "falsy" (None, [], "") always falls back to env — only a
        # genuinely non-empty explicit value should override the env default.
        monkeypatch.setenv("LORE_SCOPES", "a,b")
        monkeypatch.setenv("LORE_TENANT", "acme")
        result = mcp_server.lore_ask("q", scopes=[], tenant="")
        assert result == mcp_server._BACKEND_DOWN_MSG

    def test_lore_ask_explicit_valid_args_used_over_env(self, monkeypatch):
        monkeypatch.setenv("LORE_SCOPES", "env-scope")
        monkeypatch.setenv("LORE_TENANT", "env-tenant")
        captured = {}

        def fake_safe_post(path, payload):
            captured["payload"] = payload
            return None, "boom"

        monkeypatch.setattr(mcp_server, "_backend_up", lambda: True)
        monkeypatch.setattr(mcp_server, "_safe_post", fake_safe_post)
        mcp_server.lore_ask("q", scopes=["explicit-scope"], tenant="explicit-tenant")
        assert captured["payload"]["principal_scopes"] == ["explicit-scope"]
        assert captured["payload"]["tenant_id"] == "explicit-tenant"


# ---------------------------------------------------------------------------
# Low-level SDK fallback path: exercise _call_tool directly (works regardless
# of which branch loaded, since _apply_env_defaults is shared).
# ---------------------------------------------------------------------------

def test_low_level_call_tool_uses_env_defaults(monkeypatch):
    if not hasattr(mcp_server, "_call_tool"):
        pytest.skip("low-level fallback path not active in this environment")
    import asyncio

    monkeypatch.setenv("LORE_SCOPES", "a,b")
    monkeypatch.setenv("LORE_TENANT", "acme")
    result = asyncio.run(mcp_server._call_tool("lore_ask", {"question": "hi"}))
    assert result[0].text == mcp_server._BACKEND_DOWN_MSG


def test_low_level_call_tool_no_env_no_args_required_error(monkeypatch):
    if not hasattr(mcp_server, "_call_tool"):
        pytest.skip("low-level fallback path not active in this environment")
    import asyncio

    monkeypatch.delenv("LORE_SCOPES", raising=False)
    monkeypatch.delenv("LORE_TENANT", raising=False)
    result = asyncio.run(mcp_server._call_tool("lore_ask", {"question": "hi"}))
    assert result[0].text == mcp_server._SCOPES_REQUIRED_MSG
