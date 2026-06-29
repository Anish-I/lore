"""Server-side multi-tenant authorization for Lore.

Derives a caller's authorized team scope IDs from MEMBERSHIP tables (never from
client claims), so cross-team recall is leak-proof at the candidate-generation
stage.  `private` scope is structurally non-syncable: the zero-knowledge invariant.
"""

_SYNCABLE_SCOPE_TYPES = frozenset(("team", "enterprise"))

_SCHEMA = [
    "create table if not exists orgs (id text primary key, name text)",
    "create table if not exists teams (id text primary key, org_id text, name text)",
    """create table if not exists memberships (
         user_id text, org_id text, team_id text, role text,
         status text default 'active',
         primary key (user_id, team_id))""",
    """create table if not exists audit_log (
         id bigserial primary key, ts timestamptz default now(),
         actor_user_id text, action text, scope_ids text, detail text)""",
]


def bootstrap_tenancy(conn) -> None:
    """Create the tenancy tables. Idempotent — safe on every server start."""
    for stmt in _SCHEMA:
        conn.execute(stmt)


def team_scope_id(team_id) -> str:
    """Canonical scope id for a team. Used as the Qdrant `scope_ids` payload value."""
    return f"team:{team_id}"


def syncable_scope(scope_type: str) -> bool:
    """True if a scope's notes may leave the device for the shared server.
    `private` is never syncable — enforced here and asserted by tests."""
    return scope_type in _SYNCABLE_SCOPE_TYPES
