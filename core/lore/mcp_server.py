"""Lore MCP server — read-only Lore knowledge tools over stdio.

Exposes three tools:
    lore_ask(question, scopes, tenant)     — answer a question from the knowledge base
    lore_search(query, scopes, tenant, k)  — return ranked chunk hits
    lore_graph(scopes, tenant)             — return node/edge counts

scopes and tenant are REQUIRED on every tool; never default to all or to a tenant.
If omitted, they fall back to the LORE_SCOPES (comma-separated) / LORE_TENANT env
vars, letting an MCP registration pin identity once instead of passing it every call.

Run with:
    python -m lore.mcp_server
or via the installed script:
    lore-mcp
"""
import json
import os
import socket
import urllib.parse
import urllib.request
import urllib.error

BASE_URL = os.environ.get("LORE_BACKEND_URL", "http://localhost:8099")
_HTTP_TIMEOUT = 15   # seconds; applied to every real API call (not just health check)

_BACKEND_DOWN_MSG = (
    "Lore backend is not running. "
    "Start it with: uvicorn lore.api:app --port 8099"
)
_SCOPES_REQUIRED_MSG = (
    "Error: scopes is required and must not be empty — "
    "Lore never defaults to all-scopes access."
)
_TENANT_REQUIRED_MSG = (
    "Error: tenant is required and must not be empty — "
    "Lore never defaults to a tenant."
)


def _get_json(path: str, timeout: int = _HTTP_TIMEOUT) -> dict:
    with urllib.request.urlopen(f"{BASE_URL}{path}", timeout=timeout) as r:
        return json.loads(r.read())


def _post_json(path: str, payload: dict, timeout: int = _HTTP_TIMEOUT) -> dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{BASE_URL}{path}", data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _backend_up() -> bool:
    try:
        _get_json("/presets", timeout=2)
        return True
    except Exception:
        return False


def _safe_get(path: str) -> tuple[dict | None, str | None]:
    """GET path; return (data, None) on success or (None, error_message) on failure."""
    try:
        return _get_json(path), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}: {e.reason}"
    except urllib.error.URLError as e:
        return None, f"Connection error: {e.reason}"
    except socket.timeout:
        return None, "Request timed out (backend may be overloaded)"
    except json.JSONDecodeError:
        return None, "Backend returned malformed JSON"
    except Exception as e:
        return None, f"Unexpected error: {e}"


def _safe_post(path: str, payload: dict) -> tuple[dict | None, str | None]:
    """POST path; return (data, None) on success or (None, error_message) on failure."""
    try:
        return _post_json(path, payload), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}: {e.reason}"
    except urllib.error.URLError as e:
        return None, f"Connection error: {e.reason}"
    except socket.timeout:
        return None, "Request timed out (backend may be overloaded)"
    except json.JSONDecodeError:
        return None, "Backend returned malformed JSON"
    except Exception as e:
        return None, f"Unexpected error: {e}"


def _check_scopes(scopes: list[str]) -> str | None:
    """Return an error message if scopes is empty/blank, else None."""
    if not scopes or not any(s.strip() for s in scopes):
        return _SCOPES_REQUIRED_MSG
    return None


def _clean_scopes(scopes: list[str]) -> list[str]:
    return [s.strip() for s in scopes if s and s.strip()]


def _check_tenant(tenant: str | None) -> str | None:
    if not tenant or not tenant.strip():
        return _TENANT_REQUIRED_MSG
    return None


def _env_scopes() -> list[str]:
    """Scopes from the LORE_SCOPES env var (comma-separated), stripped and filtered."""
    raw = os.environ.get("LORE_SCOPES", "")
    return [s.strip() for s in raw.split(",") if s.strip()]


def _env_tenant() -> str | None:
    """Tenant from the LORE_TENANT env var, if set."""
    return os.environ.get("LORE_TENANT")


def _apply_env_defaults(
    scopes: list[str] | None, tenant: str | None
) -> tuple[list[str], str | None]:
    """Fall back to LORE_SCOPES / LORE_TENANT env vars when args are falsy.

    Shared by both the FastMCP tool path and the low-level SDK fallback path
    so a caller pinning identity via env never has to pass scopes/tenant.
    Explicit args always win; the required-scope/tenant checks still run
    after this, so "no env and no args" keeps returning the required-error
    messages.
    """
    if not scopes:
        scopes = _env_scopes()
    if not tenant:
        tenant = _env_tenant()
    return scopes, tenant


