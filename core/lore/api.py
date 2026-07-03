import datetime, hashlib, os
from typing import Optional
from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from . import db, qdrant_store
from .config import settings
from .sqlutil import in_clause
from .embed import FakeEmbedder, VoyageEmbedder, LocalEmbedder, LocalSparseEmbedder
from .rerank import FakeReranker, VoyageReranker, LocalReranker
from .index import index_note, index_document, backfill_created_at
from .recall import retrieve, retrieve_traced
from .redact import redact
from . import llm
from . import auth, mailer, tenancy

app = FastAPI(title="Lore Core")

# --- Local API token -------------------------------------------------------
# The backend binds 127.0.0.1, so remote machines can't reach it — but ANY
# local process could read/write the whole knowledge base. When the desktop app
# sets LORE_LOCAL_TOKEN, every request must carry `Authorization: Bearer <token>`
# (or `X-Lore-Token: <token>`). Unset → no enforcement (raw-backend / CI use).
# /presets is always exempt so the app's health probe works before it has the
# token wired, and so is the docs/openapi surface.
_LOCAL_TOKEN = os.environ.get("LORE_LOCAL_TOKEN") or None
_TOKEN_EXEMPT = {"/presets", "/docs", "/openapi.json", "/redoc"}


@app.middleware("http")
async def _local_token_guard(request, call_next):
    if _LOCAL_TOKEN and request.url.path not in _TOKEN_EXEMPT:
        from starlette.responses import JSONResponse
        supplied = request.headers.get("x-lore-token")
        if not supplied:
            hdr = request.headers.get("authorization") or ""
            if hdr.lower().startswith("bearer "):
                supplied = hdr[7:].strip()
        # In server mode the Google-JWT auth on individual endpoints governs
        # access; the local token is a desktop-only lock, so only enforce it
        # when not in server mode.
        if not _server_mode() and supplied != _LOCAL_TOKEN:
            return JSONResponse(
                {"detail": "Local API token required. Re-install Lore hooks from Settings if this is unexpected."},
                status_code=401,
            )
    return await call_next(request)


_conn = db.connect(); db.bootstrap_schema(_conn)
tenancy.bootstrap_tenancy(_conn)  # users/orgs/teams/memberships for multi-tenant auth

# Model selection: Voyage if an API key is set, else REAL local models (fastembed),
# and only Fake if explicitly forced (VAULT_FAKE=1) for fast unit tests.
_FAKE = os.environ.get("VAULT_FAKE") == "1"

def get_embedder():
    if _FAKE:
        return FakeEmbedder()
    return VoyageEmbedder(settings.voyage_api_key) if settings.voyage_api_key else LocalEmbedder()

def get_reranker():
    if _FAKE:
        return FakeReranker()
    return VoyageReranker(settings.voyage_api_key) if settings.voyage_api_key else LocalReranker()

def get_sparse_embedder():
    return None if _FAKE else LocalSparseEmbedder()

EMPTY_PROFILE = {"tenant": None, "company": None, "personas": [], "examples": []}

# Named workspace profiles. A profile is activated only when VAULT_PROFILE names it
# explicitly; an unset/unknown VAULT_PROFILE resolves to EMPTY_PROFILE (default-free UX).
PROFILES = {
    # Solo personal workspace: one identity over your own knowledge graph.
    # Scopes cover every ACL the solo notes use (private/research/team) plus enterprise.
    "solo": {"tenant": "solo", "company": "My Lore", "personas": [
        {"label": "You", "scopes": ["private", "research", "team", "enterprise"]}],
        "examples": ["what was I working on with the Kalshi bot?", "summarize the Wingman architecture",
                     "what decisions did I make about the agent hub?", "find my notes on the accident case"]},
    "acme": {"tenant": "acme", "company": "Acme (demo)", "personas": [
        {"label": "Alice", "scopes": ["alice-private", "eng-team", "acme-corp"]},
        {"label": "Bob", "scopes": ["bob-private", "eng-team", "acme-corp"]},
        {"label": "New hire", "scopes": ["eng-team", "acme-corp"]},
        {"label": "Admin (all)", "scopes": ["alice-private", "bob-private", "eng-team", "acme-corp"]}],
        "examples": ["what do we know about Project Phoenix?", "why is the Acme renewal at risk?",
                     "root cause of incident PROJ-1037", "how do we handle database connection limits?"]},
}

def active_profile():
    name = os.environ.get("VAULT_PROFILE")
    return PROFILES.get(name, EMPTY_PROFILE) if name else EMPTY_PROFILE


# --- Google OAuth (desktop loopback) + Lore session JWT --------------------

class GoogleLoginReq(BaseModel):
    id_token: str


@app.post("/auth/google")
def auth_google(req: GoogleLoginReq):
    """Exchange a Google ID token (from the desktop loopback flow) for a Lore session JWT.

    Body: {id_token}. Returns {token, user_id, email, scopes}. 401 on bad identity.
    The Google ID token is cryptographically verified (signature + audience); scopes
    come from membership, never from the client.
    """
    try:
        return auth.login_with_google(_conn, req.id_token)
    except auth.AuthError as e:
        raise HTTPException(status_code=401, detail=str(e))


