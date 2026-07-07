---
name: lore-integrate
description: Wire this agent/repo into Lore, the local-first memory OS — one command sets up the MCP tools (lore_ask/search/recall/remember), pins your agent identity, and verifies the loop with a remember→recall round-trip. Use when the user asks to "connect to Lore", "give this agent memory", or "set up lore".
---

# lore-integrate — give this agent a shared, permissioned memory

Lore is the user's local-first knowledge OS (repo: `vault-kos`; backend on
`http://localhost:8099`). This skill wires the CURRENT agent into it so the
agent can recall the user's accumulated knowledge and deposit durable
memories of its own — isolated per-agent by ACL scope, redacted server-side.

## Steps (do them in order; stop and report on any failure)

### 1. Health check
Run the doctor. It verifies the backend, the local API token, the embedding
model cache, and index coverage:

```bash
python -m lore.cli doctor --tenant <TENANT> 2>/dev/null || lore doctor --tenant <TENANT>
```

- Backend down → tell the user to open the Lore desktop app (it spawns and
  owns the backend), then re-run. Do not try to start uvicorn yourself unless
  the user says this machine has no desktop install.
- Discover identity when unknown: read `%APPDATA%/lore-desktop/lore-config.json`
  (fields `tenant`, `scope`, `localToken`). NEVER print the token.

### 2. Pick the agent name
Lowercase, `[a-z0-9_-]`, stable across sessions — e.g. `claude-code`,
`wingman`, `h-cli`. First write self-provisions it; no registration exists
or is needed.

### 3. Register the MCP server for this client
For Claude Code (project or user scope, ask the user which):

```bash
claude mcp add lore -e LORE_TENANT=<TENANT> -e LORE_SCOPES=<SCOPE> -e LORE_AGENT=<AGENT_NAME> -e LORE_LOCAL_TOKEN=<TOKEN> -- python -m lore.mcp_server
```

(The desktop app's Settings → hooks installer does the same thing with the
frozen backend binary for non-dev machines — prefer that path when the user
has the app installed: point them at Settings → "Install hooks".)

For other MCP clients, the server command is `python -m lore.mcp_server`
(or the packaged `lore-backend mcp`), with the same four env vars.

### 4. Verify the loop end-to-end
Round-trip through the HTTP API directly (works even before the MCP client
restarts). Use the token from step 1 in the `X-Lore-Token` header:

```bash
# remember
curl -s -X POST http://localhost:8099/memory -H "content-type: application/json" -H "X-Lore-Token: $TOKEN" -d '{"agent":"<AGENT_NAME>","tenant":"<TENANT>","session_id":"integrate-check","text":"lore-integrate verification memory: this agent is wired into Lore."}'
# recall it back
curl -s -X POST http://localhost:8099/context-pack -H "content-type: application/json" -H "X-Lore-Token: $TOKEN" -d '{"task":"lore-integrate verification","scopes":["agent:<AGENT_NAME>"],"tenant_id":"<TENANT>","budget":400}'
```

The recall must contain the verification memory. If it does, report success
with: the agent name, its scope (`agent:<name>`), and the three MCP tools now
available (`lore_recall` for budgeted context, `lore_remember` for durable
memories, `lore_ask` for cited answers).

### 5. Teach the agent the usage contract
Add to the project's CLAUDE.md (or equivalent) — with the user's approval:

```markdown
## Lore memory
- START of non-trivial tasks: call lore_recall with a one-line task summary.
- END of tasks that produced a durable decision/fix/preference: lore_remember
  (distilled fact, not a transcript; use a stable key to update instead of duplicate).
- Your agent scope is agent:<AGENT_NAME>; shared knowledge is in <SCOPE>.
```

## Notes
- Writes are capped per hour and redacted server-side; the human can inspect
  every agent's activity at `GET /memory/agents?tenant=<TENANT>`.
- `lore doctor` is the first thing to re-run when anything misbehaves.
