"""Lore MCP server — read-only Lore knowledge tools over stdio.

Exposes three tools:
    lore_ask(question, scopes)     — answer a question from the knowledge base
    lore_search(query, scopes, k)  — return ranked chunk hits
    lore_graph(scopes)             — return node/edge counts

scopes is REQUIRED on every tool; never defaults to all.

Run with:
    python -m lore.mcp_server
or via the installed script:
    lore-mcp
"""
import json
import socket
import urllib.request
import urllib.error

BASE_URL = "http://localhost:8099"
_HTTP_TIMEOUT = 15   # seconds; applied to every real API call (not just health check)

_BACKEND_DOWN_MSG = (
    "Lore backend is not running. "
    "Start it with: uvicorn lore.api:app --port 8099"
)
_SCOPES_REQUIRED_MSG = (
    "Error: scopes is required and must not be empty — "
    "Lore never defaults to all-scopes access."
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


try:
    from mcp.server.fastmcp import FastMCP as _FastMCP

    _mcp = _FastMCP("lore")

    @_mcp.tool()
    def lore_ask(question: str, scopes: list[str]) -> str:
        """Ask a question against your Lore knowledge base.

        Args:
            question: Natural language question.
            scopes: List of ACL scope IDs the caller can read (required, never empty).
        """
        err = _check_scopes(scopes)
        if err:
            return err
        if not _backend_up():
            return _BACKEND_DOWN_MSG
        data, err = _safe_post("/ask", {
            "question": question,
            "principal_scopes": scopes,
            "tenant_id": "solo",
        })
        if err:
            return f"Error calling Lore: {err}"
        return data.get("answer", "No answer returned.")

    @_mcp.tool()
    def lore_search(query: str, scopes: list[str], k: int = 10) -> str:
        """Search your Lore knowledge base and return ranked hits.

        Args:
            query: Search query.
            scopes: List of ACL scope IDs the caller can read (required, never empty).
            k: Number of results to return (default 10, max 50).
        """
        err = _check_scopes(scopes)
        if err:
            return err
        if not _backend_up():
            return _BACKEND_DOWN_MSG
        data, err = _safe_post("/search", {"query": query, "scopes": scopes, "k": k})
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
    def lore_graph(scopes: list[str]) -> str:
        """Return node and edge counts for your Lore knowledge graph.

        Args:
            scopes: List of ACL scope IDs the caller can read (required, never empty).
        """
        err = _check_scopes(scopes)
        if err:
            return err
        if not _backend_up():
            return _BACKEND_DOWN_MSG
        data, err = _safe_get(f"/graph?scopes={','.join(scopes)}")
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
                description="Ask a question against your Lore knowledge base.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "question": {"type": "string", "description": "Natural language question."},
                        "scopes": {"type": "array", "items": {"type": "string"},
                                   "description": "ACL scope IDs the caller can read (required)."},
                    },
                    "required": ["question", "scopes"],
                },
            ),
            _types.Tool(
                name="lore_search",
                description="Search your Lore knowledge base and return ranked hits.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "scopes": {"type": "array", "items": {"type": "string"},
                                   "description": "ACL scope IDs (required)."},
                        "k": {"type": "integer", "default": 10},
                    },
                    "required": ["query", "scopes"],
                },
            ),
            _types.Tool(
                name="lore_graph",
                description="Return node and edge counts for your Lore knowledge graph.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "scopes": {"type": "array", "items": {"type": "string"},
                                   "description": "ACL scope IDs (required)."},
                    },
                    "required": ["scopes"],
                },
            ),
        ]

    @_server.call_tool()
    async def _call_tool(name: str, arguments: dict) -> list[_types.TextContent]:
        scopes = arguments.get("scopes", [])
        err = _check_scopes(scopes)
        if err:
            return [_types.TextContent(type="text", text=err)]
        if not _backend_up():
            return [_types.TextContent(type="text", text=_BACKEND_DOWN_MSG)]
        if name == "lore_ask":
            data, err = _safe_post("/ask", {
                "question": arguments["question"],
                "principal_scopes": scopes,
                "tenant_id": "solo",
            })
            if err:
                return [_types.TextContent(type="text", text=f"Error: {err}")]
            return [_types.TextContent(type="text", text=data.get("answer", "No answer."))]
        elif name == "lore_search":
            data, err = _safe_post("/search", {
                "query": arguments["query"],
                "scopes": scopes,
                "k": arguments.get("k", 10),
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
            data, err = _safe_get(f"/graph?scopes={','.join(scopes)}")
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
