import datetime, hashlib, http.client, json, os, re, time, uuid
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
from . import auth, mailer, tenancy, okta
from . import supersede
from . import todos as todos_mod
from . import connectors

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


def _audit(endpoint: str, tenant, principal, scopes, query: str, hits: int) -> None:
    """Record a retrieval for the compliance audit log. Stores a SHA-256 of the
    query, never the raw text — enough to correlate/count without keeping the
    question itself. Best-effort: a logging failure never breaks the request."""
    try:
        qh = hashlib.sha256((query or "").encode()).hexdigest()[:16]
        _conn.execute(
            "insert into query_log(tenant_id, endpoint, principal, scopes, query_hash, hits) "
            "values(%s,%s,%s,%s,%s,%s)",
            (tenant, endpoint, principal or "local", ",".join(scopes or []), qh, int(hits)),
        )
    except Exception:
        pass

# Temporal-meta questions ("summarize my recent notes", "what's new this week")
# can't be answered by semantic retrieval — nothing in the store *says* "recent".
# Detect them and answer from the newest notes in-scope instead.
_TEMPORAL_RE = __import__("re").compile(
    r"\b(recent|latest|newest|today|yesterday|this week|last week|past (few )?(days?|weeks?)|"
    r"what'?s new|catch me up|worked on|what (did|have) i (been )?(do|did|done|work)\w*)\b",
    __import__("re").I)


# Words that carry no SUBJECT in a temporal question — what's left after
# removing them is what the user is actually asking about ("get latest changes
# of lore" → "lore"). Deliberately generous: a lost subject degrades to the
# old all-notes digest, a false subject returns nothing and falls back anyway.
_TEMPORAL_STOPWORDS = frozenset((
    "get", "show", "give", "tell", "catch", "me", "up", "my", "the", "a", "an",
    "of", "on", "in", "for", "about", "with", "to", "and", "or", "any",
    "what", "whats", "what's", "did", "have", "has", "been", "i", "we", "is", "are",
    "new", "news", "recent", "recently", "latest", "newest", "last", "past",
    "today", "yesterday", "week", "weeks", "day", "days", "changes", "changed",
    "updates", "updated", "update", "happening", "happened", "going", "worked",
    "work", "working", "done", "do", "notes", "note", "pages", "page", "stuff",
    "summary", "summarize", "digest", "this", "that", "these", "those", "few",
))


def _temporal_subject(question: str) -> str:
    """The non-temporal remainder of a recency question, or '' when the
    question is purely temporal ('what did I do this week?')."""
    words = re.findall(r"[a-z0-9][a-z0-9'_-]*", (question or "").lower())
    return " ".join(w for w in words if w not in _TEMPORAL_STOPWORDS).strip()


def _recent_note_rows(tenant: str, scopes: list, limit: int = 8, subject: str = None):
    """Newest in-scope notes with their leading chunk text (skips captured session
    bodies' noise by preferring title+first chunk). When the question names a
    SUBJECT ('latest changes of lore'), restrict to notes whose title or path
    mentions it — the all-notes list only serves purely temporal questions."""
    frag, sparams = in_clause("n.scope_id", list(scopes))
    base = f"""select n.id, n.title, n.scope_id, n.updated_at, c.text
            from notes n
            left join chunks c on c.note_id = n.id and c.chunk_index = 0
            where n.tenant_id=%s and {frag}"""
    if subject:
        like = f"%{subject.lower()}%"
        rows = _conn.execute(
            base + " and (lower(n.title) like %s or lower(coalesce(n.source_path,'')) like %s)"
                 + " order by n.updated_at desc limit %s",
            (tenant, *sparams, like, like, limit)).fetchall()
        if rows:
            return rows
    return _conn.execute(
        base + " order by n.updated_at desc limit %s",
        (tenant, *sparams, limit)).fetchall()


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


class OktaLoginReq(BaseModel):
    id_token: str


@app.post("/auth/okta")
def auth_okta(req: OktaLoginReq):
    """Exchange an Okta ID token (from the desktop OIDC loopback flow) for a Lore
    session JWT, reconciling team membership from the token's `groups` claim.

    Body: {id_token}. Returns {token, user_id, email, scopes, groups}. 401 on bad
    identity. The Okta ID token is cryptographically verified (RS256 signature +
    issuer + audience); scopes are derived from SSO-group membership, never from
    the client. See `lore.okta` for the group→scope mapping (OKTA_* env config).
    """
    try:
        return okta.login_with_okta(_conn, req.id_token)
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


def _resolve_read_scopes(authorization, scopes, tenant):
    """Shared read-ACL scope resolution for scope-filtered read endpoints
    (/digest, /todos, ...). Server mode: the allowed set is derived from the
    caller's membership and the `scopes` param cannot widen it. Local mode: the
    `scopes` param, else the active profile's personas. Returns
    (tenant, allowed_scopes_list); an EMPTY list means 'deny — show nothing'.
    Raises 422 when tenant is missing."""
    if _server_mode():
        _uid, srv_scopes, tenant = _authorize_read(authorization, scopes, tenant)
        scopes = ",".join(srv_scopes)
    if not tenant:
        raise HTTPException(status_code=422, detail="tenant is required")
    if scopes:
        allowed = [s.strip() for s in scopes.split(",") if s.strip()]
    else:
        profile = active_profile()
        allowed = list({s for p in profile.get("personas", []) for s in p.get("scopes", [])})
    return tenant, allowed


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
    # Optional prior turns [{role:'user'|'assistant', text}, ...] so follow-up
    # questions ("what about the second one?") resolve against the running chat.
    # Only the last 6 turns are used (see llm._history_block).
    history: Optional[list] = None
    # 'codex' | 'claude' | 'byok' — answer through the user's subscription/key
    # (see llm_providers). None → local Ollama / extractive fallback.
    provider: Optional[str] = None

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
    _maybe_propose_supersessions(tenant, req.source_id)
    _maybe_extract_people(tenant, req.source_id)
    return {"ok": True, "note_id": req.source_id, "chunks": n}


def _maybe_propose_supersessions(tenant: str, note_id: str) -> None:
    """Auto-supersession detection on freshly ingested/captured notes (never on
    bulk file reindex — that path is volume-sensitive). Proposals only; nothing
    ranks until accepted (see _note_signals_provider's origin filter).
    Non-fatal by design. Gate: LORE_AUTO_SUPERSEDE=0."""
    if os.environ.get("LORE_AUTO_SUPERSEDE", "1") == "0":
        return
    try:
        supersede.propose_supersessions(_conn, tenant, note_id)
    except Exception:
        pass  # detection must never fail an ingest

def _note_meta(note_ids):
    """{note_id: {title, scope}} for a set of note ids — the per-citation source
    labels ("PairStrategy · Private") need the NOTE's title + scope, which chunk
    payloads don't reliably carry."""
    ids = [n for n in dict.fromkeys(note_ids) if n]
    if not ids:
        return {}
    frag, sparams = in_clause("id", ids)
    rows = _conn.execute(f"select id, title, scope_id from notes where {frag}", sparams).fetchall()
    return {r[0]: {"title": r[1], "scope": r[2]} for r in rows}


