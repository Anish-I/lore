"""Lore MCP server — read-only Lore knowledge tools over stdio.

Exposes three tools:
    lore_ask(question, scopes, tenant)     — answer a question from the knowledge base
    lore_search(query, scopes, tenant, k)  — return ranked chunk hits
    lore_graph(scopes, tenant)             — return node/edge counts
    lore_state(budget, scopes, tenant)     — budget-capped current-facts block

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


# Local API token — the desktop MCP registration sets LORE_LOCAL_TOKEN so the
# backend's on-device port lock accepts our requests.
_LOCAL_TOKEN = os.environ.get("LORE_LOCAL_TOKEN") or None


def _hdrs(base: dict | None = None) -> dict:
    h = dict(base or {})
    if _LOCAL_TOKEN:
        h["X-Lore-Token"] = _LOCAL_TOKEN
    return h


def _get_json(path: str, timeout: int = _HTTP_TIMEOUT) -> dict:
    req = urllib.request.Request(f"{BASE_URL}{path}", headers=_hdrs())
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _post_json(path: str, payload: dict, timeout: int = _HTTP_TIMEOUT) -> dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{BASE_URL}{path}", data=data,
        headers=_hdrs({"Content-Type": "application/json"}),
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


# --- Progressive-disclosure retrieval contract (2026-07-20) -----------------
# lore_search returns a compact, ID-FIRST index; lore_get(ids) hydrates full
# note bodies on demand. The loop "search (cheap scan) → pick → get (full
# text)" keeps agent token cost low and ends the dead-end where search showed
# titles but nothing was fetchable. Shared by both MCP server paths.
_GET_MAX_IDS = 8        # progressive disclosure: agents should pick, not bulk-dump
_GET_MAX_CHARS = 8000   # per-note body cap per call (long sessions: re-call or scroll)


def _format_search_hits(hits: list) -> str:
    """Compact index: rank, title, section, NOTE ID (the hydration handle),
    score, one-line snippet."""
    lines = []
    for i, h in enumerate(hits):
        snippet = " ".join(str(h.get("text") or "").split())[:140]
        lines.append(
            f"{i + 1}. [{h.get('title') or h.get('note_id')}] {h.get('heading_path', '')} "
            f"(id: {h.get('note_id')}, score: {h.get('score', 0):.3f})\n   {snippet}"
        )
    lines.append("\nHydrate any hit with lore_get(ids=[...]) to read full note bodies.")
    return "\n".join(lines)


def _hydrate_notes(ids: list, clean_scopes: list, tenant: str) -> str:
    """Fetch full note bodies by id via GET /notes/{id} (ACL enforced
    server-side; invisible notes read as not-found, never leaked)."""
    ids = [str(i).strip() for i in (ids or []) if str(i).strip()]
    if not ids:
        return "Error: ids is required — pass note ids from lore_search results."
    dropped = ids[_GET_MAX_IDS:]
    parts = []
    for nid in ids[:_GET_MAX_IDS]:
        params = urllib.parse.urlencode(
            {"tenant": tenant, "scopes": ",".join(clean_scopes)})
        data, err = _safe_get(f"/notes/{urllib.parse.quote(nid, safe='')}?{params}")
        if err or not data:
            parts.append(f"### {nid}\n(not found or not visible in your scopes)")
            continue
        body = str(data.get("body") or "")
        total = len(body)
        clipped = body[:_GET_MAX_CHARS]
        suffix = (f"\n[...truncated — {total} chars total; call lore_get again "
                  f"for the rest or narrow with lore_search]"
                  if total > _GET_MAX_CHARS else "")
        parts.append(
            f"### {data.get('title') or nid}  (id: {data.get('id')}, "
            f"scope: {data.get('scope')})\n{clipped}{suffix}")
    if dropped:
        parts.append(f"(capped at {_GET_MAX_IDS} ids per call — "
                     f"{len(dropped)} dropped: {', '.join(dropped)})")
    return "\n\n".join(parts)


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
        answer = data.get("answer", "No answer returned.")
        used = data.get("scopes_used") or []
        return f"{answer}\n\n_(answered from: {', '.join(used)})_" if used else answer

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
        return _format_search_hits(hits)

    @_mcp.tool()
    def lore_get(
        ids: list[str], scopes: list[str] | None = None, tenant: str | None = None
    ) -> str:
        """Hydrate full note bodies by id — the second half of the
        progressive-disclosure loop: lore_search gives a compact ID-first
        index; call THIS with the 1-3 ids worth reading in full. Cheaper than
        re-asking lore_ask and exact (no re-retrieval, no paraphrase risk).

        Args:
            ids: Note ids from lore_search results (max 8 per call).
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
        return _hydrate_notes(ids, _clean_scopes(scopes), tenant.strip())

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

    @_mcp.tool()
    def lore_remember(text: str, agent: str | None = None, title: str | None = None,
                      key: str | None = None, tenant: str | None = None) -> str:
        """Store a memory in the user's Lore knowledge base (the shared memory bus).

        Call this when you learn something durable worth keeping across sessions:
        a decision, a fix, a preference, project state. The memory lands in YOUR
        agent scope (isolated by ACL) and is redacted server-side before storage.

        Args:
            text: The memory content (markdown ok). Keep it a distilled fact or
                decision, not a transcript dump.
            agent: Your agent name (lowercase, e.g. 'claude-code', 'wingman').
                Falls back to the LORE_AGENT env var. First write self-provisions
                the agent — no registration needed.
            title: Optional short title; derived from the first line if omitted.
            key: Optional stable key — rewriting the same key UPDATES that memory
                instead of creating a new one.
            tenant: Tenant namespace (falls back to LORE_TENANT).
        """
        agent = (agent or os.environ.get("LORE_AGENT") or "").strip().lower()
        if not agent:
            return "Error: agent is required (or set the LORE_AGENT env var)."
        _, tenant = _apply_env_defaults(["x"], tenant)
        err = _check_tenant(tenant)
        if err:
            return err
        if not _backend_up():
            return _BACKEND_DOWN_MSG
        data, err = _safe_post("/memory", {
            "agent": agent, "text": text, "title": title,
            "session_id": key, "tenant": tenant.strip(),
        })
        if err:
            return f"Error calling Lore: {err}"
        return f"Remembered as {data.get('note_id')} in scope {data.get('scope')} ({data.get('chunks')} chunk(s))."

    @_mcp.tool()
    def lore_recall(task: str, budget: int = 4000, scopes: list[str] | None = None,
                    agent: str | None = None, tenant: str | None = None) -> str:
        """Recall a token-budgeted context pack for a task from the user's Lore
        knowledge base — retrieval + rerank + greedy fill to budget, every item
        cited. PREFER this over lore_search when you want ready-to-use context
        rather than a hit list.

        Args:
            task: What you're working on, in a sentence.
            budget: Token budget for the pack (default 4000).
            scopes: ACL scopes to read (falls back to LORE_SCOPES). Your own
                agent scope is added automatically when `agent`/LORE_AGENT is set.
            agent: Your agent name — adds agent:<name> to the readable scopes.
            tenant: Tenant namespace (falls back to LORE_TENANT).
        """
        scopes, tenant = _apply_env_defaults(scopes, tenant)
        agent = (agent or os.environ.get("LORE_AGENT") or "").strip().lower()
        scopes = _clean_scopes(scopes or [])
        if agent:
            ascope = f"agent:{agent}"
            if ascope not in scopes:
                scopes = scopes + [ascope]
        err = _check_scopes(scopes)
        if err:
            return err
        err = _check_tenant(tenant)
        if err:
            return err
        if not _backend_up():
            return _BACKEND_DOWN_MSG
        data, err = _safe_post("/context-pack", {
            "task": task, "scopes": scopes, "tenant_id": tenant.strip(), "budget": budget,
        })
        if err:
            return f"Error calling Lore: {err}"
        pack = data.get("pack") or "No relevant context found."
        return f"{pack}\n\n_(context pack: {data.get('tokens_total')} tokens over {len(data.get('items') or [])} sources)_"

    @_mcp.tool()
    def lore_state(
        budget: int = 800, scopes: list[str] | None = None, tenant: str | None = None
    ) -> str:
        """Compile the user's CURRENT knowledge state into one budget-capped block.

        Query-less ambient priming: newest facts first, superseded (stale) notes
        excluded entirely. Use lore_recall when you have a specific task to pack
        context for; use THIS at session start when you don't yet know what
        you'll need.

        Args:
            budget: Approximate token cap for the block (default 800, max 4000).
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
        params = urllib.parse.urlencode({
            "tenant": tenant.strip(), "scopes": ",".join(_clean_scopes(scopes)),
            "budget": budget,
        })
        data, err = _safe_get(f"/state?{params}")
        if err:
            return f"Error calling Lore: {err}"
        block = data.get("block") or "No current state available."
        return f"{block}\n\n_({data.get('count', 0)} facts, ~{data.get('tokens_est', 0)} tokens)_"

    @_mcp.tool()
    def lore_profile(owner: str | None = None, scopes: list[str] | None = None,
                     tenant: str | None = None) -> str:
        """Read the user's explicit, editable Lore memory and preferences.

        This tool is read-only. Agents cannot mutate or approve the user model.
        Owner falls back to LORE_OWNER; scopes and tenant use Lore's standard
        environment defaults.
        """
        scopes, tenant = _apply_env_defaults(scopes, tenant)
        owner = (owner or os.environ.get("LORE_OWNER") or "").strip()
        err = _check_scopes(scopes)
        if err:
            return err
        err = _check_tenant(tenant)
        if err:
            return err
        if not owner:
            return "Error: owner is required (or set LORE_OWNER)."
        if not _backend_up():
            return _BACKEND_DOWN_MSG
        params = urllib.parse.urlencode({
            "tenant": tenant.strip(), "owner": owner,
            "scopes": ",".join(_clean_scopes(scopes)),
        })
        data, err = _safe_get(f"/learn/memory?{params}")
        if err:
            return f"Error calling Lore: {err}"
        docs = data.get("documents") or []
        if not docs:
            return "Lore has no explicit personal context yet."
        labels = {"user": "About the user", "memory": "Working memory"}
        return "\n\n".join(
            f"## {labels.get(d.get('kind'), d.get('kind', 'Memory'))}\n{d.get('text', '')}"
            for d in docs
        )

    @_mcp.tool()
    def lore_recall_sessions(
        mode: str = "browse", query: str | None = None, note_id: str | None = None,
        offset: int = 0, limit: int = 20, scopes: list[str] | None = None,
        tenant: str | None = None,
    ) -> str:
        """Find and continue reading past agent sessions without an LLM call.

        Modes: browse recent sessions; discovery searches sessions by natural
        language; scroll reads a bounded window from one returned note_id.
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
        data, err = _safe_post("/sessions/recall", {
            "mode": mode, "query": query, "note_id": note_id,
            "offset": offset, "limit": limit,
            "scopes": _clean_scopes(scopes), "tenant": tenant.strip(),
        })
        if err:
            return f"Error calling Lore: {err}"
        if mode == "scroll":
            next_offset = data.get("next_offset")
            suffix = f"\n\n_(continue at offset {next_offset})_" if next_offset is not None else ""
            return (data.get("text") or "No session text found.") + suffix
        rows = data.get("sessions") or []
        if not rows:
            return "No matching sessions found."
        return "\n".join(
            f"{i + 1}. [{r.get('title') or r.get('note_id')}] "
            f"(note_id: {r.get('note_id')})\n   {r.get('excerpt') or r.get('text') or ''}"
            for i, r in enumerate(rows)
        )

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
                name="lore_get",
                description="Hydrate full note bodies by id (max 8). Second half of the progressive-disclosure loop: lore_search returns a compact ID-first index — call this with the few ids worth reading in full instead of re-asking.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "ids": {"type": "array", "items": {"type": "string"},
                                "description": "Note ids from lore_search results (max 8 per call)."},
                        "scopes": {"type": "array", "items": {"type": "string"},
                                   "description": "ACL scope IDs (required, never empty). Falls back to "
                                                  "the LORE_SCOPES env var (comma-separated) if omitted."},
                        "tenant": {"type": "string",
                                   "description": "Tenant namespace to query (required, never empty). "
                                                  "Falls back to the LORE_TENANT env var if omitted."},
                    },
                    "required": ["ids"],
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
            _types.Tool(
                name="lore_remember",
                description="Store a durable memory (decision, fix, preference, project state) in the user's Lore knowledge base under YOUR agent scope. First write self-provisions the agent.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "text": {"type": "string", "description": "Distilled memory content (markdown ok)."},
                        "agent": {"type": "string", "description": "Agent name (lowercase). Falls back to LORE_AGENT."},
                        "title": {"type": "string"},
                        "key": {"type": "string", "description": "Stable key — same key updates the memory."},
                        "tenant": {"type": "string", "description": "Falls back to LORE_TENANT."},
                    },
                    "required": ["text"],
                },
            ),
            _types.Tool(
                name="lore_recall",
                description="Recall a token-budgeted, cited context pack for a task from the user's Lore knowledge base. Prefer over lore_search when you want ready-to-use context.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "task": {"type": "string"},
                        "budget": {"type": "integer", "default": 4000},
                        "scopes": {"type": "array", "items": {"type": "string"},
                                   "description": "Falls back to LORE_SCOPES; agent:<name> auto-added when agent/LORE_AGENT set."},
                        "agent": {"type": "string"},
                        "tenant": {"type": "string", "description": "Falls back to LORE_TENANT."},
                    },
                    "required": ["task"],
                },
            ),
            _types.Tool(
                name="lore_state",
                description="Compile the user's CURRENT knowledge state into one budget-capped block (newest first, superseded notes excluded). Query-less ambient priming — use lore_recall for task-specific context.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "budget": {"type": "integer", "default": 800,
                                   "description": "Approximate token cap for the block (max 4000)."},
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
            _types.Tool(
                name="lore_profile",
                description="Read the user's explicit, editable Lore memory and preferences. Read-only; agents cannot mutate the user model.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "owner": {"type": "string", "description": "Falls back to LORE_OWNER."},
                        "scopes": {"type": "array", "items": {"type": "string"}},
                        "tenant": {"type": "string"},
                    },
                    "required": [],
                },
            ),
            _types.Tool(
                name="lore_recall_sessions",
                description="Browse, discover, or scroll past agent sessions without an LLM call.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "mode": {"type": "string", "enum": ["browse", "discovery", "scroll"], "default": "browse"},
                        "query": {"type": "string"},
                        "note_id": {"type": "string"},
                        "offset": {"type": "integer", "default": 0},
                        "limit": {"type": "integer", "default": 20},
                        "scopes": {"type": "array", "items": {"type": "string"}},
                        "tenant": {"type": "string"},
                    },
                    "required": [],
                },
            ),
        ]

    @_server.call_tool()
    async def _call_tool(name: str, arguments: dict) -> list[_types.TextContent]:
        scopes, tenant = _apply_env_defaults(arguments.get("scopes"), arguments.get("tenant"))
        _agent = (arguments.get("agent") or os.environ.get("LORE_AGENT") or "").strip().lower()
        if name == "lore_recall" and _agent:
            ascope = f"agent:{_agent}"
            scopes = list(scopes or [])
            if ascope not in scopes:
                scopes.append(ascope)
        if name != "lore_remember":
            err = _check_scopes(scopes)
            if err:
                return [_types.TextContent(type="text", text=err)]
        err = _check_tenant(tenant)
        if err:
            return [_types.TextContent(type="text", text=err)]
        clean_scopes = _clean_scopes(scopes or [])
        tenant = tenant.strip()
        if not _backend_up():
            return [_types.TextContent(type="text", text=_BACKEND_DOWN_MSG)]
        if name == "lore_remember":
            if not _agent:
                return [_types.TextContent(type="text", text="Error: agent is required (or set LORE_AGENT).")]
            data, err = _safe_post("/memory", {
                "agent": _agent, "text": arguments.get("text") or "",
                "title": arguments.get("title"), "session_id": arguments.get("key"),
                "tenant": tenant,
            })
            if err:
                return [_types.TextContent(type="text", text=f"Error: {err}")]
            return [_types.TextContent(
                type="text",
                text=f"Remembered as {data.get('note_id')} in scope {data.get('scope')}.")]
        if name == "lore_recall":
            data, err = _safe_post("/context-pack", {
                "task": arguments.get("task") or "",
                "scopes": clean_scopes, "tenant_id": tenant,
                "budget": arguments.get("budget", 4000),
            })
            if err:
                return [_types.TextContent(type="text", text=f"Error: {err}")]
            pack = data.get("pack") or "No relevant context found."
            return [_types.TextContent(
                type="text",
                text=f"{pack}\n\n_(context pack: {data.get('tokens_total')} tokens)_")]
        if name == "lore_ask":
            data, err = _safe_post("/ask", {
                "question": arguments["question"],
                "principal_scopes": clean_scopes,
                "tenant_id": tenant,
            })
            if err:
                return [_types.TextContent(type="text", text=f"Error: {err}")]
            _ans = data.get("answer", "No answer.")
            _used = data.get("scopes_used") or []
            if _used:
                _ans = f"{_ans}\n\n_(answered from: {', '.join(_used)})_"
            return [_types.TextContent(type="text", text=_ans)]
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
            return [_types.TextContent(type="text", text=_format_search_hits(hits))]
        elif name == "lore_get":
            return [_types.TextContent(
                type="text",
                text=_hydrate_notes(arguments.get("ids") or [], clean_scopes, tenant))]
        elif name == "lore_graph":
            params = urllib.parse.urlencode({"tenant": tenant, "scopes": ",".join(clean_scopes)})
            data, err = _safe_get(f"/graph?{params}")
            if err:
                return [_types.TextContent(type="text", text=f"Error: {err}")]
            nodes = len(data.get("nodes", []))
            edges = len(data.get("edges", []))
            return [_types.TextContent(type="text", text=f"Graph: {nodes} nodes, {edges} edges.")]
        elif name == "lore_state":
            params = urllib.parse.urlencode({
                "tenant": tenant, "scopes": ",".join(clean_scopes),
                "budget": arguments.get("budget", 800),
            })
            data, err = _safe_get(f"/state?{params}")
            if err:
                return [_types.TextContent(type="text", text=f"Error: {err}")]
            block = data.get("block") or "No current state available."
            text = f"{block}\n\n_({data.get('count', 0)} facts, ~{data.get('tokens_est', 0)} tokens)_"
            return [_types.TextContent(type="text", text=text)]
        elif name == "lore_profile":
            owner = (arguments.get("owner") or os.environ.get("LORE_OWNER") or "").strip()
            if not owner:
                return [_types.TextContent(type="text", text="Error: owner is required (or set LORE_OWNER).")]
            params = urllib.parse.urlencode({
                "tenant": tenant, "owner": owner, "scopes": ",".join(clean_scopes),
            })
            data, err = _safe_get(f"/learn/memory?{params}")
            if err:
                return [_types.TextContent(type="text", text=f"Error: {err}")]
            docs = data.get("documents") or []
            text = "\n\n".join(
                f"## {d.get('kind', 'memory')}\n{d.get('text', '')}" for d in docs
            ) or "Lore has no explicit personal context yet."
            return [_types.TextContent(type="text", text=text)]
        elif name == "lore_recall_sessions":
            mode = arguments.get("mode", "browse")
            data, err = _safe_post("/sessions/recall", {
                "mode": mode, "query": arguments.get("query"),
                "note_id": arguments.get("note_id"),
                "offset": arguments.get("offset", 0), "limit": arguments.get("limit", 20),
                "scopes": clean_scopes, "tenant": tenant,
            })
            if err:
                return [_types.TextContent(type="text", text=f"Error: {err}")]
            if mode == "scroll":
                text = data.get("text") or "No session text found."
            else:
                rows = data.get("sessions") or []
                text = "\n".join(
                    f"{i + 1}. [{r.get('title') or r.get('note_id')}] (note_id: {r.get('note_id')})"
                    for i, r in enumerate(rows)
                ) or "No matching sessions found."
            return [_types.TextContent(type="text", text=text)]
        else:
            return [_types.TextContent(type="text", text=f"Unknown tool: {name}")]

    def main() -> None:
        async def _run() -> None:
            async with _stdio_server() as (r, w):
                await _server.run(r, w, _server.create_initialization_options())
        asyncio.run(_run())


if __name__ == "__main__":
    main()
