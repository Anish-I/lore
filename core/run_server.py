"""Frozen-backend entry point for the packaged Lore desktop app.

PyInstaller freezes this into a standalone `lore-backend` executable that the Electron
app spawns — so the shipped app needs no system Python. The embedded stores are selected
by env (QDRANT_PATH for embedded Qdrant; DATABASE_URL for embedded Postgres), set by main.js.
"""
import os
import uvicorn


def main():
    port = int(os.environ.get("LORE_PORT", "8099"))
    # import here so a --collect-all of lore happens via this module's import graph
    from lore.api import app
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