def require_user(authorization: Optional[str] = Header(default=None)) -> str:
    """FastAPI dependency for protected endpoints: validate the `Authorization: Bearer
    <lore-jwt>` header and return the authenticated user_id. 401 if missing/invalid.
    Authorization (which scopes the user may read) is re-derived from membership by the
    endpoint via tenancy.authorize_scopes — never trusted from the token."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization.split(None, 1)[1].strip()
    try:
        claims = auth.verify_session_jwt(token)
    except auth.AuthError as e:
        raise HTTPException(status_code=401, detail=str(e))
    return claims["sub"]


# --- Server-mode data-plane authorization gate -----------------------------
# The whole data plane historically trusts client-supplied `tenant_id` + `scopes`
# (fine for the single-user, 127.0.0.1-bound desktop app). For a shared/hosted
# deployment that is a cross-tenant read/write hole. LORE_SERVER_MODE=1 turns on
# server-side enforcement WITHOUT changing local/solo behavior (default OFF =
# passthrough), so existing single-user installs are untouched.
#
# The ACL that actually gates recall is the Qdrant `scope_ids` filter, so the
# enforcement is: restrict the caller's effective scopes to (authorized team
# scopes ∩ requested) + the caller's OWN private scope. A user can therefore
# never read another user's private scope or a team they don't belong to, even
# within a shared tenant namespace.

def _server_mode() -> bool:
    return os.environ.get("LORE_SERVER_MODE") == "1"


def private_scope_id(user_id: str) -> str:
    """Canonical per-user private scope id used for hosted (server-mode) data.
    Private notes are tagged `private:{user_id}`; only that user may read them."""
    return f"private:{user_id}"


def _as_scope_list(scopes) -> list[str]:
    if scopes is None:
        return []
    if isinstance(scopes, str):
        return [s.strip() for s in scopes.split(",") if s.strip()]
    return [s for s in scopes if s and s.strip()]


def _authorize_read(authorization, requested_scopes, tenant):
    """Server-mode read ACL. Returns (user_id|None, effective_scopes, tenant).
    Local mode: passthrough (trusts the request) — solo/desktop unchanged."""
    if not _server_mode():
        return None, requested_scopes, tenant
    user_id = require_user(authorization)               # 401 without a valid token
    requested = _as_scope_list(requested_scopes)
    allowed = set(tenancy.authorize_scopes(_conn, user_id, requested or None))
    priv = private_scope_id(user_id)
    if not requested or priv in requested:              # own private is always grantable
        allowed.add(priv)
    allowed = sorted(allowed)
    if not allowed:
        raise HTTPException(status_code=403, detail="no authorized scopes for this request")
    if not tenant:
        raise HTTPException(status_code=422, detail="tenant is required")
    return user_id, allowed, tenant


def _authorize_write(authorization, scope, owner, tenant):
    """Server-mode write ACL. Returns (owner, scope, tenant). The write scope must be
    the caller's own private scope or an authorized team scope; owner is forced to the
    caller. Local mode: passthrough."""
    if not _server_mode():
        return owner, scope, tenant
    user_id = require_user(authorization)
    allowed = set(tenancy.authorize_scopes(_conn, user_id, [scope] if scope else None))
    allowed.add(private_scope_id(user_id))
    if scope not in allowed:
        raise HTTPException(status_code=403, detail="scope not authorized for this user")
    if not tenant:
        raise HTTPException(status_code=422, detail="tenant is required")
    return user_id, scope, tenant


def _require_user_in_server_mode(authorization) -> Optional[str]:
    """For maintenance/destructive endpoints: require a valid token in server mode,
    no-op locally. Returns the user_id (or None in local mode)."""
    if not _server_mode():
        return None
    return require_user(authorization)


@app.get("/auth/me")
def auth_me(user_id: str = Depends(require_user)):
    """Return the authenticated user's id + their authorized team scopes (from membership)."""
    return {"user_id": user_id, "scopes": tenancy.authorized_team_scope_ids(_conn, user_id)}


# --- Teams + email invites (share a base with another user) -----------------

class TeamCreateReq(BaseModel):
    name: str

class InviteReq(BaseModel):
    email: str


def _user_email(user_id: str) -> str:
    """Verified login email for an authenticated user (from the users table,
    written by Google login — never from a client-supplied field)."""
    row = _conn.execute("select email from users where id=%s", (user_id,)).fetchone()
    return (row[0] or "") if row else ""


@app.post("/teams")
def teams_create(req: TeamCreateReq, user_id: str = Depends(require_user)):
    """Create a team ("base") owned by the caller. Returns {team_id, scope, name}."""
    try:
        return tenancy.create_team(_conn, req.name, user_id)
    except tenancy.InviteError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/teams/{team_id}/invites")
def teams_invite(team_id: str, req: InviteReq, user_id: str = Depends(require_user)):
    """Invite an email address to the team. Caller must be an active member.
    Sends the invite email when SMTP is configured; the response's `delivered` +
    `delivery_reason` say honestly whether it went out (invite exists either way)."""
    try:
        invite = tenancy.invite_to_team(_conn, team_id, req.email, user_id)
    except tenancy.InviteError as e:
        raise HTTPException(status_code=403, detail=str(e))
    team_row = _conn.execute("select name from teams where id=%s", (team_id,)).fetchone()
    inviter_row = _conn.execute("select name, email from users where id=%s", (user_id,)).fetchone()
    delivery = mailer.send_invite_email(
        invite["email"],
        (team_row[0] if team_row else team_id),
        (inviter_row[0] or inviter_row[1] if inviter_row else user_id),
        invite["invite_id"],
    )
    return {**invite, "delivered": delivery["delivered"], "delivery_reason": delivery["reason"]}


@app.get("/invites")
def invites_list(user_id: str = Depends(require_user)):
    """Pending invites addressed to the caller's verified login email."""
    return {"invites": tenancy.pending_invites_for(_conn, _user_email(user_id))}


@app.post("/invites/{invite_id}/accept")
def invites_accept(invite_id: str, user_id: str = Depends(require_user)):
    """Accept an invite. The caller's verified email must match the invited address.
    Grants active membership; the new scope shows up in /auth/me immediately."""
    try:
        return tenancy.accept_invite(_conn, invite_id, user_id, _user_email(user_id))
    except tenancy.InviteError as e:
        raise HTTPException(status_code=403, detail=str(e))

class ReindexReq(BaseModel):
    path: str
    owner_id: str
    scope_id: str
    tenant_id: str
class AskReq(BaseModel):
    question: str
    principal_scopes: list[str]
    tenant_id: str
    model: Optional[str] = None

class IngestReq(BaseModel):
    source_id: str
    title: str
    text: str
    scope: str
    owner: str
    tenant: str
    source_type: Optional[str] = None
    content_hash: Optional[str] = None

