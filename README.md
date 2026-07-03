<div align="center">

<img src="desktop/renderer/design/assets/sprites/lore-familiar.png" alt="Lore" width="140" />

# Lore 📖

**A local-first knowledge OS that replaces Obsidian — and actually remembers.**

Your notes, your machine, your graph. Lore watches your files, links them into a knowledge graph,
and answers questions over everything with recall-obsessed, permissioned retrieval. No cloud, no API
keys, nothing leaves your machine.

[![CI](https://github.com/Anish-I/lore/actions/workflows/ci.yml/badge.svg)](https://github.com/Anish-I/lore/actions/workflows/ci.yml)
![Python](https://img.shields.io/badge/python-3.11+-3776AB?logo=python&logoColor=white)
![Electron](https://img.shields.io/badge/desktop-Electron-47848F?logo=electron&logoColor=white)
![Local-first](https://img.shields.io/badge/local--first-no%20cloud-22c55e)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
![Status](https://img.shields.io/badge/stage-active%20development-orange)

```
$ lore ask "what did I decide about the kalshi bot?"
```

</div>

---

## 📦 Download (beta)

| Platform | |
|---|---|
| 🍎 **macOS** (Apple Silicon) | [Download the dmg](https://github.com/Anish-I/lore/releases/latest) — first launch: right-click → Open (unsigned beta) |
| 🪟 **Windows** | [Download the installer](https://github.com/Anish-I/lore/releases/latest) — SmartScreen: More info → Run anyway |
| 🐧 **Linux** | AppImage/deb via the [release workflow artifacts](https://github.com/Anish-I/lore/actions/workflows/release.yml) |

Everything ships self-contained — no Python, no database, no API keys required.

## ✨ What makes Lore different

- **🔒 Local-first & private** — local models (fastembed BGE + cross-encoder, Ollama for answers) run
  fully on-device. No keys, no telemetry, no data leaving the building. Voyage is a *pluggable* option,
  never a dependency.
- **🎯 Recall you can trust** — hybrid **dense (BGE) + BM25 sparse + cross-encoder rerank** with
  query-adaptive fusion and a dedicated exact-ID lane. Built and tuned against adversarial near-duplicate
  corpora.
- **🕸️ A real knowledge graph** — wikilinks, folders and tags become edges; a zoomable canvas (d3-force)
  lets you explore connections the way you would in Obsidian, click a node to open the note.
- **🧹 Self-maintaining** — Lore's **upkeep job converts ephemeral date/session notes into durable topic
  nodes** automatically, folding their content under topics and keeping the graph topic-centric over time.
- **🪝 Lore Hooks** — one-click auto-capture from Claude Code / Codex / Copilot straight into your graph
  (redacted, debounced, fully local) so your AI work becomes searchable knowledge.
- **🧙 Wizards (installable knowledge bases)** — an app-store of curated KBs you can install, rate, and
  sync into your library.
- **🔌 MCP server + CLI** — expose your Lore to any AI tool (`lore_ask`, `lore_search`, `lore_graph`) and
  query it from the terminal (`lore ask`, `lore search`).
- **👥 Permissioned by design** — every note carries a scope (`private` / `team` / `enterprise`); retrieval
  is filtered *inside* the query, so you only ever see what you're allowed to. Built to scale from solo to
  teams (the long game: a self-hosted **Glean** alternative).

## 🏗️ Architecture

| Layer | What |
|-------|------|
| **Desktop** (`desktop/`) | Electron app — file explorer, editor, Ask, graph, Hooks, Wizards, Settings. |
| **Python core** (`core/lore/`) | FastAPI on `:8099` — ingestion, indexing, recall, upkeep, capture. |
| **Embedded Qdrant** | Vector + BM25 retrieval with the ACL filter applied *in-query* — runs in-process, no server. |
| **SQLite** | Source of truth — notes, original bodies, scopes, graph edges. (The same code runs Postgres for a deployed team server.) |

**How it all fits together (diagrams + the source-of-truth answer):** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

**Pipeline:** hybrid dense + BM25 → RRF → 1-hop graph expand → cross-encoder rerank → cited answer.
**Models:** BGE-small-en-v1.5 (dense) · Qdrant/bm25 (sparse) · ms-marco-MiniLM-L-6-v2 (rerank) · Ollama (answers).

## 🚀 Quick start

**Desktop app (recommended)** — no services needed; the local store is SQLite + embedded Qdrant:
```bash
python3.11 -m venv .venv && .venv/bin/pip install -e "./core[dev,local]"
cd desktop && npm install
npm start                       # spawns the Python backend + opens the app
```

**Backend only (dev)**
```bash
cd core && pip install -e ".[dev,local]"   # local = offline models
python -m uvicorn lore.api:app --port 8099 # http://localhost:8099/
```

**Server-parity lane (optional, for the deployed/team configuration):**
```bash
docker compose up -d            # Qdrant :6333 + Postgres :5433
LORE_TEST_PG=1 pytest -q        # run the suite against real servers
```

## 💻 CLI & MCP

```bash
pip install -e ./core           # installs the `lore` and `lore-mcp` commands

lore ask "summarize my wingman architecture" --scope private
lore search "rag rerank"
lore graph                      # node/edge counts
```

Activate the **MCP server** from the desktop app (Settings → Integrations) or add it manually to
`~/.claude/.mcp.json`:
```json
{ "mcpServers": { "lore": { "command": "python", "args": ["-m", "lore.mcp_server"], "cwd": "core" } } }
```
Read-only tools `lore_ask`, `lore_search`, `lore_graph` let any MCP client query your Lore.

## 🧪 Tests & CI

```bash
cd core && pytest -q            # unit + integration (uses FakeEmbedder, no model downloads)
```
Every push runs the [CI workflow](.github/workflows/ci.yml): the Python suite against ephemeral
Postgres + Qdrant services, plus Electron main-process syntax and renderer JSX validation. Tagging
`v*` triggers the [release workflow](.github/workflows/release.yml) to build the desktop installer.

## 🗺️ Roadmap

- Bundle the Python/Qdrant sidecar for a true standalone signed `.exe`
- Broader ingestion (Docling / Marker / OCR)
- GitHub `.lore` packages — commit a tiny bundle of a repo's notes that decompresses into Lore on pull
- Team / enterprise cross-vault scopes + auth
- Edge agent: local watch/distill/embed with a durable server as source of truth

See `docs/superpowers/specs/` for the design spec and `docs/BACKLOG.md` for the backlog.

## 📜 License

Licensed under the **[Apache License 2.0](LICENSE)** — free to use, modify, and distribute, with an
explicit patent grant. © 2026 Anish Ivaturi.