def _citations_for(hits_or_rows):
    """Build citation dicts ({note_id, title, heading_path, scope, why}) from either
    RetrievedChunk objects or trace `final` row dicts, enriching each with the
    note's title + scope so every citation says where it came from."""
    def field(h, name):
        return h.get(name) if isinstance(h, dict) else getattr(h, name, None)
    metas = _note_meta([field(h, "note_id") for h in hits_or_rows])
    out = []
    for h in hits_or_rows:
        nid = field(h, "note_id")
        heading = field(h, "heading_path") or field(h, "title") or ""
        m = metas.get(nid) or {}
        out.append({
            "note_id": nid,
            "title": m.get("title") or str(heading).split(" > ")[0],
            "heading_path": heading,
            "scope": m.get("scope") or field(h, "scope"),
            "why": field(h, "why"),
        })
    return out


# Title-index cache: build_title_index compiles one regex per note title over
# ALL titles in the tenant — too expensive to rebuild on every /search. Cache
# per tenant with a short TTL + note-count signature so new notes still land in
# the entity lane within the TTL (or immediately when the count changes).
_TITLE_INDEX_CACHE: dict = {}
_TITLE_INDEX_TTL = 60.0  # seconds


def _title_index_cached(tenant: str):
    from . import relations as _relations
    now = time.time()
    try:
        count = _conn.execute(
            "select count(*) from notes where tenant_id=%s", (tenant,)).fetchone()[0]
    except Exception:
        count = -1
    hit = _TITLE_INDEX_CACHE.get(tenant)
    if hit and hit["count"] == count and (now - hit["t"]) < _TITLE_INDEX_TTL:
        return hit["index"]
    index = _relations.build_title_index(_conn, tenant)
    _TITLE_INDEX_CACHE[tenant] = {"index": index, "count": count, "t": now}
    return index


def _note_signals_provider(tenant: str, query: str):
    """Callable handed to recall.retrieve — resolves note-level ranking signals
    (importance, age, memory type, superseded, entity match) for the candidate
    set in two cheap queries. The entity lane matches DISTINCTIVE note titles
    named in the query (cached title index) and boosts their chunks."""
    # Query-side entity detection happens once per request, not per candidate.
    entity_ids: set = set()
    try:
        for _title, nid, pat in _title_index_cached(tenant):
            if pat.search(query or ""):
                entity_ids.add(nid)
    except Exception:
        entity_ids = set()

    now = datetime.datetime.now(datetime.timezone.utc)

    def provider(note_ids):
        ids = [n for n in set(note_ids) if n]
        if not ids:
            return {}
        frag, params = in_clause("id", ids)
        rows = _conn.execute(
            f"""select id, importance, created_at, memory_type, source_type
                from notes where tenant_id=%s and {frag}""",
            (tenant, *params)).fetchall()
        frag2, params2 = in_clause("dst_note_id", ids)
        # Only ACCEPTED supersessions rank (cue-asserted or human-accepted).
        # Auto proposals awaiting review — and dismissed ones — must never
        # penalize a note's ranking (supersede.NON_RANKING_ORIGINS).
        frag2o, params2o = in_clause("origin", supersede.NON_RANKING_ORIGINS)
        superseded = {r[0] for r in _conn.execute(
            f"""select distinct dst_note_id from edges
                where tenant_id=%s and kind='supersedes' and {frag2}
                  and not ({frag2o})""",
            (tenant, *params2, *params2o)).fetchall()}
        frag3, params3 = in_clause("note_id", ids)
        fb = dict(_conn.execute(
            f"""select note_id, coalesce(sum(vote),0) from feedback
                where tenant_id=%s and {frag3} group by note_id""",
            (tenant, *params3)).fetchall())
        out = {}
        for nid, importance, created_at, memory_type, source_type in rows:
            age_days = None
            if created_at is not None:
                try:
                    dt = created_at
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=datetime.timezone.utc)
                    age_days = max(0.0, (now - dt).total_seconds() / 86400.0)
                except Exception:
                    age_days = None
            if not memory_type:
                # Stores indexed before the memory_type column: derive on the fly.
                from .index import memory_type_of
                memory_type = memory_type_of(source_type)
            out[nid] = {
                "importance": float(importance or 0.0),
                "age_days": age_days,
                "memory_type": memory_type,
                "superseded": nid in superseded,
                "entity_hit": nid in entity_ids,
                "feedback_net": int(fb.get(nid) or 0),
            }
        return out

    return provider


def _conflicts_for(tenant: str, note_ids: list) -> list:
    """`contradicts` edges touching any cited note — surfaced so an answer that
    leans on disputed sources SAYS so (ADD-only model: contradictions live in
    the store; retrieval-time is where they're surfaced, not merged away)."""
    ids = [n for n in {i for i in note_ids if i}]
    if not ids:
        return []
    frag_a, params_a = in_clause("src_note_id", ids)
    frag_b, params_b = in_clause("dst_note_id", ids)
    rows = _conn.execute(
        f"""select src_note_id, dst_note_id, evidence from edges
            where tenant_id=%s and kind='contradicts' and ({frag_a} or {frag_b})""",
        (tenant, *params_a, *params_b)).fetchall()
    if not rows:
        return []
    all_ids = {r[0] for r in rows} | {r[1] for r in rows}
    metas = _note_meta(list(all_ids))
    out, seen = [], set()
    for a, b, evidence in rows:
        if a == b:
            continue
        key = tuple(sorted((a, b)))
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "a_id": a, "a_title": (metas.get(a) or {}).get("title") or a,
            "b_id": b, "b_title": (metas.get(b) or {}).get("title") or b,
            "evidence": (evidence or "")[:200],
        })
    return out


@app.post("/ask")
def ask(req: AskReq, embedder=Depends(get_embedder), reranker=Depends(get_reranker),
        sparse=Depends(get_sparse_embedder),
        authorization: Optional[str] = Header(default=None)):
    _uid, scopes, tenant = _authorize_read(authorization, req.principal_scopes, req.tenant_id)
    hits = retrieve(req.question, embedder, reranker, scopes, tenant,
                    sparse_embedder=sparse,
                    note_signals=_note_signals_provider(tenant, req.question))
    chunks = [{"title": h.heading_path, "text": h.text} for h in hits]
    text, engine = llm.answer(req.question, chunks, model=req.model, history=req.history, provider=req.provider)
    _audit("ask", tenant, _uid, scopes, req.question, len(hits))
    citations = _citations_for(hits)
    return {"answer": text, "engine": engine,
            "scopes_used": list(scopes),
            "citations": citations,
            "conflicts": _conflicts_for(tenant, [c["note_id"] for c in citations])}