def _allowed_vault_roots() -> list[str]:
    """Real-path'd list of directories /reindex may read from. Empty => unconfigured.

    Read from the environment at call time (VAULT_ROOTS, then VAULT_ROOT) so a value
    injected by the desktop spawn — or a test — is honored without a frozen snapshot."""
    raw = os.environ.get("VAULT_ROOTS") or os.environ.get("VAULT_ROOT") or settings.vault_roots
    if not raw:
        return []
    return [os.path.realpath(p) for p in raw.split(os.pathsep) if p.strip()]


def _guard_reindex_path(path: str) -> None:
    """Reject a /reindex path that escapes every configured vault root.

    Closes the unauthenticated-arbitrary-file-read hole: without this, any local
    client could POST an absolute path (e.g. secrets/.env, ~/.ssh/id_rsa) and read
    it back via /search or /notes. When no roots are configured (legacy/dev), the
    guard is a no-op — set VAULT_ROOTS to activate containment.
    """
    roots = _allowed_vault_roots()
    if not roots:
        return
    target = os.path.realpath(path)
    for root in roots:
        if target == root or target.startswith(root + os.sep):
            return
    raise HTTPException(status_code=400, detail="path escapes the allowed vault root(s)")


@app.post("/reindex")
def reindex(req: ReindexReq, embedder=Depends(get_embedder), sparse=Depends(get_sparse_embedder),
            authorization: Optional[str] = Header(default=None)):
    owner_id, scope_id, tenant_id = _authorize_write(
        authorization, req.scope_id, req.owner_id, req.tenant_id)
    req.owner_id, req.scope_id, req.tenant_id = owner_id, scope_id, tenant_id
    _guard_reindex_path(req.path)
    # Tombstone guard: a path upkeep folded into a topic (and deleted) must not
    # be re-indexed by reconcile/scrape sweeps — that recreates the churn loop.
    # A file EDITED after folding is live again: drop the tombstone and index it.
    row = _conn.execute(
        "select folded_at from folded_paths where tenant_id=%s and path=%s",
        (req.tenant_id, req.path)).fetchone()
    if row and row[0]:
        try:
            mtime = os.path.getmtime(req.path)
        except OSError:
            mtime = None
        folded_ts = row[0].timestamp() if hasattr(row[0], "timestamp") else None
        if mtime is not None and folded_ts is not None and mtime > folded_ts:
            _conn.execute("delete from folded_paths where tenant_id=%s and path=%s",
                          (req.tenant_id, req.path))
        else:
            return {"indexed_chunks": 0, "skipped": "folded"}
    n = index_note(req.path, embedder, _conn, req.owner_id, req.scope_id, req.tenant_id,
                   sparse_embedder=sparse)
    return {"indexed_chunks": n}

@app.post("/ingest")
def ingest(req: IngestReq, authorization: Optional[str] = Header(default=None)):
    """Index pre-normalized text from an external source.

    IMPORTANT: always uses the local embedder regardless of VOYAGE_API_KEY.
    Caller-supplied text may contain sensitive data; sending it to an external
    embedding API (Voyage) would be a data-leak path.  LocalEmbedder runs fully
    on-device.  In VAULT_FAKE=1 test mode FakeEmbedder is used instead.
    """
    owner, scope, tenant = _authorize_write(authorization, req.scope, req.owner, req.tenant)
    if _FAKE:
        embedder = FakeEmbedder()
        sparse = None
    else:
        embedder = LocalEmbedder()       # never VoyageEmbedder here
        sparse = LocalSparseEmbedder()

    n = index_document(
        source_id=req.source_id, title=req.title, text=req.text,
        scope_id=scope, owner_id=owner, tenant_id=tenant,
        embedder=embedder, conn=_conn, sparse_embedder=sparse,
        source_type=req.source_type, content_hash=req.content_hash,
    )
    return {"ok": True, "note_id": req.source_id, "chunks": n}

@app.post("/ask")
def ask(req: AskReq, embedder=Depends(get_embedder), reranker=Depends(get_reranker),
        sparse=Depends(get_sparse_embedder),
        authorization: Optional[str] = Header(default=None)):
    _uid, scopes, tenant = _authorize_read(authorization, req.principal_scopes, req.tenant_id)
    hits = retrieve(req.question, embedder, reranker, scopes, tenant,
                    sparse_embedder=sparse)
    chunks = [{"title": h.heading_path, "text": h.text} for h in hits]
    text, engine = llm.answer(req.question, chunks, model=req.model)
    return {"answer": text, "engine": engine,
            "scopes_used": list(scopes),
            "citations": [{"note_id": h.note_id, "heading_path": h.heading_path, "why": h.why} for h in hits]}

@app.post("/trace")
def trace(req: AskReq, embedder=Depends(get_embedder), reranker=Depends(get_reranker),
          sparse=Depends(get_sparse_embedder),
          authorization: Optional[str] = Header(default=None)):
    """Full pipeline trace for the visualizer: per-lane candidates, fusion, rerank, answer."""
    _uid, scopes, tenant = _authorize_read(authorization, req.principal_scopes, req.tenant_id)
    if sparse is None:
        return {"error": "trace requires real models (unset VAULT_FAKE)"}
    _, tr = retrieve_traced(req.question, embedder, reranker, sparse,
                            scopes, tenant)
    chunks = [{"title": f["title"], "text": f["text"]} for f in tr["final"]]
    text, engine = llm.answer(req.question, chunks, model=req.model)
    tr["answer"] = text
    tr["engine"] = engine
    tr["scopes_asked"] = scopes
    return tr

@app.get("/presets")
def presets():
    return active_profile()

