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
from .index import index_note, index_document
from .recall import retrieve, retrieve_traced
from .redact import redact
from . import llm
from . import auth, tenancy

app = FastAPI(title="Lore Core")
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
    Returns the invite; delivering it (email) is the desktop app's job for now."""
    try:
        return tenancy.invite_to_team(_conn, team_id, req.email, user_id)
    except tenancy.InviteError as e:
        raise HTTPException(status_code=403, detail=str(e))


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

@app.post("/reindex")
def reindex(req: ReindexReq, embedder=Depends(get_embedder), sparse=Depends(get_sparse_embedder)):
    n = index_note(req.path, embedder, _conn, req.owner_id, req.scope_id, req.tenant_id,
                   sparse_embedder=sparse)
    return {"indexed_chunks": n}

@app.post("/ingest")
def ingest(req: IngestReq):
    """Index pre-normalized text from an external source.

    IMPORTANT: always uses the local embedder regardless of VOYAGE_API_KEY.
    Caller-supplied text may contain sensitive data; sending it to an external
    embedding API (Voyage) would be a data-leak path.  LocalEmbedder runs fully
    on-device.  In VAULT_FAKE=1 test mode FakeEmbedder is used instead.
    """
    if _FAKE:
        embedder = FakeEmbedder()
        sparse = None
    else:
        embedder = LocalEmbedder()       # never VoyageEmbedder here
        sparse = LocalSparseEmbedder()

    n = index_document(
        source_id=req.source_id, title=req.title, text=req.text,
        scope_id=req.scope, owner_id=req.owner, tenant_id=req.tenant,
        embedder=embedder, conn=_conn, sparse_embedder=sparse,
        source_type=req.source_type, content_hash=req.content_hash,
    )
    return {"ok": True, "note_id": req.source_id, "chunks": n}

@app.post("/ask")
def ask(req: AskReq, embedder=Depends(get_embedder), reranker=Depends(get_reranker),
        sparse=Depends(get_sparse_embedder)):
    hits = retrieve(req.question, embedder, reranker, req.principal_scopes, req.tenant_id,
                    sparse_embedder=sparse)
    chunks = [{"title": h.heading_path, "text": h.text} for h in hits]
    text, engine = llm.answer(req.question, chunks, model=req.model)
    return {"answer": text, "engine": engine,
            "citations": [{"note_id": h.note_id, "heading_path": h.heading_path, "why": h.why} for h in hits]}

@app.post("/trace")
def trace(req: AskReq, embedder=Depends(get_embedder), reranker=Depends(get_reranker),
          sparse=Depends(get_sparse_embedder)):
    """Full pipeline trace for the visualizer: per-lane candidates, fusion, rerank, answer."""
    if sparse is None:
        return {"error": "trace requires real models (unset VAULT_FAKE)"}
    _, tr = retrieve_traced(req.question, embedder, reranker, sparse,
                            req.principal_scopes, req.tenant_id)
    chunks = [{"title": f["title"], "text": f["text"]} for f in tr["final"]]
    text, engine = llm.answer(req.question, chunks, model=req.model)
    tr["answer"] = text
    tr["engine"] = engine
    tr["scopes_asked"] = req.principal_scopes
    return tr

@app.get("/presets")
def presets():
    return active_profile()

