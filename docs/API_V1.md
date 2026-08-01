# Lore `/api/v1` — the engine contract

This is the **frozen, versioned surface** a product UI depends on. The engine is
the car; every UI (town-clerk dashboard, etc.) is an interchangeable interior
that talks to Lore **only** through this contract — never by importing engine
internals. Decided 2026-07-23 after independent Codex + Sol architecture review.

## Rules

- **Additive within v1.** New fields/endpoints may be added; nothing is removed
  or changed in meaning. Breaking changes go to `/api/v2`.
- **Root routes are deprecated aliases.** `/ask`, `/search`, … still exist and
  behave identically (the desktop app and the Codex/Claude capture hooks use
  them), but new consumers should use `/api/v1/*`.
- **Three independently-versioned things:** the engine build (`ENGINE_VERSION`),
  the API contract (`API_VERSION = "v1"`), and the client SDK. Pin compatible
  ranges; don't consume "latest" silently.

## Handshake — call this first

```
GET /api/v1/health
```
```json
{
  "engine": "lore",
  "engine_version": "0.1.0",
  "api_version": "v1",
  "capabilities": ["/ask", "/search", "/context-pack", "/state", "/graph", "..."],
  "providers": { "codex": true, "claude": true, "byok": false }
}
```
A UI checks `api_version` before it trusts the service, and reads `providers` to
know which answer/enrichment backends are usable right now.

## Contract surface (curated)

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/v1/health` | version + capability + provider handshake |
| POST | `/api/v1/ask` | cited RAG answer (`provider`: codex/claude/byok/none) |
| POST | `/api/v1/search` | ranked hybrid retrieval |
| POST | `/api/v1/context-pack` | token-budgeted, cited context block for agents |
| GET  | `/api/v1/state` | query-less current-facts block |
| GET  | `/api/v1/graph` | knowledge-graph nodes/edges (ACL-filtered) |
| GET  | `/api/v1/notes/{id}` | note body + typed edges |
| POST | `/api/v1/ingest` | index external text |
| POST | `/api/v1/capture` | index a session transcript (redacted) |
| POST | `/api/v1/feedback` | thumbs vote → ranking signal |
| POST · GET · DELETE | `/api/v1/profiles` · `/profiles/{name}` | named retrieval profiles |
| GET  | `/api/v1/digest` · `/recent-prompts` · `/config/retrieval` · `/doctor` · `/stats` | read-only surfaces |

Admin/teams/upkeep/sections internals are intentionally **not** in the contract
yet — they stay root-only until promoted.

### Retrieval profiles — per-app tuning on a shared engine

Retrieval tuning (recency, rerank blend, entity boost, session down-weight, …)
used to be process-wide env vars, so an app that wanted its own tuning needed its
own engine process. A **profile** is that tuning stored as a named, per-tenant
object instead:

```bash
curl -X POST localhost:8099/api/v1/profiles -H 'content-type: application/json' \
     -d '{"name":"clerk-dashboard","tenant_id":"local","recency_weight":0.05,"entity_boost":0.35}'
```

`ask` / `search` / `context-pack` take an optional `profile` name. Resolution is
**request body → the API key's bound profile → the engine default**, and every
response echoes the `profile` it actually used, so an app can prove its tuning
applied. An unknown name is a `400`, never a silent fall back to the default.
Unknown knobs in a profile are rejected the same way. `"default"` is reserved: it
names the engine's own tuning and cannot be stored.

Bind a profile to a key so an app never passes one:
`apikeys.create_key(conn, tenant, user, profile="clerk-dashboard")`.

**Upgrade contract: a profile stores intent, not a snapshot.** Only the knobs you
actually changed are persisted, so an engine update keeps your deliberate tweaks
and refreshes every other knob to the new default — an app tuned for one domain
still inherits general recall improvements. (Setting a knob to today's default is
therefore not stored: it means "give me the default", and keeps tracking it.)
Responses always show the **effective** profile — every value in force, not the
diff. Knobs an engine no longer recognizes are dropped on load rather than
failing the request, so a renamed knob (or a downgrade) can't brick an app.

Full machine-readable spec: [`core/openapi-v1.json`](../core/openapi-v1.json)
(regenerate with `app.openapi()`).

## Client SDK — the "one script that calls Lore"

`lore.client.LoreClient` is a dependency-free (stdlib-only) HTTP client. Vendor
it into any lightweight UI:

```python
from lore.client import LoreClient

lore = LoreClient("http://127.0.0.1:8099", tenant="local", scopes=["engineering"])
lore.check_compatible()                      # raises on api_version mismatch
print(lore.ask("what did we decide about the split?", provider="claude")["answer"])
for hit in lore.search("api v1")["results"]:
    print(hit["title"], hit["score"])
```

Identity (`token` / `tenant` / `scopes`) and the default retrieval `profile`
default from `LORE_LOCAL_TOKEN` / `LORE_TENANT` / `LORE_SCOPES` / `LORE_PROFILE`,
matching the MCP server. A client-level `profile=` applies to every recall call;
pass `profile=` on `ask` / `search` / `context_pack` to override it per call.

## Providers (Codex subs / Claude subs / BYO key)

All three already work (`lore.llm_providers`):
- `codex` — Codex CLI, ChatGPT subscription OAuth, no API key.
- `claude` — Claude Code CLI, subscription OAuth, no API key.
- `byok` — any OpenAI-compatible endpoint via `LORE_LLM_API_KEY` (+ optional
  `LORE_LLM_BASE_URL`, `LORE_LLM_MODEL`).

Select per request: `LoreClient.ask(..., provider="codex")`. The handshake's
`providers` map reports which are live.

## The action boundary (do not cross)

Lore is memory + retrieval. Side-effectful domain actions ("reply to citizen",
"approve", "send") belong in the **product's own small backend**, never in Lore:

```
Town-clerk UI  →  town-clerk backend (actions, auth, audit)  →  Lore /api/v1 (context)
```

The product backend asks Lore for context before acting and records the outcome
after. Lore must never grow `send_citizen_reply()`.