@app.get("/graph")
def graph(tenant: Optional[str] = None, scopes: Optional[str] = None,
          authorization: Optional[str] = Header(default=None)):
    """Return the knowledge graph for a tenant filtered by ACL scope.

    Query params:
        tenant: tenant_id to query. No tenant is assumed when omitted.
        scopes: comma-separated list of scope_ids the viewer can see
                (no scopes are assumed when omitted).

    Response:
        {
          "nodes": [{"id", "label", "scope", "owner", "links", "updated", "created"}, ...],
          "edges": [[src_id, dst_id, kind], ...]
        }

    `created` is the note's real creation date (frontmatter created:/date: → file
    mtime → first-seen; see index.derive_created_at) — never overwritten by re-index.
    `updated` is index time (bumped on every re-ingest). May be null for notes indexed
    before the created_at column existed and not yet backfilled (see /backfill/created).

    ACL guarantees (enforced server-side, not post-filtered):
        - A node appears only if its scope_id is in the caller's allowed set.
        - An edge appears only if BOTH endpoints are in the returned node set.
        - Node `links` counts degree AFTER scope filtering.
        - Node list is capped at 1500 (most-connected first); edges follow.
    """
    # Server-mode: authenticate + restrict scopes to the caller's own; the returned
    # `scopes` replaces whatever was requested. Local mode: passthrough.
    if _server_mode():
        _uid, srv_scopes, tenant = _authorize_read(authorization, scopes, tenant)
        scopes = ",".join(srv_scopes)
    profile = active_profile()
    active_tenant = tenant or profile.get("tenant")
    if not active_tenant:
        return {"nodes": [], "edges": []}

    if scopes:
        allowed = [s.strip() for s in scopes.split(",") if s.strip()]
    else:
        allowed = list({s for p in profile.get("personas", []) for s in p.get("scopes", [])})
    if not allowed:
        return {"nodes": [], "edges": []}

    # Fetch all nodes visible to the caller (ACL: scope_id must be in allowed set).
    # This is the server-side filter — no post-filtering is performed after this point.
    frag, sparams = in_clause("scope_id", allowed)
    rows = _conn.execute(
        f"""select id, title, scope_id, owner_id, updated_at, source_path, importance, created_at
           from notes
           where tenant_id=%s and {frag}""",
        [active_tenant, *sparams],
    ).fetchall()

    node_ids = {r[0] for r in rows}

    # Fetch all edges for this tenant (cheap — edges table is small relative to notes).
    # We then filter to only edges where both endpoints are in the visible node set.
    edge_rows = _conn.execute(
        "select src_note_id, dst_note_id, kind, weight from edges where tenant_id=%s",
        (active_tenant,),
    ).fetchall()

    # ACL edge filter: both endpoints must be visible.
    filtered_edges = [
        (src, dst, kind, weight) for src, dst, kind, weight in edge_rows
        if src in node_ids and dst in node_ids
    ]

    # Compute per-node degree in the filtered graph (used for cap ordering and UI).
    degree = {nid: 0 for nid in node_ids}
    for src, dst, _, _w in filtered_edges:
        degree[src] = degree.get(src, 0) + 1
        degree[dst] = degree.get(dst, 0) + 1

    # Cap at 1500 nodes (most-connected first); re-filter edges after cap.
    MAX_NODES = 1500
    if len(node_ids) > MAX_NODES:
        top_ids = set(sorted(node_ids, key=lambda nid: degree.get(nid, 0), reverse=True)[:MAX_NODES])
        filtered_edges = [(src, dst, kind, w) for src, dst, kind, w in filtered_edges
                         if src in top_ids and dst in top_ids]
        # Recompute degree after cap so `links` field is accurate.
        degree = {nid: 0 for nid in top_ids}
        for src, dst, _, _w in filtered_edges:
            degree[src] = degree.get(src, 0) + 1
            degree[dst] = degree.get(dst, 0) + 1
    else:
        top_ids = node_ids

    row_by_id = {r[0]: r for r in rows}
    nodes = []
    for nid in top_ids:
        nid_, title, scope_id, owner_id, updated_at, source_path, importance, created_at = row_by_id[nid]
        nodes.append({
            "id": nid_,
            "label": title or nid_,
            "scope": scope_id,
            "owner": owner_id,
            "path": source_path,
            "links": degree.get(nid_, 0),
            "updated": updated_at.isoformat() if updated_at else None,
            # The note's real creation date (frontmatter/mtime/first-seen — see index.py
            # derive_created_at); None for notes indexed before this column existed and
            # not yet backfilled. graph.jsx's date-scrubber falls back to `updated` then.
            "created": created_at.isoformat() if created_at else None,
            "importance": importance or 0,
        })

    return {
        "nodes": nodes,
        "edges": [[src, dst, kind, round(weight or 0, 2)] for src, dst, kind, weight in filtered_edges],
    }

@app.get("/stats")
def stats(tenant: Optional[str] = None):
    """Cheap per-tenant counts used by the desktop app's boot-time disk<->index
    reconcile (M1 Task R): compares this against an on-disk note count to detect a
    stale index (e.g. after a store swap) and trigger a background re-scrape.

    Query params:
        tenant: tenant_id to count. Returns all-zero counts when omitted — mirrors
                /graph's "no tenant assumed" behavior; never leaks cross-tenant counts.

    Response: {"notes": n, "chunks": c, "edges": e} — counts only, no content, no scopes.
    """
    if not tenant:
        return {"notes": 0, "chunks": 0, "edges": 0, "foldedPaths": 0}
    notes = _conn.execute(
        "select count(*) from notes where tenant_id=%s", (tenant,)
    ).fetchone()[0]
    chunks = _conn.execute(
        "select count(*) from chunks c join notes n on c.note_id = n.id where n.tenant_id=%s",
        (tenant,),
    ).fetchone()[0]
    edges = _conn.execute(
        "select count(*) from edges where tenant_id=%s", (tenant,)
    ).fetchone()[0]
    # Paths upkeep folded+deleted (tombstoned): still on disk but deliberately
    # not indexed — the desktop reconcile subtracts these from its disk count
    # so it stops seeing folded notes as a gap to re-index (churn loop).
    folded = _conn.execute(
        "select count(*) from folded_paths where tenant_id=%s", (tenant,)
    ).fetchone()[0]
    return {"notes": notes, "chunks": chunks, "edges": edges, "foldedPaths": folded}