@app.get("/graph")
def graph(tenant: Optional[str] = None, scopes: Optional[str] = None):
    """Return the knowledge graph for a tenant filtered by ACL scope.

    Query params:
        tenant: tenant_id to query. No tenant is assumed when omitted.
        scopes: comma-separated list of scope_ids the viewer can see
                (no scopes are assumed when omitted).

    Response:
        {
          "nodes": [{"id", "label", "scope", "owner", "links", "updated"}, ...],
          "edges": [[src_id, dst_id, kind], ...]
        }

    ACL guarantees (enforced server-side, not post-filtered):
        - A node appears only if its scope_id is in the caller's allowed set.
        - An edge appears only if BOTH endpoints are in the returned node set.
        - Node `links` counts degree AFTER scope filtering.
        - Node list is capped at 1500 (most-connected first); edges follow.
    """
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
        f"""select id, title, scope_id, owner_id, updated_at, source_path, importance
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
        nid_, title, scope_id, owner_id, updated_at, source_path, importance = row_by_id[nid]
        nodes.append({
            "id": nid_,
            "label": title or nid_,
            "scope": scope_id,
            "owner": owner_id,
            "path": source_path,
            "links": degree.get(nid_, 0),
            "updated": updated_at.isoformat() if updated_at else None,
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
        return {"notes": 0, "chunks": 0, "edges": 0}
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
    return {"notes": notes, "chunks": chunks, "edges": edges}

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
def capture(req: CaptureReq):
    """Index a Claude session transcript after server-side secret redaction.

    Text is redacted before embedding or storage.  Re-POSTing the same
    session_id upserts the existing note (one note per session).

    Body: {session_id, title, text, scope, owner, tenant, mode}
    Returns: {ok, note_id, chunks}
    """
    safe_text = redact(req.text)
    note_id = _session_note_id(req.session_id)
    n = index_document(
        source_id=note_id, title=req.title, text=safe_text,
        scope_id=req.scope, owner_id=req.owner, tenant_id=req.tenant,
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
def forget(req: ForgetReq):
    """Delete all notes whose source_path starts with path_prefix for the given tenant.
    Normalizes backslashes to forward slashes before comparison.
    Removes from Qdrant, cleans edges (both directions), deletes notes (chunks cascade).
    Body: {tenant, path_prefix}. Returns {forgotten: n}"""
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
def capture_delete(source_type: Optional[str] = None, tenant: Optional[str] = None):
    """Privacy purge: delete all notes of the given source_type within a tenant.

    Removes matching notes from Postgres (chunks cascade), their outgoing/incoming
    edges, and their Qdrant vector points.

    Query params: source_type (required), tenant (required)
    Returns: {deleted: n}
    """
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
def get_note(note_id: str, tenant: Optional[str] = None, scopes: Optional[str] = None):
    """Retrieve a note's metadata and original body by ID.

    Query params:
        tenant: tenant_id to read from. No tenant is assumed when omitted.
        scopes: comma-separated ACL scopes; when supplied the note must be in one of
                them or a 404 is returned.  Omit to skip scope filtering.

    Returns {id, title, scope, body, updated}.  body is the original markdown
    as stored at index time (lossless; chunk text is NOT a full reconstruction).
    404 if the note does not exist or is not visible to the caller.
    """
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
           sparse=Depends(get_sparse_embedder)):
    """Hybrid-retrieve ranked chunks filtered by the given scopes.

    Body: {query, scopes:[...], tenant_id, k?:int=10}
    Returns: {results:[{note_id, title, scope, heading_path, text, score}]}

    scopes is REQUIRED and must not be empty (never defaults to all).
    """
    if not req.query or not req.query.strip():
        raise HTTPException(status_code=422, detail="query must not be blank")
    if not req.scopes or not any(s.strip() for s in req.scopes):
        raise HTTPException(status_code=422, detail="scopes is required and must not be empty")
    k = max(1, min(req.k, 50))
    hits = retrieve(req.query, embedder, reranker, req.scopes, req.tenant_id,
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
    return {"results": results}


# --- Upkeep state (in-process; reset on restart) ---
_upkeep_last_run: Optional[str] = None
_upkeep_last_stats: dict = {}

class UpkeepRunReq(BaseModel):
    tenant: str
    scope: Optional[str] = None
    use_llm: bool = False   # when True: Ollama-assisted topic extraction (slower, capped at 25 notes)

@app.post("/upkeep/run")
def upkeep_run(req: UpkeepRunReq, embedder=Depends(get_embedder)):
    """Fold ephemeral date/session notes into durable topic nodes.

    Body: {tenant, scope?, use_llm?:bool=False}
    Returns: {dateNotes, topics, folded}
    """
    from .upkeep import run_upkeep
    global _upkeep_last_run, _upkeep_last_stats
    stats = run_upkeep(_conn, embedder, req.tenant, scope=req.scope, use_llm=req.use_llm)
    _upkeep_last_run = datetime.datetime.utcnow().isoformat()
    _upkeep_last_stats = stats
    return stats


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
    from .llm_providers import resolve_llm_call, provider_available, ProviderError
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
