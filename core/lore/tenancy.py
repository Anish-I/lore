"""Server-side multi-tenant authorization for Lore.

Derives a caller's authorized team scope IDs from MEMBERSHIP tables (never from
client claims), so cross-team recall is leak-proof at the candidate-generation
stage.  `private` scope is structurally non-syncable: the zero-knowledge invariant.
"""

_SYNCABLE_SCOPE_TYPES = frozenset(("team", "enterprise"))

_SCHEMA = [
    """create table if not exists users (
         id text primary key, google_sub text unique, email text, name text,
         created_at timestamptz default now())""",
    "create table if not exists orgs (id text primary key, name text)",
    "create table if not exists teams (id text primary key, org_id text, name text)",
    """create table if not exists memberships (
         user_id text, org_id text, team_id text, role text,
         status text default 'active',
         primary key (user_id, team_id))""",
    """create table if not exists audit_log (
         id bigserial primary key, ts timestamptz default now(),
         actor_user_id text, action text, scope_ids text, detail text)""",
    """create table if not exists invites (
         id text primary key, team_id text not null, email text not null,
         invited_by text not null, role text default 'member',
         status text default 'pending',
         created_at timestamptz default now(), accepted_at timestamptz,
         accepted_by text)""",
]

# SQLite variant of the tenancy DDL: mirrors _SCHEMA above with dialect-legal
# substitutions (bigserial -> integer primary key autoincrement,
# timestamptz -> timestamp, now() -> current_timestamp).
_SCHEMA_SQLITE = [
    """create table if not exists users (
         id text primary key, google_sub text unique, email text, name text,
         created_at timestamp default current_timestamp)""",
    "create table if not exists orgs (id text primary key, name text)",
    "create table if not exists teams (id text primary key, org_id text, name text)",
    """create table if not exists memberships (
         user_id text, org_id text, team_id text, role text,
         status text default 'active',
         primary key (user_id, team_id))""",
    """create table if not exists audit_log (
         id integer primary key autoincrement, ts timestamp default current_timestamp,
         actor_user_id text, action text, scope_ids text, detail text)""",
    """create table if not exists invites (
         id text primary key, team_id text not null, email text not null,
         invited_by text not null, role text default 'member',
         status text default 'pending',
         created_at timestamp default current_timestamp, accepted_at timestamp,
         accepted_by text)""",
]


def bootstrap_tenancy(conn) -> None:
    """Create the tenancy tables. Idempotent — safe on every server start."""
    from . import db as _db
    stmts = _SCHEMA_SQLITE if isinstance(conn, _db._SqliteConn) else _SCHEMA
    for stmt in stmts:
        conn.execute(stmt)


def team_scope_id(team_id) -> str:
    """Canonical scope id for a team. Used as the Qdrant `scope_ids` payload value."""
    return f"team:{team_id}"


def syncable_scope(scope_type: str) -> bool:
    """True if a scope's notes may leave the device for the shared server.
    `private` is never syncable — enforced here and asserted by tests."""
    return scope_type in _SYNCABLE_SCOPE_TYPES


def authorized_team_scope_ids(conn, user_id: str) -> list[str]:
    """The team scope ids a user may READ, derived from active memberships.
    SERVER-SIDE source of truth — never trust scopes supplied by the client."""
    rows = conn.execute(
        "select team_id from memberships where user_id=%s and status='active' order by team_id",
        (user_id,),
    ).fetchall()
    return [team_scope_id(r[0]) for r in rows]


def authorize_scopes(conn, user_id: str, requested) -> list:
    """Scopes the server will query with. Without a request → all authorized scopes.
    With a request → requested ∩ authorized, so a client can never widen its access."""
    authorized = set(authorized_team_scope_ids(conn, user_id))
    if not requested:
        return sorted(authorized)
    return sorted(authorized.intersection(requested))


# --- Team creation + email invites (the "share your base" flow) -------------

class InviteError(Exception):
    """Invite/team operation rejected. Message is safe to surface to the caller."""


def _audit(conn, actor, action, scope_ids="", detail=""):
    conn.execute(
        "insert into audit_log(actor_user_id, action, scope_ids, detail) values(%s,%s,%s,%s)",
        (actor, action, scope_ids, detail))


def create_team(conn, name: str, owner_user_id: str) -> dict:
    """Create a team (its own single-team org) with the caller as active owner.
    Returns {team_id, scope, name}."""
    import secrets
    name = (name or "").strip()
    if not name:
        raise InviteError("team name required")
    team_id = f"tm-{secrets.token_urlsafe(8)}"
    conn.execute("insert into orgs(id,name) values(%s,%s)", (f"org-{team_id}", name))
    conn.execute("insert into teams(id,org_id,name) values(%s,%s,%s)",
                 (team_id, f"org-{team_id}", name))
    conn.execute(
        "insert into memberships(user_id,org_id,team_id,role,status) values(%s,%s,%s,'owner','active')",
        (owner_user_id, f"org-{team_id}", team_id))
    _audit(conn, owner_user_id, "team.create", team_scope_id(team_id), name)
    return {"team_id": team_id, "scope": team_scope_id(team_id), "name": name}