@app.get("/config/retrieval")
def config_retrieval(tenant: Optional[str] = None):
    """Truthful snapshot of the retrieval stack for the desktop Settings UI.

    Reports what get_embedder()/get_reranker() would actually resolve to right now
    (Voyage when VOYAGE_API_KEY is set, else local fastembed models, or fake under
    VAULT_FAKE=1) — never a hardcoded "not configured".

    Query params:
        tenant: accepted for parity with the other desktop-facing endpoints; the
                retrieval stack is process-wide today, so it does not vary the result.

    Response:
        {
          "embeddingModel":      {"provider", "model"},
          "reranker":            {"provider", "model"},
          "contextualRetrieval": {"enabled", "mode"},   # always-on metadata contextualizer
          "localFallback":       {"available", "active"}
        }
    """
    import importlib.util
    voyage = bool(settings.voyage_api_key)
    local_available = importlib.util.find_spec("fastembed") is not None
    if _FAKE:
        embedding = {"provider": "fake", "model": "fake-embedder (VAULT_FAKE=1)"}
        rerank_m = {"provider": "fake", "model": "fake-reranker (VAULT_FAKE=1)"}
    elif voyage:
        embedding = {"provider": "voyage", "model": VoyageEmbedder.DEFAULT_MODEL}
        rerank_m = {"provider": "voyage", "model": VoyageReranker.DEFAULT_MODEL}
    else:
        embedding = {"provider": "local", "model": LocalEmbedder.DEFAULT_MODEL}
        rerank_m = {"provider": "local", "model": LocalReranker.DEFAULT_MODEL}
    return {
        "embeddingModel": embedding,
        "reranker": rerank_m,
        # apply_context() runs on every indexed chunk (see index.py); the blurb is the
        # deterministic metadata sentence — enabled by design, not user-toggleable.
        "contextualRetrieval": {"enabled": True, "mode": "metadata"},
        # Local fastembed models: the primary path when no Voyage key is set, and ALWAYS
        # used for /ingest + /capture (data-leak guard) even when Voyage is configured.
        "localFallback": {"available": local_available,
                          "active": (not _FAKE) and (not voyage) and local_available},
    }


class CaptureReq(BaseModel):
    session_id: str
    title: str
    text: str
    scope: str
    owner: str
    tenant: str
    mode: Optional[str] = None  # reserved for future routing; unused in M1

def _session_note_id(session_id: str) -> str:
    """Stable note_id derived from session_id (SHA-1, first 16 hex chars)."""
    return hashlib.sha1(session_id.encode()).hexdigest()[:16]

def _local_embedder():
    """Always returns a local (on-device) embedder — never Voyage.
    Used by /capture and /ingest to prevent external API data-leak."""
    return FakeEmbedder() if _FAKE else LocalEmbedder()

def _local_sparse():
    return None if _FAKE else LocalSparseEmbedder()

@app.post("/capture")
def capture(req: CaptureReq, authorization: Optional[str] = Header(default=None)):
    """Index a Claude session transcript after server-side secret redaction.

    Text is redacted before embedding or storage.  Re-POSTing the same
    session_id upserts the existing note (one note per session).

    Body: {session_id, title, text, scope, owner, tenant, mode}
    Returns: {ok, note_id, chunks}
    """
    owner, scope, tenant = _authorize_write(authorization, req.scope, req.owner, req.tenant)
    safe_text = redact(req.text)
    note_id = _session_note_id(req.session_id)
    n = index_document(
        source_id=note_id, title=req.title, text=safe_text,
        scope_id=scope, owner_id=owner, tenant_id=tenant,
        embedder=_local_embedder(), conn=_conn, sparse_embedder=_local_sparse(),
        source_type="claude-session",
    )
    return {"ok": True, "note_id": note_id, "chunks": n}

@app.get("/capture/status")
def capture_status(session_id: str):
    """Check whether a session has been indexed.

    Returns: {exists, note_id, updated, chunks}
    """
    note_id = _session_note_id(session_id)
    row = _conn.execute(
        "select updated_at from notes where id=%s", (note_id,)
    ).fetchone()
    if not row:
        return {"exists": False, "note_id": note_id, "updated": None, "chunks": 0}
    chunk_count = _conn.execute(
        "select count(*) from chunks where note_id=%s", (note_id,)
    ).fetchone()[0]
    return {
        "exists": True,
        "note_id": note_id,
        "updated": row[0].isoformat() if row[0] else None,
        "chunks": chunk_count,
    }

class ForgetReq(BaseModel):
    tenant: str
    path_prefix: str

@app.post("/forget")
def forget(req: ForgetReq, authorization: Optional[str] = Header(default=None)):
    """Delete all notes whose source_path starts with path_prefix for the given tenant.
    Normalizes backslashes to forward slashes before comparison.
    Removes from Qdrant, cleans edges (both directions), deletes notes (chunks cascade).
    Body: {tenant, path_prefix}. Returns {forgotten: n}"""
    _require_user_in_server_mode(authorization)  # no anonymous destruction when hosted
    if not req.tenant:
        raise HTTPException(status_code=422, detail="tenant is required")
    if not req.path_prefix:
        raise HTTPException(status_code=422, detail="path_prefix is required")
    prefix = req.path_prefix.replace('\\', '/').rstrip('/')
    # Escape LIKE metacharacters (\, %, _) so a path like 'Wizards/UI_Kit' can't act as a
    # wildcard and match unrelated folders.
    esc = prefix.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    rows = _conn.execute(
        "select id from notes where tenant_id=%s and source_path is not null and ("
        "  replace(source_path, '\\', '/') like %s escape '\\'"
        "  or replace(source_path, '\\', '/') = %s"
        ")",
        (req.tenant, esc + '/%', prefix),
    ).fetchall()
    forgotten = 0
    for (note_id,) in rows:
        qdrant_store.delete_note(note_id)
        _conn.execute(
            "delete from edges where tenant_id=%s and (src_note_id=%s or dst_note_id=%s)",
            (req.tenant, note_id, note_id),
        )
        _conn.execute("delete from notes where id=%s", (note_id,))  # chunks cascade
        forgotten += 1
    return {"forgotten": forgotten}