@app.post("/trace")
def trace(req: AskReq, embedder=Depends(get_embedder), reranker=Depends(get_reranker),
          sparse=Depends(get_sparse_embedder),
          authorization: Optional[str] = Header(default=None)):
    """Full pipeline trace for the visualizer: per-lane candidates, fusion, rerank, answer.

    Accepts optional `history` (prior chat turns) for follow-up questions, and returns
    `citations` where every entry carries the source note's title + scope — the chat's
    "PairStrategy · Private / roadmap · Team" per-citation labels.

    Without a sparse model (VAULT_FAKE=1 / models unavailable) the per-lane trace is
    skipped but the endpoint still answers via plain retrieve() — same response shape
    with a reduced trace ("fallback" flag), never a dead end for the desktop chat.
    """
    _uid, scopes, tenant = _authorize_read(authorization, req.principal_scopes, req.tenant_id)
    if _TEMPORAL_RE.search(req.question or ""):
        rows = _recent_note_rows(tenant, scopes, limit=8,
                                 subject=_temporal_subject(req.question) or None)
        tr = {
            "query": req.question,
            "classification": "recency",
            "final": [{"title": r[1] or r[0], "scope": r[2], "final": 1.0,
                       "text": (r[4] or "")[:400], "note_id": r[0],
                       "updated": str(r[3])} for r in rows],
        }
        tr["citations"] = [{"note_id": r[0], "heading_path": r[1] or r[0],
                            "title": r[1] or r[0], "scope": r[2], "why": "recent"}
                           for r in rows]
        chunks = [{"title": f"{f['title']} (updated {f['updated'][:10]})", "text": f["text"]}
                  for f in tr["final"]]
        text, engine = llm.answer(req.question, chunks, model=req.model, history=req.history,
                                  provider=req.provider, style="digest")
        tr["answer"] = text
        tr["engine"] = engine
        tr["scopes_asked"] = scopes
        _audit("trace", tenant, _uid, scopes, req.question, len(tr["final"]))
        return tr
    if sparse is None:
        hits = retrieve(req.question, embedder, reranker, scopes, tenant,
                        sparse_embedder=None)
        tr = {
            "query": req.question,
            "classification": "hybrid",
            "fallback": "no sparse model — per-lane trace skipped",
            "final": [{"title": h.heading_path, "scope": None,
                       "final": round(h.score, 3), "text": h.text[:240],
                       "note_id": h.note_id} for h in hits],
        }
    else:
        _, tr = retrieve_traced(req.question, embedder, reranker, sparse,
                                scopes, tenant,
                                note_signals=_note_signals_provider(tenant, req.question))
    tr["citations"] = _citations_for(tr["final"])
    tr["conflicts"] = _conflicts_for(tenant, [c["note_id"] for c in tr["citations"]])
    # Stamp the NOTE-level scope back onto the final rows so the evidence trail
    # shows the same source label as the citation chips.
    note_scope = {c["note_id"]: c["scope"] for c in tr["citations"]}
    for f in tr["final"]:
        if note_scope.get(f.get("note_id")):
            f["scope"] = note_scope[f["note_id"]]
    chunks = [{"title": f["title"], "text": f["text"]} for f in tr["final"]]
    text, engine = llm.answer(req.question, chunks, model=req.model, history=req.history, provider=req.provider)
    tr["answer"] = text
    tr["engine"] = engine
    tr["scopes_asked"] = scopes
    _audit("trace", tenant, _uid, scopes, req.question, len(tr["final"]))
    return tr

@app.get("/recent-prompts")
def recent_prompts(tenant: Optional[str] = None, limit: int = 200,
                   authorization: Optional[str] = Header(default=None)):
    """Raw texts of the user's recent AI-session prompts (for the Home suggestion
    chips). Mined from captured session notes' 'Prompt [...]' sections. Local data
    only; empty tenant returns nothing."""
    if not tenant:
        return {"prompts": []}
    n = max(1, min(int(limit), 500))
    rows = _conn.execute(
        """select c.text, n.updated_at from chunks c
           join notes n on n.id = c.note_id
           where n.tenant_id=%s and c.heading_path like '%%Prompt [%%'
           order by n.updated_at desc limit %s""",
        (tenant, n)).fetchall()
    out = []
    for text, _ts in rows:
        t = (text or "").strip()
        # strip the boilerplate lead-in the capture writes
        for marker in ("'. ", "]. "):
            i = t.find(marker)
            if 0 < i < 160:
                t = t[i + len(marker):]
                break
        if t:
            out.append(t[:280])
    return {"prompts": out}


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
        "select src_note_id, dst_note_id, kind, weight, origin from edges where tenant_id=%s",
        (active_tenant,),
    ).fetchall()

    # ACL edge filter: both endpoints must be visible.
    filtered_edges = [
        (src, dst, kind, weight, origin) for src, dst, kind, weight, origin in edge_rows
        if src in node_ids and dst in node_ids
    ]

    # Compute per-node degree in the filtered graph (used for cap ordering and UI).
    degree = {nid: 0 for nid in node_ids}
    for src, dst, *_rest in filtered_edges:
        degree[src] = degree.get(src, 0) + 1
        degree[dst] = degree.get(dst, 0) + 1

    # Cap at 1500 nodes (most-connected first); re-filter edges after cap.
    MAX_NODES = 1500
    if len(node_ids) > MAX_NODES:
        top_ids = set(sorted(node_ids, key=lambda nid: degree.get(nid, 0), reverse=True)[:MAX_NODES])
        filtered_edges = [e for e in filtered_edges if e[0] in top_ids and e[1] in top_ids]
        # Recompute degree after cap so `links` field is accurate.
        degree = {nid: 0 for nid in top_ids}
        for src, dst, *_rest in filtered_edges:
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
        # 5-tuple: origin ∈ index|capture|llm is the edge's provenance tag —
        # deterministic indexing vs session capture vs LLM enrichment.
        "edges": [[src, dst, kind, round(weight or 0, 2), origin or "index"]
                  for src, dst, kind, weight, origin in filtered_edges],
    }

@app.get("/query-log")
def query_log(tenant: Optional[str] = None, limit: int = 50):
    """The compliance audit trail: the most recent retrievals for a tenant.
    Query text is never stored — only a hash — so this shows *that* a search
    happened, its scopes, and how many hits, not the question itself."""
    if not tenant:
        return {"entries": []}
    n = max(1, min(limit, 500))
    rows = _conn.execute(
        "select ts, endpoint, principal, scopes, query_hash, hits from query_log "
        "where tenant_id=%s order by ts desc limit %s", (tenant, n)).fetchall()
    return {"entries": [
        {"ts": str(r[0]), "endpoint": r[1], "principal": r[2],
         "scopes": (r[3] or "").split(",") if r[3] else [], "query_hash": r[4], "hits": r[5]}
        for r in rows]}


class QueryLogPurgeReq(BaseModel):
    tenant: str


@app.post("/query-log/purge")
def query_log_purge(req: QueryLogPurgeReq):
    """Clear the audit trail for a tenant (user-initiated from Settings)."""
    _conn.execute("delete from query_log where tenant_id=%s", (req.tenant,))
    return {"ok": True}


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


@app.get("/doctor")
def doctor_endpoint(tenant: Optional[str] = None):
    """Local health diagnostics (`lore doctor` backend half): model cache,
    vector store, index counts, upkeep backlog, LLM availability, auth mode.

    Refused in server mode — this surface reveals deployment internals and is
    meant for the on-device install only.
    """
    if _server_mode():
        raise HTTPException(403, "doctor is a local-mode diagnostic surface")
    from . import doctor as _doctor
    return _doctor.run_checks(_conn, tenant or "local")

