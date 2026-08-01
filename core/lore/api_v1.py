"""Additive `/api/v1` surface — the frozen, versioned contract for UIs/SDKs.

Design (decided 2026-07-23, Codex + Sol review):
  * The engine already had the right seam (HTTP/MCP/CLI). This does NOT rebuild
    it — it hardens the HTTP contract so product UIs can depend on a stable
    surface without importing engine internals.
  * NON-BREAKING: the existing root routes (`/ask`, `/search`, …) stay exactly
    as they are — the desktop app and the Codex/Claude capture hooks call them.
    v1 is MIRRORED on top of a curated allowlist, so both paths hit the SAME
    handler functions (dependencies/auth live in each function signature and are
    preserved through the mirror). Root routes are now DEPRECATED ALIASES.
  * Curated, not blanket: only the consumer-facing product surface is promoted
    into v1. Admin/teams/upkeep/sections internals stay root-only until they
    earn a place in the contract.

Mount via `mount_v1(app)` AFTER every root route is declared.
"""
from fastapi.routing import APIRoute

from .version import ENGINE_VERSION, API_VERSION, API_PREFIX

# The stable product surface a UI/SDK may pin. Paths are matched against the
# already-declared root routes; anything not here is intentionally NOT part of
# the v1 contract yet.
V1_ALLOWLIST = frozenset({
    "/ask",
    "/search",
    "/context-pack",
    "/emails/draft",
    "/state",
    "/graph",
    "/notes/{note_id}",
    "/ingest",
    "/capture",
    "/feedback",
    "/feedback/event",
    "/digest",
    "/recent-prompts",
    "/config/retrieval",
    "/profiles",
    "/profiles/{name}",
    "/doctor",
    "/stats",
})


def _providers_status():
    """Live availability of each answer/enrichment provider, for the handshake.
    Imported lazily so a provider-probe import error can never break mounting."""
    out = {}
    try:
        from . import llm_providers
    except Exception:
        return {"codex": False, "claude": False, "byok": False}
    for p in ("codex", "claude", "byok"):
        try:
            out[p] = bool(llm_providers.provider_available(p))
        except Exception:
            out[p] = False
    return out


def _index_identity():
    """Which embedding model the vectors were built with, for the handshake.

    Part of compatibility, not trivia: an app that ingests through this engine is
    writing into that model's vector space. `model_id` None means nothing has been
    indexed yet. Lazy import + broad catch so a store hiccup can never break the
    handshake — health must answer even when the data plane is unhappy.
    """
    try:
        from . import api, embed_identity
        ident = embed_identity.recorded(api._conn)
    except Exception:
        return {"model_id": None, "dim": None}
    return {"model_id": ident.model_id if ident else None,
            "dim": ident.dim if ident else None}


def _capabilities(app):
    """The v1 paths actually mounted on this app (source of truth = the router,
    not the allowlist, so the handshake never over-promises)."""
    caps = set()
    for r in app.router.routes:
        if isinstance(r, APIRoute) and r.path.startswith(API_PREFIX + "/") \
                and r.path != API_PREFIX + "/health":
            caps.add(r.path[len(API_PREFIX):])
    return sorted(caps)


def mount_v1(app):
    """Idempotently mirror the allowlisted root routes under /api/v1 and add the
    version handshake. Returns the app for chaining."""
    # Guard against double-mount (module re-import / test re-entry).
    if any(isinstance(r, APIRoute) and r.path == API_PREFIX + "/health"
           for r in app.router.routes):
        return app

    seen = set()
    for route in list(app.router.routes):  # copy: we append while iterating
        if not isinstance(route, APIRoute) or route.path not in V1_ALLOWLIST:
            continue
        for method in sorted((route.methods or set()) - {"HEAD", "OPTIONS"}):
            key = (method, route.path)
            if key in seen:
                continue
            seen.add(key)
            app.add_api_route(
                API_PREFIX + route.path,
                route.endpoint,
                methods=[method],
                name=f"v1_{route.name}",
                response_model=route.response_model,
                status_code=route.status_code,
                tags=["v1"],
            )

    @app.get(API_PREFIX + "/health", tags=["v1"])
    def v1_health():
        """Version + capability handshake. A UI/SDK calls this first and refuses
        to run against an incompatible api_version."""
        return {
            "engine": "lore",
            "engine_version": ENGINE_VERSION,
            "api_version": API_VERSION,
            "capabilities": _capabilities(app),
            "providers": _providers_status(),
            "index": _index_identity(),
        }

    return app