def _require_active_member(conn, user_id: str, team_id: str) -> None:
    row = conn.execute(
        "select 1 from memberships where user_id=%s and team_id=%s and status='active'",
        (user_id, team_id)).fetchone()
    if row is None:
        raise InviteError("not an active member of this team")


def invite_to_team(conn, team_id: str, email: str, invited_by: str, role: str = "member") -> dict:
    """Invite `email` to a team. Inviter must be an active member. Idempotent per
    (team, email): re-inviting a pending address returns the existing invite.
    Returns {invite_id, team_id, email, status} — the invite_id doubles as the token
    the invitee presents (delivery, e.g. email, is the caller's concern)."""
    import secrets
    email = (email or "").strip().lower()
    if "@" not in email:
        raise InviteError("valid email required")
    _require_active_member(conn, invited_by, team_id)
    existing = conn.execute(
        "select id from invites where team_id=%s and email=%s and status='pending'",
        (team_id, email)).fetchone()
    if existing:
        return {"invite_id": existing[0], "team_id": team_id, "email": email, "status": "pending"}
    invite_id = f"inv-{secrets.token_urlsafe(16)}"
    conn.execute(
        "insert into invites(id,team_id,email,invited_by,role) values(%s,%s,%s,%s,%s)",
        (invite_id, team_id, email, invited_by, role))
    _audit(conn, invited_by, "invite.create", team_scope_id(team_id), email)
    return {"invite_id": invite_id, "team_id": team_id, "email": email, "status": "pending"}


def pending_invites_for(conn, email: str) -> list[dict]:
    """Pending invites addressed to `email` (what a fresh login sees waiting)."""
    rows = conn.execute(
        "select i.id, i.team_id, t.name, i.invited_by, i.role from invites i "
        "left join teams t on t.id = i.team_id "
        "where i.email=%s and i.status='pending' order by i.id",
        ((email or "").strip().lower(),)).fetchall()
    return [{"invite_id": r[0], "team_id": r[1], "team_name": r[2],
             "invited_by": r[3], "role": r[4]} for r in rows]


# Invites are single-use AND time-limited: a leaked/forwarded invite id must not
# stay redeemable forever. 7 days matches typical SaaS invite windows.
INVITE_TTL_DAYS = 7


def _invite_expired(created_at, max_age_days: int = INVITE_TTL_DAYS) -> bool:
    """True if an invite created at `created_at` is older than the TTL.
    Handles both tz-aware datetimes (Postgres / SQLite converter) and ISO strings."""
    import datetime as _dt
    if created_at is None:
        return False
    if isinstance(created_at, str):
        try:
            created_at = _dt.datetime.fromisoformat(created_at)
        except ValueError:
            return False
    now = _dt.datetime.now(created_at.tzinfo) if created_at.tzinfo else _dt.datetime.utcnow()
    return (now - created_at) > _dt.timedelta(days=max_age_days)


def accept_invite(conn, invite_id: str, user_id: str, user_email: str) -> dict:
    """Accept an invite as the authenticated user. The user's verified login email
    must match the invited address (case-insensitive) — an invite id alone is not
    enough to join. Invites expire after INVITE_TTL_DAYS. Grants an active
    membership and closes the invite."""
    row = conn.execute(
        "select team_id, email, role, status, created_at from invites where id=%s", (invite_id,)).fetchone()
    if row is None:
        raise InviteError("invite not found")
    team_id, invited_email, role, status, created_at = row
    if status != "pending":
        raise InviteError(f"invite already {status}")
    if _invite_expired(created_at):
        conn.execute("update invites set status='expired' where id=%s", (invite_id,))
        raise InviteError("invite has expired")
    if (user_email or "").strip().lower() != invited_email:
        raise InviteError("invite was issued to a different email")
    org = conn.execute("select org_id from teams where id=%s", (team_id,)).fetchone()
    conn.execute(
        "insert into memberships(user_id,org_id,team_id,role,status) values(%s,%s,%s,%s,'active') "
        "on conflict (user_id,team_id) do update set status='active', role=excluded.role",
        (user_id, org[0] if org else None, team_id, role))
    conn.execute(
        "update invites set status='accepted', accepted_at=now(), accepted_by=%s where id=%s",
        (user_id, invite_id))
    _audit(conn, user_id, "invite.accept", team_scope_id(team_id), invited_email)
    return {"team_id": team_id, "scope": team_scope_id(team_id), "role": role}