@app.get("/digest")
def digest(tenant: Optional[str] = None, days: int = 7,
           scopes: Optional[str] = None,
           authorization: Optional[str] = Header(default=None)):
    """The Home tab's this-week digest: notes grouped by day × section.

    Section = the note's parent folder name (from source_path); DB-only notes
    (captures, ingests) group under "Library". No LLM — the summary line is the
    top note titles, deterministic and cheap.

    Query params:
        tenant: required.
        days:   window size, default 7 (clamped 1..31).
        scopes: comma-separated scope_ids the viewer can see. Only notes in these
                scopes are counted/titled (no scopes visible -> empty digest).

    ACL: enforced the same way as /graph — a note contributes to the digest only
    if its scope_id is in the caller's allowed set. In server mode the allowed set
    is derived server-side from the caller's membership (the `scopes` param cannot
    widen it); in local mode it is the `scopes` param, else the active profile's
    personas. Previously /digest ran `select ... where tenant_id=%s` with no scope
    filter at all, so it returned every note title in the tenant regardless of
    scope — a cross-scope confidentiality leak.

    Response:
        {
          "days": n,
          "rows": [{"day": "YYYY-MM-DD", "section": str, "count": int,
                    "topTitles": [up to 3 titles, newest first]}, ...],
          "sinceYesterday": int,   # notes CREATED in the last 24h
          "total": int             # notes in the window
        }
    Rows are ordered newest day first, then by count descending.
    """
    # Authenticate + resolve the caller's authorized scope set (server mode derives
    # it from membership; local mode uses the scopes param / active profile). An
    # empty set denies — the same ACL as /graph.
    tenant, allowed = _resolve_read_scopes(authorization, scopes, tenant)
    days = max(1, min(days, 31))
    if not allowed:
        return {"days": days, "rows": [], "sinceYesterday": 0, "total": 0}

    now = datetime.datetime.now(datetime.timezone.utc)
    cutoff = now - datetime.timedelta(days=days)
    yesterday = now - datetime.timedelta(days=1)

    def _aware(ts):
        if ts is None:
            return None
        return ts.replace(tzinfo=datetime.timezone.utc) if ts.tzinfo is None else ts

    frag, sparams = in_clause("scope_id", allowed)
    rows = _conn.execute(
        f"select title, source_path, created_at, updated_at from notes "
        f"where tenant_id=%s and {frag}",
        [tenant, *sparams]).fetchall()

    groups = {}
    since_yesterday = 0
    total = 0
    for title, source_path, created_at, updated_at in rows:
        created = _aware(created_at)
        updated = _aware(updated_at)
        ts = created or updated
        if created and created >= yesterday:
            since_yesterday += 1
        if ts is None or ts < cutoff:
            continue
        total += 1
        if source_path:
            parts = [p for p in str(source_path).replace("\\", "/").split("/") if p]
            section = parts[-2] if len(parts) >= 2 else "Library"
        else:
            section = "Library"
        key = (ts.date().isoformat(), section)
        g = groups.setdefault(key, {"count": 0, "titles": []})
        g["count"] += 1
        g["titles"].append((ts, title or "Untitled"))

    out = []
    for (day, section), g in groups.items():
        top = [t for _ts, t in sorted(g["titles"], key=lambda x: x[0], reverse=True)[:3]]
        out.append({"day": day, "section": section, "count": g["count"], "topTitles": top})
    out.sort(key=lambda r: (r["day"], r["count"]), reverse=True)
    return {"days": days, "rows": out, "sinceYesterday": since_yesterday, "total": total}


# --- People-work wizard: thread -> action items (to-dos) ---------------------
# The first "wizard" in the enterprise sense: a work thread in, structured to-dos
# out, persisted with a pending -> confirmed/dismissed lifecycle (the Test-3
# confirm/dismiss UX). Extraction inherits the source note's scope; reads are
# scope-filtered with the same ACL as /digest and /graph.

class ExtractTodosReq(BaseModel):
    tenant_id: Optional[str] = None
    text: Optional[str] = None
    note_id: Optional[str] = None
    scope: Optional[str] = None
    owner: Optional[str] = None


class TodoStatusReq(BaseModel):
    tenant_id: Optional[str] = None
    scopes: Optional[str] = None


@app.post("/wizards/extract-todos")
def wizards_extract_todos(req: ExtractTodosReq,
                          authorization: Optional[str] = Header(default=None)):
    """Extract action items from a work thread and persist them as `pending` to-dos.

    Source is either raw `text` or an ingested thread `note_id` (its body + scope
    are used). Extraction uses the configured LLM when available, else a
    deterministic heuristic. Write-authorized: in server mode the scope must be one
    the caller may write and owner is forced to the caller. A to-do must live in a
    scope so it can be governed — provide `scope`, or a `note_id` whose scope is
    inherited. Returns {todos:[...], count}.
    """
    text = (req.text or "").strip()
    scope = req.scope
    source_note_id = None
    if req.note_id:
        row = _conn.execute(
            "select body, scope_id from notes where tenant_id=%s and id=%s",
            (req.tenant_id, req.note_id)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="note not found")
        body, note_scope = row
        text = (body or "").strip()
        source_note_id = req.note_id
        if not scope:
            scope = note_scope
    if not text:
        raise HTTPException(status_code=422, detail="provide text or a note_id with a body")
    if not scope:
        raise HTTPException(status_code=422,
                            detail="scope is required (pass scope, or a note_id whose scope is used)")
    owner, scope, tenant = _authorize_write(authorization, scope, req.owner, req.tenant_id)
    items = todos_mod.extract_todos(text, me=owner)
    created = todos_mod.create_todos(_conn, tenant, items, scope=scope,
                                     owner=owner, source_note_id=source_note_id)
    return {"todos": created, "count": len(created)}


@app.get("/todos")
def todos_list(tenant: Optional[str] = None, scopes: Optional[str] = None,
               status: Optional[str] = None,
               authorization: Optional[str] = Header(default=None)):
    """List to-dos visible to the caller, scope-filtered like /digest. Optional
    `status` filter (pending/confirmed/dismissed). Returns {todos:[...], count}."""
    tenant, allowed = _resolve_read_scopes(authorization, scopes, tenant)
    if status and status not in ("pending", "confirmed", "dismissed"):
        raise HTTPException(status_code=422, detail="invalid status")
    rows = todos_mod.list_todos(_conn, tenant, allowed, status=status)
    return {"todos": rows, "count": len(rows)}


def _todo_transition(todo_id, status, authorization, req):
    """Shared confirm/dismiss: resolve the caller's scopes, then move the todo only
    if it lives in a scope the caller can see. 404 (not 403) when it isn't, so the
    endpoint never reveals that a todo exists in a scope the caller can't read."""
    tenant, allowed = _resolve_read_scopes(authorization, req.scopes, req.tenant_id)
    todo = todos_mod.get_todo(_conn, tenant, todo_id)
    if not todo or todo["scope_id"] not in allowed:
        raise HTTPException(status_code=404, detail="todo not found")
    todos_mod.set_status(_conn, tenant, todo_id, status)
    return {"id": todo_id, "status": status}


@app.post("/todos/{todo_id}/confirm")
def todos_confirm(todo_id: str, req: TodoStatusReq,
                  authorization: Optional[str] = Header(default=None)):
    """Confirm a to-do (scope-checked). 404 if not visible to the caller."""
    return _todo_transition(todo_id, "confirmed", authorization, req)


@app.post("/todos/{todo_id}/dismiss")
def todos_dismiss(todo_id: str, req: TodoStatusReq,
                  authorization: Optional[str] = Header(default=None)):
    """Dismiss a to-do (scope-checked). 404 if not visible to the caller."""
    return _todo_transition(todo_id, "dismissed", authorization, req)


class MailboxSyncReq(BaseModel):
    tenant_id: Optional[str] = None
    folder: str
    scope: str
    owner: Optional[str] = None
    provider: Optional[str] = None
    limit: Optional[int] = None