@app.delete("/capture")
def capture_delete(source_type: Optional[str] = None, tenant: Optional[str] = None,
                   authorization: Optional[str] = Header(default=None)):
    """Privacy purge: delete all notes of the given source_type within a tenant.

    Removes matching notes from Postgres (chunks cascade), their outgoing/incoming
    edges, and their Qdrant vector points.

    Query params: source_type (required), tenant (required)
    Returns: {deleted: n}
    """
    _require_user_in_server_mode(authorization)  # no anonymous destruction when hosted
    active_tenant = tenant or active_profile().get("tenant")
    if not active_tenant:
        raise HTTPException(status_code=422, detail="tenant is required")
    if not source_type:
        raise HTTPException(status_code=422, detail="source_type is required")
    rows = _conn.execute(
        "select id from notes where source_type=%s and tenant_id=%s",
        (source_type, active_tenant),
    ).fetchall()
    deleted = 0
    for (note_id,) in rows:
        qdrant_store.delete_note(note_id)
        _conn.execute(
            "delete from edges where tenant_id=%s and (src_note_id=%s or dst_note_id=%s)",
            (active_tenant, note_id, note_id),
        )
        _conn.execute("delete from notes where id=%s", (note_id,))  # chunks cascade
        deleted += 1
    return {"deleted": deleted}

@app.get("/notes/{note_id}")
def get_note(note_id: str, tenant: Optional[str] = None, scopes: Optional[str] = None,
             authorization: Optional[str] = Header(default=None)):
    """Retrieve a note's metadata and original body by ID.

    Query params:
        tenant: tenant_id to read from. No tenant is assumed when omitted.
        scopes: comma-separated ACL scopes; when supplied the note must be in one of
                them or a 404 is returned.  In server mode scope filtering is MANDATORY
                and derived from the authenticated user (client scopes cannot widen it).

    Returns {id, title, scope, body, updated}.  body is the original markdown
    as stored at index time (lossless; chunk text is NOT a full reconstruction).
    404 if the note does not exist or is not visible to the caller.
    """
    # Server-mode: authenticate and force the scope filter to the caller's own scopes
    # (never optional). Local mode: preserve the existing optional-filter behavior.
    if _server_mode():
        _uid, srv_scopes, tenant = _authorize_read(authorization, scopes, tenant)
        scopes = ",".join(srv_scopes)
    active_tenant = tenant or active_profile().get("tenant")
    if not active_tenant:
        raise HTTPException(status_code=422, detail="tenant is required")

    q = ("select id, title, scope_id, body, updated_at "
         "from notes where id=%s and tenant_id=%s")
    params: list = [note_id, active_tenant]

    if scopes:
        allowed = [s.strip() for s in scopes.split(",") if s.strip()]
        if allowed:
            frag, sparams = in_clause("scope_id", allowed)
            q += f" and {frag}"
            params.extend(sparams)

    row = _conn.execute(q, params).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Note not found")
    id_, title, scope, body, updated = row
    return {
        "id": id_,
        "title": title,
        "scope": scope,
        "body": body,
        "updated": updated.isoformat() if updated else None,
    }


class SearchReq(BaseModel):
    query: str
    scopes: list[str]
    k: int = 10
    tenant_id: str

@app.post("/search")
def search(req: SearchReq, embedder=Depends(get_embedder), reranker=Depends(get_reranker),
           sparse=Depends(get_sparse_embedder),
           authorization: Optional[str] = Header(default=None)):
    """Hybrid-retrieve ranked chunks filtered by the given scopes.

    Body: {query, scopes:[...], tenant_id, k?:int=10}
    Returns: {results:[{note_id, title, scope, heading_path, text, score}]}

    scopes is REQUIRED and must not be empty (never defaults to all). In server mode
    the effective scopes are derived from the authenticated user, not the request.
    """
    if not req.query or not req.query.strip():
        raise HTTPException(status_code=422, detail="query must not be blank")
    if not req.scopes or not any(s.strip() for s in req.scopes):
        raise HTTPException(status_code=422, detail="scopes is required and must not be empty")
    _uid, scopes, tenant = _authorize_read(authorization, req.scopes, req.tenant_id)
    k = max(1, min(req.k, 50))
    hits = retrieve(req.query, embedder, reranker, scopes, tenant,
                    limit=k, sparse_embedder=sparse)
    # Fetch note metadata (title, scope) for the returned hits in one query.
    note_ids = list(dict.fromkeys(h.note_id for h in hits))
    note_meta = {}
    if note_ids:
        frag, sparams = in_clause("id", note_ids)
        rows = _conn.execute(
            f"select id, title, scope_id from notes where {frag}",
            sparams,
        ).fetchall()
        note_meta = {r[0]: (r[1], r[2]) for r in rows}
    results = []
    for h in hits:
        meta = note_meta.get(h.note_id, (None, None))
        results.append({
            "note_id": h.note_id,
            "title": meta[0],
            "scope": meta[1],
            "heading_path": h.heading_path,
            "text": h.text,
            "score": round(h.score, 4),
        })
    return {"results": results, "scopes_used": list(scopes)}


# --- Upkeep state (in-process; reset on restart) ---
_upkeep_last_run: Optional[str] = None
_upkeep_last_stats: dict = {}

class UpkeepRunReq(BaseModel):
    tenant: str
    scope: Optional[str] = None
    use_llm: bool = False   # when True: Ollama-assisted topic extraction (slower, capped at 25 notes)
    auto_classify: bool = False      # opt-in (cfg.autoClassify): tag notes + propose Sections
    section_threshold: int = 5       # notes on one topic before a Section is proposed
    auto_file: bool = False          # opt-in (cfg.autoFileObvious): record unambiguous notes
                                     # into existing applied sections (state only; desktop moves)