try:
    from mcp.server.fastmcp import FastMCP as _FastMCP

    _mcp = _FastMCP("lore")

    @_mcp.tool()
    def lore_ask(question: str, scopes: list[str] | None = None, tenant: str | None = None) -> str:
        """Ask a question against the user's Lore knowledge base and get a cited answer.

        Lore is this user's long-term memory: past decisions, project state, fixes,
        and gotchas live here, not in your context. PREFER this over guessing
        whenever the user references prior work ("that bug from last week",
        "how did we set X up", "what did we decide about Y").

        Args:
            question: Natural language question.
            scopes: List of ACL scope IDs the caller can read (required, never empty).
                Falls back to the LORE_SCOPES env var (comma-separated) if omitted.
            tenant: Tenant namespace to query (required, never empty).
                Falls back to the LORE_TENANT env var if omitted.
        """
        scopes, tenant = _apply_env_defaults(scopes, tenant)
        err = _check_scopes(scopes)
        if err:
            return err
        err = _check_tenant(tenant)
        if err:
            return err
        if not _backend_up():
            return _BACKEND_DOWN_MSG
        data, err = _safe_post("/ask", {
            "question": question,
            "principal_scopes": _clean_scopes(scopes),
            "tenant_id": tenant.strip(),
        })
        if err:
            return f"Error calling Lore: {err}"
        return data.get("answer", "No answer returned.")

    @_mcp.tool()
    def lore_search(
        query: str, scopes: list[str] | None = None, tenant: str | None = None, k: int = 10
    ) -> str:
        """Search the user's Lore knowledge base and return ranked hits.

        CALL THIS FIRST at the start of any non-trivial task: Lore holds the
        user's accumulated project knowledge (architecture notes, past fixes,
        decisions, session history) that is NOT in your context. A 1-line query
        about the task topic is enough — skipping this risks re-deriving or
        contradicting what the user already knows.

        Args:
            query: Search query.
            scopes: List of ACL scope IDs the caller can read (required, never empty).
                Falls back to the LORE_SCOPES env var (comma-separated) if omitted.
            tenant: Tenant namespace to query (required, never empty).
                Falls back to the LORE_TENANT env var if omitted.
            k: Number of results to return (default 10, max 50).
        """
        scopes, tenant = _apply_env_defaults(scopes, tenant)
        err = _check_scopes(scopes)
        if err:
            return err
        err = _check_tenant(tenant)
        if err:
            return err
        if not _backend_up():
            return _BACKEND_DOWN_MSG
        data, err = _safe_post("/search", {
            "query": query,
            "scopes": _clean_scopes(scopes),
            "tenant_id": tenant.strip(),
            "k": k,
        })
        if err:
            return f"Error calling Lore: {err}"
        hits = data.get("results", [])
        if not hits:
            return "No results found."
        lines = [
            f"{i + 1}. [{h.get('title') or h['note_id']}] {h.get('heading_path', '')} (score: {h.get('score', 0):.3f})"
            for i, h in enumerate(hits)
        ]
        return "\n".join(lines)

    @_mcp.tool()
    def lore_graph(scopes: list[str] | None = None, tenant: str | None = None) -> str:
        """Return node and edge counts for your Lore knowledge graph.

        Args:
            scopes: List of ACL scope IDs the caller can read (required, never empty).
                Falls back to the LORE_SCOPES env var (comma-separated) if omitted.
            tenant: Tenant namespace to query (required, never empty).
                Falls back to the LORE_TENANT env var if omitted.
        """
        scopes, tenant = _apply_env_defaults(scopes, tenant)
        err = _check_scopes(scopes)
        if err:
            return err
        err = _check_tenant(tenant)
        if err:
            return err
        if not _backend_up():
            return _BACKEND_DOWN_MSG
        params = urllib.parse.urlencode({"tenant": tenant.strip(), "scopes": ",".join(_clean_scopes(scopes))})
        data, err = _safe_get(f"/graph?{params}")
        if err:
            return f"Error calling Lore: {err}"
        nodes = len(data.get("nodes", []))
        edges = len(data.get("edges", []))
        return f"Graph: {nodes} nodes, {edges} edges."

    def main() -> None:
        _mcp.run()