@app.post("/connectors/mailbox/sync")
def connectors_mailbox_sync(req: MailboxSyncReq,
                            authorization: Optional[str] = Header(default=None)):
    """Pull every *new* `.eml` from a local mailbox folder → extract to-dos →
    persist them `pending`, idempotently (a re-sync skips already-seen messages).

    Write-authorized like the extract-todos wizard: the scope must be one the
    caller may write, and owner is forced to the caller in server mode. The folder
    is read on the server's own filesystem — same local-first model as `/reindex`
    (the desktop points it at a local Gmail/Outlook export or a Maildir); nothing
    leaves the box. A hosted, multi-tenant deployment would use a provider API
    connector instead of exposing filesystem paths. Returns the sync summary.
    """
    if not (req.folder or "").strip() or not (req.scope or "").strip():
        raise HTTPException(status_code=422, detail="folder and scope are required")
    owner, scope, tenant = _authorize_write(authorization, req.scope, req.owner, req.tenant_id)
    if not os.path.isdir(req.folder):
        raise HTTPException(status_code=404, detail="folder not found")
    return connectors.sync_mailbox(_conn, tenant, scope, req.folder,
                                   owner=owner, provider=req.provider, limit=req.limit)


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
    _maybe_propose_supersessions(tenant, note_id)
    _maybe_extract_people(tenant, note_id)
    return {"ok": True, "note_id": note_id, "chunks": n}

# --- URL ingestion (M4) -------------------------------------------------------
class IngestUrlReq(BaseModel):
    url: str
    scope: str
    owner: str
    tenant: str


def _resolve_public_ip(hostname: str):
    """Resolve a hostname to a single validated PUBLIC IP to pin the fetch to,
    or None if the host is non-public/unresolvable.

    Closes decimal/octal/hex IP encodings, IPv6, and (with the pinned fetch
    below) DNS-rebinding that a hostname-regex misses: if ANY resolved address
    is non-global we refuse outright, otherwise we return the first address so
    the caller can connect to exactly the IP we validated — no re-resolution,
    no TOCTOU window. Returns (ip_str, family) or None."""
    import ipaddress
    import socket
    if not hostname:
        return None
    # A literal IP in any encoding (2130706433, 0x7f.1, [::1]) parses here.
    try:
        ip = ipaddress.ip_address(hostname.strip("[]"))
        if not ip.is_global:
            return None
        fam = socket.AF_INET6 if ip.version == 6 else socket.AF_INET
        return (str(ip), fam)
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(hostname, None)
    except Exception:
        return None  # unresolvable → refuse
    chosen = None
    for fam, _t, _p, _c, sockaddr in infos:
        try:
            ip = ipaddress.ip_address(sockaddr[0])
        except ValueError:
            return None
        if not ip.is_global:
            return None  # any non-global answer → refuse (rebinding safety)
        if chosen is None:
            chosen = (sockaddr[0], fam)
    return chosen


def _host_is_private(hostname: str) -> bool:
    """Back-compat shim: True if the host is non-public/unresolvable."""
    return _resolve_public_ip(hostname) is None


class _PinnedHTTPConnection(http.client.HTTPConnection):
    """HTTPConnection that connects to a pre-validated IP instead of re-resolving
    self.host — while still sending the real hostname in the Host header."""
    def __init__(self, host, pinned_ip, **kw):
        super().__init__(host, **kw)
        self._pinned_ip = pinned_ip

    def connect(self):
        import socket
        self.sock = socket.create_connection(
            (self._pinned_ip, self.port), self.timeout, self.source_address)
        if self._tunnel_host:
            self._tunnel()


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """HTTPS variant of the pinned connection. Connects to the validated IP but
    keeps TLS verification (SNI + certificate) bound to the real hostname."""
    def __init__(self, host, pinned_ip, **kw):
        super().__init__(host, **kw)
        self._pinned_ip = pinned_ip

    def connect(self):
        import socket
        sock = socket.create_connection(
            (self._pinned_ip, self.port), self.timeout, self.source_address)
        if self._tunnel_host:
            self.sock = sock
            self._tunnel()
            sock = self.sock
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def _fetch_url_pinned(url: str, *, timeout: int, max_bytes: int) -> bytes:
    """Fetch an http(s) URL connecting ONLY to a pre-validated public IP.

    Closes the DNS-rebinding TOCTOU: the address checked is the exact address
    used (no re-resolution between the guard and connect). Redirects are not
    followed; TLS is verified against the real hostname."""
    import ssl
    import urllib.parse as _up
    parsed = _up.urlparse(url)
    pinned = _resolve_public_ip(parsed.hostname or "")
    if pinned is None:
        raise HTTPException(422, "private/loopback/unresolvable hosts are not fetchable")
    pinned_ip, _fam = pinned
    path = parsed.path or "/"
    if parsed.query:
        path += "?" + parsed.query
    if parsed.scheme == "https":
        conn = _PinnedHTTPSConnection(parsed.hostname, pinned_ip, port=parsed.port,
                                      timeout=timeout, context=ssl.create_default_context())
    else:
        conn = _PinnedHTTPConnection(parsed.hostname, pinned_ip, port=parsed.port,
                                     timeout=timeout)
    try:
        conn.request("GET", path, headers={
            "User-Agent": "Lore/1.0 (+local knowledge OS)",
            # identity so the bytes we hand to bs4 are not gzip/br-compressed.
            "Accept-Encoding": "identity",
        })
        resp = conn.getresponse()
        if resp.status in (301, 302, 303, 307, 308):
            raise HTTPException(422, "redirects are not followed (SSRF guard)")
        if resp.status >= 400:
            raise HTTPException(502, f"fetch failed: HTTP {resp.status}")
        return resp.read(max_bytes)
    finally:
        conn.close()


@app.post("/ingest-url")
def ingest_url(req: IngestUrlReq, authorization: Optional[str] = Header(default=None)):
    """Fetch a web page and index its readable text as a note (source_type='url').

    Guards: http/https only, non-public hosts refused via resolved-IP check
    (SSRF hygiene — decimal/hex/IPv6/DNS-rebinding), 2 MB cap, 15 s timeout,
    server-side redaction. Extraction: bs4 — drops script/style/nav chrome,
    prefers <article>/<main>, falls back to body paragraphs.
    """
    owner, scope, tenant = _authorize_write(authorization, req.scope, req.owner, req.tenant)
    import urllib.parse as _up
    parsed = _up.urlparse(req.url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(422, "only http(s) URLs are supported")
    try:
        # Fetch pinned to a pre-validated public IP — the resolved-then-fetched
        # address is identical, so a rebinding DNS answer cannot swap in a
        # private host after the check. Redirects are refused inside the helper.
        raw = _fetch_url_pinned(req.url, timeout=15, max_bytes=2 * 1024 * 1024)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"fetch failed: {e}")
    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(raw, "html.parser")
        for t in soup(["script", "style", "nav", "footer", "header", "aside", "noscript", "form"]):
            t.decompose()
        title = (soup.title.string or "").strip() if soup.title else ""
        main = soup.find("article") or soup.find("main") or soup.body or soup
        lines = [ln.strip() for ln in main.get_text("\n").splitlines()]
        text = "\n".join(ln for ln in lines if ln)
        text = __import__("re").sub(r"\n{3,}", "\n\n", text)
    except Exception as e:
        raise HTTPException(422, f"could not extract readable text: {e}")
    if len(text) < 80:
        raise HTTPException(422, "page had no readable text worth indexing")
    # Redact server-side, same as /memory and /capture — a fetched page can
    # carry a leaked key/token in its body.
    text = redact(text)
    title = title or parsed.hostname
    body = f"# {title}\n\nSource: {req.url}\n\n{text[:200_000]}\n"
    note_id = "url:" + hashlib.sha1(req.url.encode()).hexdigest()[:16]
    n = index_document(
        source_id=note_id, title=title, text=body,
        scope_id=scope, owner_id=owner, tenant_id=tenant,
        embedder=_local_embedder(), conn=_conn, sparse_embedder=_local_sparse(),
        source_type="url",
    )
    _audit("ingest-url", tenant, owner, [scope], req.url, n)
    return {"ok": True, "note_id": note_id, "title": title, "chunks": n}


