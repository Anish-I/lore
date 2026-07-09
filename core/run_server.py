"""Frozen-backend entry point for the packaged Lore desktop app.

PyInstaller freezes this into a standalone `lore-backend` executable that the Electron
app spawns — so the shipped app needs no system Python. The embedded stores are selected
by env (QDRANT_PATH for embedded Qdrant; DATABASE_URL for embedded Postgres), set by main.js.

Three modes, one binary:
    lore-backend        → the FastAPI HTTP backend (default)
    lore-backend mcp    → the Lore MCP server on stdio (read-only knowledge tools)
    lore-backend cli …  → the `lore` CLI (capture/ask/search/graph/doctor/next)
The MCP and CLI modes are what the packaged app registers with Claude Code /
Codex and installs on PATH — a user who installed the dmg/exe has no repo, no
venv, and no system Python with `lore` on it, so both must ship inside the same
frozen bundle. (The CLI installer points its `lore` wrapper at `lore-backend cli`
in packaged builds; see desktop/cli-installer.js.)
"""
import os
import sys


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "mcp":
        from lore.mcp_server import main as mcp_main
        mcp_main()
        return
    if len(sys.argv) > 1 and sys.argv[1] == "cli":
        # Drop the "cli" token so lore.cli's argparse sees its own subcommands
        # (capture/ask/…) at argv[1], exactly as `python -m lore.cli` would.
        from lore.cli import main as cli_main
        del sys.argv[1]
        cli_main()
        return
    import uvicorn
    port = int(os.environ.get("LORE_PORT", "8099"))
    # import here so a --collect-all of lore happens via this module's import graph
    from lore.api import app
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
