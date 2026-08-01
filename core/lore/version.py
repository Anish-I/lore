"""Single source of truth for the engine + API contract versions.

Three things version independently (both external reviewers, 2026-07-23):
  * ENGINE_VERSION — the Lore engine build (mirrors pyproject).
  * API_VERSION    — the frozen HTTP contract UIs pin against ("/api/v1").
  * the client SDK — versioned with the package; see client.LoreClient.

Additive changes stay within v1; removals/semantic breaks move to v2.
The handshake (GET /api/v1/health) exposes these so a UI can check
compatibility before it trusts the service.
"""

ENGINE_VERSION = "0.1.0"
API_VERSION = "v1"
API_PREFIX = "/api/v1"
