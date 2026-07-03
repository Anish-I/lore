# Contributing to Lore

## Dev setup

```bash
# Python backend (FastAPI + SQLite + embedded Qdrant)
python3.11 -m venv .venv
.venv/bin/pip install -e "./core[dev,local]"

# Electron desktop
cd desktop && npm install

# Run the app (spawns the backend automatically from the venv)
npm start
```

## Tests & lint — run before every PR

```bash
# Python: 160+ tests, no services needed (SQLite + embedded Qdrant + fake models)
cd core && VAULT_FAKE=1 ../.venv/bin/python -m pytest -q
../.venv/bin/ruff check .

# JS: unit tests + lint
cd desktop && npm test && npm run lint
```

CI runs the same checks on every PR (pytest across ubuntu/windows/macos, plus a
Postgres+Qdrant server-parity lane, eslint, vitest, and a whole-renderer Babel
JSX parse). All jobs must be green.

## Branches

- `main` — releases are tagged from here (`v*` tags trigger the 3-platform
  release build; see `docs/RELEASING.md`).
- `dev` — integration branch; PRs target `dev`.

## Style

Match the file you're in. The codebase favors terse, heavily-commented code —
comments explain *constraints and why*, not what the next line does. Don't
introduce new dependencies without discussing in an issue first.