# --- Agent memory bus (M3) ---------------------------------------------------
# Agents write scoped memories with ZERO pre-registration: the first write to
# `agent:<name>` self-provisions the agent (Mem0-style zero-friction signup —
# a human can claim/inspect it later via /memory/agents). Isolation is the
# existing scope ACL; the local token still gates the port.
_AGENT_NAME_RE = __import__("re").compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
_AGENT_WRITE_CAP = int(os.environ.get("LORE_AGENT_WRITE_CAP", "120"))  # writes/hour/agent
# Tenant-wide cap across ALL agents — closes the name-rotation bypass where a
# runaway process cycles agent names to dodge the per-agent cap.
_AGENT_WRITE_CAP_TENANT = int(os.environ.get("LORE_AGENT_WRITE_CAP_TENANT", "600"))


class MemoryReq(BaseModel):
    agent: str
    text: str
    tenant: str
    title: Optional[str] = None
    session_id: Optional[str] = None   # stable id -> upsert (one memory per key)


@app.post("/memory")
def memory_write(req: MemoryReq, authorization: Optional[str] = Header(default=None)):
    """Write an agent memory (redacted, chunked, embedded) into the agent's own
    scope. Returns the scope so the caller knows where to recall from.

    Local-first v1: refused in server mode — hosted deployments need real
    per-agent authn (M4 backlog item I3) before agents write cross-network.
    """
    if _server_mode():
        raise HTTPException(403, "agent memory writes are local-mode only for now")
    agent = (req.agent or "").strip().lower()
    if not _AGENT_NAME_RE.match(agent):
        raise HTTPException(422, "agent must match ^[a-z0-9][a-z0-9_-]{0,39}$")
    if not (req.text or "").strip():
        raise HTTPException(422, "text is required")
    tenant = req.tenant
    scope = f"agent:{agent}"

    # Write caps: per-agent AND tenant-wide (the latter can't be dodged by
    # cycling agent names). Both count the last hour of agent-memory writes.
    cutoff = (datetime.datetime.now(datetime.timezone.utc)
              - datetime.timedelta(hours=1)).isoformat(sep=" ")
    recent = _conn.execute(
        "select count(*) from notes where tenant_id=%s and scope_id=%s and updated_at > %s",
        (tenant, scope, cutoff)).fetchone()[0]
    if recent >= _AGENT_WRITE_CAP:
        raise HTTPException(429, f"agent write cap reached ({_AGENT_WRITE_CAP}/hour)")
    tenant_recent = _conn.execute(
        "select count(*) from notes where tenant_id=%s and source_type='agent-memory' and updated_at > %s",
        (tenant, cutoff)).fetchone()[0]
    if tenant_recent >= _AGENT_WRITE_CAP_TENANT:
        raise HTTPException(429, f"tenant agent-memory write cap reached ({_AGENT_WRITE_CAP_TENANT}/hour)")

    # Self-provision / bump the agent registry row.
    _conn.execute(
        """insert into agents(tenant_id, name, last_write, writes) values(%s,%s,now(),1)
           on conflict (tenant_id, name)
           do update set last_write=now(), writes=agents.writes+1""",
        (tenant, agent))

    safe_text = redact(req.text)
    key = req.session_id or hashlib.sha1(safe_text.encode()).hexdigest()[:12]
    note_id = f"agent:{agent}:{key}"
    title = req.title or f"{agent}: {safe_text.strip().splitlines()[0][:60]}"
    n = index_document(
        source_id=note_id, title=title, text=safe_text,
        scope_id=scope, owner_id=f"agent:{agent}", tenant_id=tenant,
        embedder=_local_embedder(), conn=_conn, sparse_embedder=_local_sparse(),
        source_type="agent-memory",
    )
    _audit("memory-write", tenant, f"agent:{agent}", [scope], title, n)
    return {"ok": True, "note_id": note_id, "scope": scope, "chunks": n}


@app.get("/memory/agents")
def memory_agents(tenant: Optional[str] = None):
    """The agent registry: who has self-provisioned, how much they write.
    The 'human claims it later' surface."""
    if not tenant:
        return {"agents": []}
    rows = _conn.execute(
        """select name, first_seen, last_write, writes, claimed_by
           from agents where tenant_id=%s
           order by coalesce(last_write, first_seen) desc""",
        (tenant,)).fetchall()
    return {"agents": [{
        "name": r[0],
        "first_seen": r[1].isoformat() if r[1] else None,
        "last_write": r[2].isoformat() if r[2] else None,
        "writes": r[3] or 0,
        "claimed_by": r[4],
        "scope": f"agent:{r[0]}",
    } for r in rows]}


class FeedbackReq(BaseModel):
    tenant: str
    note_id: str
    vote: int                      # +1 / -1
    query_hash: Optional[str] = None


@app.post("/feedback")
def feedback(req: FeedbackReq):
    """Thumbs on an answer's citation — feeds the personal ranking layer
    (net votes per note become a bounded recall boost/demotion).

    The note must exist in the tenant — refuses votes on arbitrary ids so a
    caller can't seed ranking rows for notes it never retrieved. (feedback_net
    only ever affects ranking within a scoped retrieval, so a stray vote could
    not cross the ACL anyway, but validating keeps the table clean.)"""
    exists = _conn.execute(
        "select 1 from notes where id=%s and tenant_id=%s", (req.note_id, req.tenant)).fetchone()
    if not exists:
        raise HTTPException(404, "note not found in this tenant")
    vote = 1 if req.vote > 0 else -1
    _conn.execute(
        "insert into feedback(tenant_id, note_id, vote, query_hash) values(%s,%s,%s,%s)",
        (req.tenant, req.note_id, vote, req.query_hash))
    net = _conn.execute(
        "select coalesce(sum(vote),0) from feedback where tenant_id=%s and note_id=%s",
        (req.tenant, req.note_id)).fetchone()[0]
    return {"ok": True, "note_id": req.note_id, "net": int(net)}


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

    # Typed relations with provenance — ACL-safe: the other endpoint of every
    # edge must itself pass the caller's scope filter or the edge is omitted.
    allowed = [s.strip() for s in scopes.split(",") if s.strip()] if scopes else None

    from .relations import INVERSE_KINDS

    def _edge_rows(where_col, other_col, inverse=False):
        rows = _conn.execute(
            f"""select e.{other_col}, n.title, n.scope_id, e.kind, e.weight, e.origin, e.evidence
                from edges e join notes n on n.id = e.{other_col} and n.tenant_id = e.tenant_id
                where e.tenant_id=%s and e.{where_col}=%s""",
            (active_tenant, note_id)).fetchall()
        out = []
        for other_id, other_title, other_scope, kind, weight, origin, evidence in rows:
            if allowed and other_scope not in allowed:
                continue
            out.append({
                "other_id": other_id, "other_title": other_title or other_id,
                "kind": kind,
                # Incoming edges read from THIS note's side: `supersedes` in
                # reads as `superseded_by` (virtual inverse, nothing stored).
                "kind_label": INVERSE_KINDS.get(kind, kind) if inverse else kind,
                "weight": round(weight or 0, 2),
                "origin": origin or "index",
                "evidence": (evidence or "")[:200] or None,
            })
        return out

    return {
        "id": id_,
        "title": title,
        "scope": scope,
        "body": body,
        "updated": updated.isoformat() if updated else None,
        "edges": {
            "out": _edge_rows("src_note_id", "dst_note_id"),
            "in": _edge_rows("dst_note_id", "src_note_id", inverse=True),
        },
    }