except ImportError:
    # Fall back to the low-level MCP SDK (mcp >= 1.0 without FastMCP).
    import asyncio
    from mcp.server import Server as _Server
    from mcp.server.stdio import stdio_server as _stdio_server
    from mcp import types as _types

    _server = _Server("lore")

    @_server.list_tools()
    async def _list_tools() -> list[_types.Tool]:
        return [
            _types.Tool(
                name="lore_ask",
                description="Ask a question against the user's Lore knowledge base and get a cited answer. Lore is this user's long-term memory (past decisions, project state, fixes) — prefer it over guessing when the user references prior work.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "question": {"type": "string", "description": "Natural language question."},
                        "scopes": {"type": "array", "items": {"type": "string"},
                                   "description": "ACL scope IDs the caller can read (required, never "
                                                  "empty). Falls back to the LORE_SCOPES env var "
                                                  "(comma-separated) if omitted."},
                        "tenant": {"type": "string",
                                   "description": "Tenant namespace to query (required, never empty). "
                                                  "Falls back to the LORE_TENANT env var if omitted."},
                    },
                    "required": ["question"],
                },
            ),
            _types.Tool(
                name="lore_search",
                description="Search the user's Lore knowledge base and return ranked hits. CALL THIS FIRST at the start of any non-trivial task — Lore holds accumulated project knowledge (architecture, past fixes, decisions) not in your context.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "scopes": {"type": "array", "items": {"type": "string"},
                                   "description": "ACL scope IDs (required, never empty). Falls back to "
                                                  "the LORE_SCOPES env var (comma-separated) if omitted."},
                        "tenant": {"type": "string",
                                   "description": "Tenant namespace to query (required, never empty). "
                                                  "Falls back to the LORE_TENANT env var if omitted."},
                        "k": {"type": "integer", "default": 10},
                    },
                    "required": ["query"],
                },
            ),
            _types.Tool(
                name="lore_graph",
                description="Return node and edge counts for your Lore knowledge graph.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "scopes": {"type": "array", "items": {"type": "string"},
                                   "description": "ACL scope IDs (required, never empty). Falls back to "
                                                  "the LORE_SCOPES env var (comma-separated) if omitted."},
                        "tenant": {"type": "string",
                                   "description": "Tenant namespace to query (required, never empty). "
                                                  "Falls back to the LORE_TENANT env var if omitted."},
                    },
                    "required": [],
                },
            ),
        ]

    @_server.call_tool()
    async def _call_tool(name: str, arguments: dict) -> list[_types.TextContent]:
        scopes, tenant = _apply_env_defaults(arguments.get("scopes"), arguments.get("tenant"))
        err = _check_scopes(scopes)
        if err:
            return [_types.TextContent(type="text", text=err)]
        err = _check_tenant(tenant)
        if err:
            return [_types.TextContent(type="text", text=err)]
        clean_scopes = _clean_scopes(scopes)
        tenant = tenant.strip()
        if not _backend_up():
            return [_types.TextContent(type="text", text=_BACKEND_DOWN_MSG)]
        if name == "lore_ask":
            data, err = _safe_post("/ask", {
                "question": arguments["question"],
                "principal_scopes": clean_scopes,
                "tenant_id": tenant,
            })
            if err:
                return [_types.TextContent(type="text", text=f"Error: {err}")]
            return [_types.TextContent(type="text", text=data.get("answer", "No answer."))]
        elif name == "lore_search":
            data, err = _safe_post("/search", {
                "query": arguments["query"],
                "scopes": clean_scopes,
                "k": arguments.get("k", 10),
                "tenant_id": tenant,
            })
            if err:
                return [_types.TextContent(type="text", text=f"Error: {err}")]
            hits = data.get("results", [])
            if not hits:
                return [_types.TextContent(type="text", text="No results found.")]
            lines = [
                f"{i + 1}. [{h.get('title') or h['note_id']}] {h.get('heading_path', '')} (score: {h.get('score', 0):.3f})"
                for i, h in enumerate(hits)
            ]
            return [_types.TextContent(type="text", text="\n".join(lines))]
        elif name == "lore_graph":
            params = urllib.parse.urlencode({"tenant": tenant, "scopes": ",".join(clean_scopes)})
            data, err = _safe_get(f"/graph?{params}")
            if err:
                return [_types.TextContent(type="text", text=f"Error: {err}")]
            nodes = len(data.get("nodes", []))
            edges = len(data.get("edges", []))
            return [_types.TextContent(type="text", text=f"Graph: {nodes} nodes, {edges} edges.")]
        else:
            return [_types.TextContent(type="text", text=f"Unknown tool: {name}")]

    def main() -> None:
        async def _run() -> None:
            async with _stdio_server() as (r, w):
                await _server.run(r, w, _server.create_initialization_options())
        asyncio.run(_run())


if __name__ == "__main__":
    main()
