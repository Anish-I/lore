"""LoreClient — the supported, dependency-free HTTP SDK for the Lore engine.

This is the "one Python script that calls Lore" done right: a thin, typed-ish
client over the frozen `/api/v1` contract. A product UI (e.g. a town-clerk
dashboard) talks to Lore ONLY through this — it never imports engine internals,
never touches SQLite/Qdrant/embeddings.

    from lore.client import LoreClient
    lore = LoreClient("http://127.0.0.1:8099", tenant="local", scopes=["engineering"])
    lore.check_compatible()                 # refuse to run against a bad api_version
    print(lore.ask("what did we decide about the split?")["answer"])

Runs one persistent engine process per machine; many UIs share it. Uses only the
stdlib (urllib) so it can be vendored into any lightweight app with zero deps.
Scope/tenant/token default from the LORE_SCOPES / LORE_TENANT / LORE_LOCAL_TOKEN
env vars, matching the MCP server's identity resolution.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request

from .version import API_VERSION, API_PREFIX


class LoreError(RuntimeError):
    """Any failure talking to the engine (transport or HTTP error)."""


class LoreUnavailableError(LoreError):
    """The engine could not be reached at all (not running / wrong URL)."""


class LoreVersionError(LoreError):
    """The engine's api_version is not what this SDK was built against."""


class LoreClient:
    def __init__(self, base_url: str = "http://127.0.0.1:8099", *, token=None,
                 tenant=None, scopes=None, profile=None, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.api_url = self.base_url + API_PREFIX
        self.token = token or os.environ.get("LORE_LOCAL_TOKEN") or None
        self.tenant = tenant or os.environ.get("LORE_TENANT", "local")
        env_scopes = [s for s in os.environ.get("LORE_SCOPES", "").split(",") if s]
        self.scopes = list(scopes) if scopes is not None else env_scopes
        # Named retrieval profile (see POST /profiles) applied to every recall
        # call. None => the engine decides (API-key binding, else its default),
        # so an app that ships no profile behaves exactly as before.
        self.profile = profile or os.environ.get("LORE_PROFILE") or None
        self.timeout = timeout

    # ---- transport -------------------------------------------------------
    def _request(self, method: str, path: str, *, body=None, params=None):
        url = self.api_url + path
        if params:
            clean = {k: v for k, v in params.items() if v is not None}
            if clean:
                url += "?" + urllib.parse.urlencode(clean, doseq=True)
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if self.token:
            req.add_header("X-Lore-Token", self.token)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode()[:500]
            except Exception:
                pass
            raise LoreError(f"HTTP {e.code} {e.reason} for {method} {path}: {detail}")
        except urllib.error.URLError as e:
            raise LoreUnavailableError(f"cannot reach Lore at {url}: {e.reason}")

    def _scopes(self, override):
        return list(override) if override is not None else self.scopes

    def _with_profile(self, body: dict, override) -> dict:
        """Stamp the profile onto a request body — omitted entirely when unset,
        so the engine's own resolution (key binding, then default) still runs."""
        name = override or self.profile
        if name:
            body["profile"] = name
        return body

    # ---- handshake / compatibility --------------------------------------
    def health(self) -> dict:
        return self._request("GET", "/health")

    def check_compatible(self, expected: str = API_VERSION) -> dict:
        """Fetch the handshake and raise if the engine's api_version differs.
        Call this once at startup before trusting the service."""
        h = self.health()
        got = h.get("api_version")
        if got != expected:
            raise LoreVersionError(
                f"engine api_version={got!r}, this SDK expects {expected!r}")
        return h

    def providers(self) -> dict:
        """{'codex': bool, 'claude': bool, 'byok': bool} — which answer/enrich
        providers are usable right now."""
        return self.health().get("providers", {})

    # ---- retrieval / QA --------------------------------------------------
    def ask(self, question: str, *, scopes=None, tenant=None, provider=None,
            model=None, history=None, context=None, profile=None) -> dict:
        body = self._with_profile(
            {"question": question, "principal_scopes": self._scopes(scopes),
             "tenant_id": tenant or self.tenant}, profile)
        if provider:
            body["provider"] = provider
        if model:
            body["model"] = model
        if history is not None:
            body["history"] = history
        if context is not None:
            body["context"] = context
        return self._request("POST", "/ask", body=body)

    def search(self, query: str, *, k: int = 10, scopes=None, tenant=None,
               profile=None) -> dict:
        return self._request("POST", "/search", body=self._with_profile({
            "query": query, "k": k, "scopes": self._scopes(scopes),
            "tenant_id": tenant or self.tenant}, profile))

    def context_pack(self, task: str, *, budget: int = 4000, max_per_note: int = 2,
                     scopes=None, tenant=None, profile=None) -> dict:
        return self._request("POST", "/context-pack", body=self._with_profile({
            "task": task, "budget": budget, "max_per_note": max_per_note,
            "scopes": self._scopes(scopes), "tenant_id": tenant or self.tenant},
            profile))

    def state(self, *, budget: int = 800, scopes=None, tenant=None) -> dict:
        sc = self._scopes(scopes)
        return self._request("GET", "/state", params={
            "tenant": tenant or self.tenant, "budget": budget,
            "scopes": ",".join(sc) if sc else None})

    def graph(self, *, scopes=None, tenant=None) -> dict:
        sc = self._scopes(scopes)
        return self._request("GET", "/graph", params={
            "tenant": tenant or self.tenant,
            "scopes": ",".join(sc) if sc else None})

    def note(self, note_id: str, *, tenant=None, scopes=None) -> dict:
        sc = self._scopes(scopes)
        return self._request("GET", f"/notes/{urllib.parse.quote(note_id)}", params={
            "tenant": tenant or self.tenant,
            "scopes": ",".join(sc) if sc else None})

    # ---- writes ----------------------------------------------------------
    def ingest(self, *, source_id: str, title: str, text: str, scope: str,
               owner: str, tenant=None, source_type=None) -> dict:
        body = {"source_id": source_id, "title": title, "text": text,
                "scope": scope, "owner": owner, "tenant": tenant or self.tenant}
        if source_type:
            body["source_type"] = source_type
        return self._request("POST", "/ingest", body=body)

    def feedback(self, *, note_id: str, vote: int, tenant=None, query_hash=None) -> dict:
        body = {"note_id": note_id, "vote": vote, "tenant": tenant or self.tenant}
        if query_hash:
            body["query_hash"] = query_hash
        return self._request("POST", "/feedback", body=body)