def _count_tokens(text: str) -> int:
    try:
        import tiktoken
        return len(tiktoken.get_encoding("cl100k_base").encode(text or ""))
    except Exception:
        return int(len((text or "").split()) * 1.3)


class ContextPackReq(BaseModel):
    task: str
    scopes: list[str]
    tenant_id: str
    budget: int = 4000          # token budget for the pack body
    max_per_note: int = 2       # chunk dedupe cap per note


@app.post("/context-pack")
def context_pack(req: ContextPackReq, embedder=Depends(get_embedder),
                 reranker=Depends(get_reranker), sparse=Depends(get_sparse_embedder),
                 authorization: Optional[str] = Header(default=None)):
    """Token-budgeted context pack for agents: retrieve → rerank → greedy fill
    by final score until the budget is spent, deduped per note, every item
    cited. The output is designed to be pasted straight into an agent prompt
    (Hooks' lore-inject becomes budget-aware by calling this)."""
    _uid, scopes, tenant = _authorize_read(authorization, req.scopes, req.tenant_id)
    budget = max(200, min(req.budget, 32000))
    hits = retrieve(req.task, embedder, reranker, scopes, tenant,
                    limit=24, sparse_embedder=sparse,
                    note_signals=_note_signals_provider(tenant, req.task))
    metas = _note_meta([h.note_id for h in hits])

    items, parts = [], []
    used = 0
    per_note: dict = {}
    for h in hits:
        if per_note.get(h.note_id, 0) >= max(1, req.max_per_note):
            continue
        title = (metas.get(h.note_id) or {}).get("title") or h.heading_path or h.note_id
        block = f"### {title} — {h.heading_path}\n{h.text.strip()}\n"
        t = _count_tokens(block)
        if used + t > budget:
            if items:
                continue  # keep trying smaller chunks that might still fit
            block = block[: max(200, int(len(block) * budget / max(t, 1)))]
            t = _count_tokens(block)
        per_note[h.note_id] = per_note.get(h.note_id, 0) + 1
        used += t
        parts.append(block)
        items.append({
            "note_id": h.note_id, "title": title, "heading_path": h.heading_path,
            "score": round(h.score, 4), "tokens": t,
        })
        if used >= budget:
            break
    _audit("context-pack", tenant, _uid, scopes, req.task, len(items))
    return {
        "pack": "\n".join(parts),
        "items": items,
        "tokens_total": used,
        "budget": budget,
        "scopes_used": list(scopes),
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
                    limit=k, sparse_embedder=sparse,
                    note_signals=_note_signals_provider(tenant, req.query))
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
    _audit("search", tenant, _uid, scopes, req.query, len(hits))
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
    auto_journal: bool = False       # opt-in (cfg.autoJournal): materialize a daily journal note

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
                       auto_file=req.auto_file,
                       auto_journal=req.auto_journal)
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
    # 'codex' | 'claude' | 'byok' — same provider routing as the main chat.
    provider: Optional[str] = None


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
    text, engine = llm.answer(req.question, chunks, model=req.model, provider=req.provider)
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


# --- Ask chat history (the main chat's persisted threads) ----------------------
# Mirror of personal_wizard_chats plus: thread_id (one active thread at a time in
# the UI; the History drawer lists/resumes/deletes past threads) and `source`
# (which context the question was asked from — private/team/company).

class AskHistoryAppendReq(BaseModel):
    tenant: str
    thread_id: str
    role: str                       # 'user' | 'assistant'
    text: str
    sources: Optional[list] = None  # citations for assistant turns
    source: Optional[str] = None    # ask context: private | team | company


class AskHistoryDeleteReq(BaseModel):
    tenant: str
    thread_id: str


def _ask_history_row(r):
    cid, thread_id, role, text, sources, source, created = r
    try:
        srcs = json.loads(sources) if sources else None
    except Exception:
        srcs = None
    return {"id": cid, "thread_id": thread_id, "role": role, "text": text,
            "sources": srcs, "source": source,
            "created_at": created.isoformat() if isinstance(created, datetime.datetime) else created}


@app.post("/ask-history")
def ask_history_append(req: AskHistoryAppendReq):
    """Append one chat turn. Same id scheme as the wizard chats (nanosecond
    timestamp + random suffix) so (created_at, id) ordering stays stable even
    when the user turn and the assistant turn land in the same second."""
    if req.role not in ("user", "assistant"):
        raise HTTPException(status_code=422, detail="role must be 'user' or 'assistant'")
    if not req.thread_id:
        raise HTTPException(status_code=422, detail="thread_id is required")
    cid = f"{time.time_ns():020d}-{uuid.uuid4().hex[:8]}"
    _conn.execute(
        "insert into ask_history(id, tenant_id, thread_id, role, text, sources, source) "
        "values(%s,%s,%s,%s,%s,%s,%s)",
        (cid, req.tenant, req.thread_id, req.role, req.text,
         json.dumps(req.sources) if req.sources else None, req.source))
    return {"ok": True, "id": cid}


@app.get("/ask-history")
def ask_history_list(tenant: Optional[str] = None, thread_id: Optional[str] = None,
                     limit: int = 200):
    """Messages for one thread (oldest first) — or, with no thread_id, the most
    recent messages across all threads (still oldest first; feeds suggestPrompts'
    repeat-mining). Returns {messages:[{id, thread_id, role, text, sources, source, created_at}]}"""
    if not tenant:
        raise HTTPException(status_code=422, detail="tenant is required")
    n = max(1, min(limit, 500))
    if thread_id:
        rows = _conn.execute(
            "select id, thread_id, role, text, sources, source, created_at from ask_history "
            "where tenant_id=%s and thread_id=%s order by created_at, id limit %s",
            (tenant, thread_id, n)).fetchall()
    else:
        rows = _conn.execute(
            "select id, thread_id, role, text, sources, source, created_at from ask_history "
            "where tenant_id=%s order by created_at desc, id desc limit %s",
            (tenant, n)).fetchall()
        rows = list(reversed(rows))
    return {"messages": [_ask_history_row(r) for r in rows]}


@app.get("/ask-history/threads")
def ask_history_threads(tenant: Optional[str] = None):
    """Thread index for the History drawer, newest first.
    Returns {threads:[{thread_id, title (first user question), count, updated_at}]}"""
    if not tenant:
        raise HTTPException(status_code=422, detail="tenant is required")
    rows = _conn.execute(
        "select id, thread_id, role, text, created_at from ask_history "
        "where tenant_id=%s order by created_at, id", (tenant,)).fetchall()
    threads = {}
    order = []
    last_id = {}
    for cid, thread_id, role, text, created in rows:
        if thread_id not in threads:
            threads[thread_id] = {"thread_id": thread_id, "title": None, "count": 0, "updated_at": None}
            order.append(thread_id)
        t = threads[thread_id]
        t["count"] += 1
        if t["title"] is None and role == "user" and text:
            t["title"] = text
        t["updated_at"] = created.isoformat() if isinstance(created, datetime.datetime) else created
        last_id[thread_id] = cid
    out = [threads[tid] for tid in order]
    for t in out:
        t["title"] = t["title"] or "(untitled)"
    # Recency sort: ids embed a nanosecond timestamp, so the last id per thread is
    # a stable tiebreak when created_at only has second resolution.
    out.sort(key=lambda t: last_id.get(t["thread_id"], ""), reverse=True)
    return {"threads": out}