@app.post("/upkeep/run")
def upkeep_run(req: UpkeepRunReq, embedder=Depends(get_embedder)):
    """Fold ephemeral date/session notes into durable topic nodes.

    With auto_classify=true also tags untagged notes and upserts Section PROPOSALS —
    state only; no files are ever moved by upkeep (apply is an explicit user action).
    With auto_file=true (opt-in setting, default OFF) unambiguous notes are recorded
    into existing applied sections and the move plan returned in stats.autoFile —
    still state only; the DESKTOP executes those moves under its path-guard.

    Body: {tenant, scope?, use_llm?:bool=False, auto_classify?:bool=False,
           section_threshold?:int=5, auto_file?:bool=False}
    Returns: {dateNotes, topics, folded, ...}
    """
    from .upkeep import run_upkeep
    global _upkeep_last_run, _upkeep_last_stats
    stats = run_upkeep(_conn, embedder, req.tenant, scope=req.scope, use_llm=req.use_llm,
                       auto_classify=req.auto_classify,
                       section_threshold=req.section_threshold,
                       auto_file=req.auto_file)
    # Opportunistic backfill: any note still missing created_at (e.g. indexed before
    # the column existed) gets it derived now from its source file, so the graph
    # date-scrubber keeps improving as upkeep runs without a separate user action.
    stats["createdBackfilled"] = backfill_created_at(_conn, req.tenant)
    # Opportunistic relation enrichment: typed edges (depends_on/supersedes/…)
    # for notes whose body changed, small batch per pass so upkeep stays cheap.
    # Degrades cleanly when no LLM provider is configured (status in stats).
    try:
        from .llm_relations import enrich_relations
        stats["enrich"] = enrich_relations(_conn, req.tenant, limit=25)
    except Exception as e:
        stats["enrich"] = {"status": "error", "detail": str(e)[:200]}
    _upkeep_last_run = datetime.datetime.utcnow().isoformat()
    _upkeep_last_stats = stats
    return stats


class BackfillCreatedReq(BaseModel):
    tenant: str


@app.post("/backfill/created")
def backfill_created(req: BackfillCreatedReq):
    """Backfill created_at for existing notes from their source file's frontmatter/
    mtime (falls back to the row's updated_at when the source is unreadable).
    Never overwrites a note that already has created_at. Idempotent.

    Body: {tenant}. Returns: {updated}.
    """
    n = backfill_created_at(_conn, req.tenant)
    return {"updated": n}


# --- Sections (auto-proposed note folders) ---------------------------------
# SAFEGUARD: these endpoints track state and return move PLANS only. The
# backend never moves files — the desktop main process executes plans under
# its path-guard, and only when the user explicitly applies/undoes a section.

class SectionApplyReq(BaseModel):
    tenant: str
    dest_dir: Optional[str] = None   # desktop-supplied destination folder for the plan

class SectionReq(BaseModel):
    tenant: str

class SectionCreateReq(BaseModel):
    tenant: str
    name: str
    note_ids: list[str]

class SectionPromoteReq(BaseModel):
    tenant: str
    share_scope: str = 'private'   # 'private' | 'team' | 'public' (team/public: forward-looking)


@app.get("/sections")
def sections_list(tenant: Optional[str] = None):
    """All section proposals (proposed + applied + dismissed) for a tenant.
    Returns {sections:[{id, name, topic, status, notes:[{id,title,path}], ...}]}"""
    from . import sections
    if not tenant:
        raise HTTPException(status_code=422, detail="tenant is required")
    return {"sections": sections.list_sections(_conn, tenant)}


@app.post("/sections/{section_id}/apply")
def sections_apply(section_id: str, req: SectionApplyReq):
    """Mark a proposed section applied; record original paths; return the move plan.
    Body: {tenant, dest_dir?}. The DESKTOP performs the actual file moves."""
    from . import sections
    try:
        return sections.apply_section(_conn, req.tenant, section_id, dest_dir=req.dest_dir)
    except sections.SectionError as e:
        raise HTTPException(status_code=409, detail=str(e))


@app.post("/sections/create")
def sections_create(req: SectionCreateReq):
    """Create an APPLIED section from an explicit note set (chat-driven wizard
    creation). No proposal step, NO file moves — membership is the recorded
    note_ids; the notes stay where they are. Body: {tenant, name, note_ids}."""
    from . import sections
    try:
        return sections.create_section_from_notes(_conn, req.tenant, req.name, req.note_ids)
    except sections.SectionError as e:
        raise HTTPException(status_code=409, detail=str(e))


@app.post("/sections/{section_id}/dismiss")
def sections_dismiss(section_id: str, req: SectionReq):
    """Dismiss a proposed section (sticky — the topic is never re-proposed)."""
    from . import sections
    try:
        return sections.dismiss_section(_conn, req.tenant, section_id)
    except sections.SectionError as e:
        raise HTTPException(status_code=409, detail=str(e))


@app.post("/sections/{section_id}/undo")
def sections_undo(section_id: str, req: SectionReq):
    """Revert an applied section to proposed; return the recorded original paths
    so the DESKTOP can move the files back."""
    from . import sections
    try:
        return sections.undo_section(_conn, req.tenant, section_id)
    except sections.SectionError as e:
        raise HTTPException(status_code=409, detail=str(e))


# --- Personal Wizards (an APPLIED Section promoted to a scoped RAG assistant) ---
# Promoting moves nothing — the section is already a real folder. A wizard is a
# retrieval VIEW over that folder's notes plus a persisted per-wizard chat.

class WizardAskReq(BaseModel):
    question: str
    tenant: str
    model: Optional[str] = None


