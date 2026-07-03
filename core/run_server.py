"""Frozen-backend entry point for the packaged Lore desktop app.

PyInstaller freezes this into a standalone `lore-backend` executable that the Electron
app spawns — so the shipped app needs no system Python. The embedded stores are selected
by env (QDRANT_PATH for embedded Qdrant; DATABASE_URL for embedded Postgres), set by main.js.

Two modes, one binary:
    lore-backend        → the FastAPI HTTP backend (default)
    lore-backend mcp    → the Lore MCP server on stdio (read-only knowledge tools)
The MCP mode is what the packaged app registers with Claude Code / Codex — a user
who installed the dmg/exe has no repo, no venv, and no system Python with `mcp`
installed, so the MCP server must ship inside the same frozen bundle.
"""
import os
import sys


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "mcp":
        from lore.mcp_server import main as mcp_main
        mcp_main()
        return
    import uvicorn
    port = int(os.environ.get("LORE_PORT", "8099"))
    # import here so a --collect-all of lore happens via this module's import graph
    from lore.api import app
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