@app.post("/ask-history/delete")
def ask_history_delete(req: AskHistoryDeleteReq):
    """Delete one thread (History drawer's delete action). Returns {ok, deleted}."""
    if not req.tenant or not req.thread_id:
        raise HTTPException(status_code=422, detail="tenant and thread_id are required")
    rows = _conn.execute(
        "select count(*) from ask_history where tenant_id=%s and thread_id=%s",
        (req.tenant, req.thread_id)).fetchone()
    _conn.execute("delete from ask_history where tenant_id=%s and thread_id=%s",
                  (req.tenant, req.thread_id))
    return {"ok": True, "deleted": rows[0] if rows else 0}


# --- Supersession proposals (auto-detected stale-fact candidates) -----------
# SAFEGUARD: proposals never affect ranking — _note_signals_provider filters
# out NON_RANKING_ORIGINS. Only an explicit accept (or a cue-lexicon edge from
# prose) marks the old note superseded.

class SupersessionResolveReq(BaseModel):
    tenant: str
    src: str            # the newer note (proposal source)
    dst: str            # the older, possibly-stale note
    action: str         # 'accept' | 'dismiss'


# --- People (names + interactions extracted from notes/captures) ------------
# Extraction is deterministic (capitalized-name n-grams + email regex, no LLM);
# privacy is per-MENTION: a person is only visible through mentions whose
# scope_id the caller may read — same local-trust auth style as /sections.

class PeopleMergeReq(BaseModel):
    tenant: str
    keep_id: str
    merge_id: str


class PeopleHideReq(BaseModel):
    tenant: str
    person_id: str


def _maybe_extract_people(tenant: str, note_id: str) -> None:
    """People extraction on freshly ingested/captured notes. Non-fatal by
    design (like _maybe_propose_supersessions). Gate: LORE_PEOPLE=0."""
    if os.environ.get("LORE_PEOPLE") == "0":
        return
    try:
        from . import people
        people.extract_mentions(_conn, tenant, note_id)
    except Exception:
        pass  # extraction must never fail an ingest


@app.get("/people")
def people_list(tenant: Optional[str] = None, scopes: Optional[str] = None):
    """People with at least one in-scope mention, most recently seen first.
    Returns {people:[{id, name, emails, mention_count, last_seen, sources}]}"""
    if not tenant:
        raise HTTPException(status_code=422, detail="tenant is required")
    from . import people
    try:
        return {"people": people.list_people(_conn, tenant, scopes or "")}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/people/detail")
def people_detail(tenant: Optional[str] = None, scopes: Optional[str] = None,
                  person_id: Optional[str] = None):
    """One person + their in-scope interaction timeline (newest first).
    Returns {person, interactions:[{note_id, title, source_type, date, evidence}]}"""
    if not tenant:
        raise HTTPException(status_code=422, detail="tenant is required")
    if not person_id:
        raise HTTPException(status_code=422, detail="person_id is required")
    from . import people
    try:
        detail = people.person_detail(_conn, tenant, scopes or "", person_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if detail is None:
        raise HTTPException(status_code=404, detail="person not found")
    return detail


@app.post("/people/merge")
def people_merge(req: PeopleMergeReq):
    """Merge two people (dedupe): mentions re-point to keep_id, emails union,
    merge_id row deleted. Body: {tenant, keep_id, merge_id}."""
    from . import people
    result = people.merge_people(_conn, req.tenant, req.keep_id, req.merge_id)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error") or "person not found")
    return result


@app.post("/people/hide")
def people_hide(req: PeopleHideReq):
    """Hide a person from lists (false-positive cleanup). Body: {tenant, person_id}."""
    from . import people
    return people.hide_person(_conn, req.tenant, req.person_id)


@app.get("/supersessions")
def supersessions_list(tenant: Optional[str] = None):
    """Pending auto-supersession proposals for review.
    Returns {proposals:[{src, dst, confidence, evidence, proposed_at,
                         src_title, dst_title}]}"""
    if not tenant:
        raise HTTPException(status_code=422, detail="tenant is required")
    return {"proposals": supersede.list_proposals(_conn, tenant)}


@app.post("/supersessions/resolve")
def supersessions_resolve(req: SupersessionResolveReq,
                          authorization: Optional[str] = Header(default=None)):
    """Accept or dismiss a pending proposal. Accepting makes the dst note count
    as superseded in ranking (via the signals provider) on the next query;
    dismissing pins the pair so it is never re-proposed.
    Body: {tenant, src, dst, action}. Returns {ok, resolved}."""
    _require_user_in_server_mode(authorization)   # no anonymous edge edits when hosted
    if req.action not in ("accept", "dismiss"):
        raise HTTPException(status_code=422, detail="action must be accept|dismiss")
    changed = supersede.resolve_proposal(_conn, req.tenant, req.src, req.dst, req.action)
    return {"ok": True, "resolved": changed}


@app.get("/state")
def state(tenant: Optional[str] = None, scopes: Optional[str] = None,
          budget: int = 800,
          authorization: Optional[str] = Header(default=None)):
    """Compile current facts into a token-budgeted context block, newest first.

    For agents using Lore as ambient memory rather than Q&A: superseded notes
    are excluded entirely (their replacement is what's current), raw session
    captures are skipped in favor of distilled notes, and output stops at
    ~`budget` tokens (chars/4 estimate — same heuristic as the eval suite).

    Query params: tenant (required), scopes (comma-separated), budget (default 800,
    clamped 100..4000). Returns {block, count, tokens_est, budget}.
    """
    if not tenant:
        raise HTTPException(status_code=422, detail="tenant is required")
    _, eff_scopes, tenant = _authorize_read(authorization, _as_scope_list(scopes), tenant)
    if not eff_scopes:
        raise HTTPException(status_code=422, detail="scopes is required")
    budget = max(100, min(int(budget), 4000))

    stale = supersede.superseded_note_ids(_conn, tenant)
    scope_pred, scope_params = in_clause("scope_id", eff_scopes)
    sess_pred, sess_params = in_clause(
        "coalesce(source_type,'note')",
        ("claude-session", "codex-session", "claude-history"))
    rows = _conn.execute(
        f"""select id, title, coalesce(created_at, updated_at)
            from notes
            where tenant_id=%s and {scope_pred} and not {sess_pred}
            order by coalesce(created_at, updated_at) desc
            limit 300""",
        (tenant, *scope_params, *sess_params),
    ).fetchall()

    lines, used, count = [], 0, 0
    for note_id, title, ts in rows:
        if note_id in stale:
            continue
        chunk = _conn.execute(
            "select text from chunks where note_id=%s order by chunk_index limit 1",
            (note_id,),
        ).fetchone()
        excerpt = " ".join(((chunk[0] if chunk else "") or "").split())[:240]
        day = str(ts)[:10] if ts else "?"
        line = f"- {title or note_id} ({day}): {excerpt}"
        cost = len(line) // 4 + 1
        if used + cost > budget:
            break
        lines.append(line)
        used += cost
        count += 1

    return {"block": "\n".join(lines), "count": count,
            "tokens_est": used, "budget": budget}


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