@app.post("/sections/{section_id}/promote")
def sections_promote(section_id: str, req: SectionPromoteReq):
    """Promote an APPLIED section to a Personal Wizard (idempotent).
    Body: {tenant, share_scope?='private'}. 409 unless the section's status is
    'applied' — the note set must be settled before a wizard can scope to it.
    share_scope 'team'/'public' are stored-only flags until sync/publish land."""
    from . import sections
    try:
        return sections.promote_section(_conn, req.tenant, section_id,
                                        share_scope=req.share_scope)
    except sections.SectionError as e:
        raise HTTPException(status_code=409, detail=str(e))


@app.get("/wizards/personal")
def wizards_personal_list(tenant: Optional[str] = None):
    """Personal wizards for a tenant.
    Returns {wizards:[{id, section_id, name, topic, note_count, folder, created_at}]}"""
    from . import sections
    if not tenant:
        raise HTTPException(status_code=422, detail="tenant is required")
    return {"wizards": sections.list_personal_wizards(_conn, tenant)}


@app.post("/wizards/personal/{wizard_id}/ask")
def wizards_personal_ask(wizard_id: str, req: WizardAskReq, embedder=Depends(get_embedder),
                         reranker=Depends(get_reranker), sparse=Depends(get_sparse_embedder)):
    """Wizard-scoped RAG ask: same pipeline + response shape as /ask, but retrieval
    is filtered to the wizard's own notes (its section's folder / recorded note set).
    Both the question and the answer are appended to the wizard's persisted chat.

    Body: {question, tenant, model?}. Returns {answer, engine, citations}."""
    from . import sections
    try:
        member_ids, scopes = sections.wizard_members(_conn, req.tenant, wizard_id)
    except sections.SectionError as e:
        raise HTTPException(status_code=404, detail=str(e))
    hits = []
    if member_ids and scopes:
        # Over-fetch across the member notes' scopes, then keep only the wizard's chunks.
        hits = [h for h in retrieve(req.question, embedder, reranker, scopes, req.tenant,
                                    limit=32, sparse_embedder=sparse)
                if h.note_id in member_ids][:8]
    chunks = [{"title": h.heading_path, "text": h.text} for h in hits]
    text, engine = llm.answer(req.question, chunks, model=req.model)
    citations = [{"note_id": h.note_id, "heading_path": h.heading_path, "why": h.why} for h in hits]
    sections.append_wizard_chat(_conn, req.tenant, wizard_id, "user", req.question)
    sections.append_wizard_chat(_conn, req.tenant, wizard_id, "assistant", text, sources=citations)
    return {"answer": text, "engine": engine, "citations": citations}


@app.get("/wizards/personal/{wizard_id}/notes")
def wizards_personal_notes(wizard_id: str, tenant: Optional[str] = None):
    """The wizard's member notes (detail-view "what's inside").
    Returns {notes:[{id, title, path}]} sorted by title; 404 on unknown wizard."""
    from . import sections
    if not tenant:
        raise HTTPException(status_code=422, detail="tenant is required")
    try:
        return {"notes": sections.wizard_notes(_conn, tenant, wizard_id)}
    except sections.SectionError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/wizards/personal/{wizard_id}/chat")
def wizards_personal_chat(wizard_id: str, tenant: Optional[str] = None):
    """Persisted per-wizard chat history, oldest first.
    Returns {messages:[{id, role, text, sources, created_at}]}"""
    from . import sections
    if not tenant:
        raise HTTPException(status_code=422, detail="tenant is required")
    try:
        return {"messages": sections.wizard_chat(_conn, tenant, wizard_id)}
    except sections.SectionError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/tags")
def tags_list(tenant: Optional[str] = None):
    """Distinct tags + topics for a tenant (feeds the desktop's .lore manifest).
    Returns {tags:[...], topics:[...]}"""
    if not tenant:
        raise HTTPException(status_code=422, detail="tenant is required")
    tags = [r[0] for r in _conn.execute(
        "select distinct tag from note_tags where tenant_id=%s and kind='tag' order by tag",
        (tenant,)).fetchall()]
    topics = [r[0] for r in _conn.execute(
        "select distinct tag from note_tags where tenant_id=%s and kind='topic' order by tag",
        (tenant,)).fetchall()]
    return {"tags": tags, "topics": topics}


class EnrichReq(BaseModel):
    tenant: str = "solo"
    limit: int = 40
    force: bool = False
    provider: Optional[str] = None   # 'codex' | 'claude' | 'byok'; else env LORE_LLM_PROVIDER


@app.post("/enrich")
def enrich(req: EnrichReq):
    """Optional LLM relation enrichment: infer typed relations from descriptive prose,
    constrained to existing note titles, origin='llm', never overwriting stronger heuristic edges.
    Uses the configured LLM provider — Codex subscription, Claude subscription, or BYOK.
    Body: {tenant, limit?, force?, provider?}. Returns {notesProcessed, edges, skipped, provider}."""
    from .llm_relations import enrich_relations
    from .llm_providers import provider_available, ProviderError
    prov = (req.provider or os.environ.get("LORE_LLM_PROVIDER") or "byok").lower()
    if not provider_available(prov):
        raise HTTPException(status_code=400,
            detail=f"LLM provider '{prov}' unavailable (codex/claude CLI not found, or no BYOK key set)")
    try:
        stats = enrich_relations(_conn, req.tenant, limit=max(1, min(req.limit, 200)),
                                 force=req.force, provider=prov)
    except ProviderError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {**stats, "provider": prov}

@app.get("/enrich/providers")
def enrich_providers():
    """Which LLM providers are usable right now (for the Settings picker)."""
    from .llm_providers import provider_available
    return {p: provider_available(p) for p in ("codex", "claude", "byok")}

@app.get("/upkeep/status")
def upkeep_status():
    """Return last upkeep run timestamp and stats.

    Returns: {lastRun, dateNotes, topics, folded}
    """
    return {"lastRun": _upkeep_last_run, **_upkeep_last_stats}


@app.get("/", response_class=HTMLResponse)
def home():
    path = os.path.join(os.path.dirname(__file__), "static", "app.html")
    with open(path, encoding="utf-8") as f:
        return f.read()
