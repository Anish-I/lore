"""Named scopes + grants — the opt-in partitioning capability of the API service.

Personal mode never touches this: everything lives in `private:{user}`. When a
user CREATES a scope ("work", "case-files") it becomes an additional partition
they own; grants share it with other users at read or write level. Authorization
flows through `tenancy.authorize_scopes` (which unions granted scopes), so
recall's candidate-generation ACL picks grants up with zero recall changes.
"""
import re
import uuid


class ScopeError(Exception):
    """Scope operation rejected; message safe to surface to the caller."""


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")[:40]
    return s or "scope"


def create_scope(conn, tenant_id: str, owner_user_id: str, name: str) -> dict:
    name = (name or "").strip()
    if not name:
        raise ScopeError("scope name is required")
    scope_id = f"s:{_slug(name)}-{uuid.uuid4().hex[:6]}"
    conn.execute(
        "insert into scopes(scope_id, tenant_id, name, owner_user_id) "
        "values(%s,%s,%s,%s)", (scope_id, tenant_id, name, owner_user_id))
    return {"scope_id": scope_id, "name": name, "owner_user_id": owner_user_id}


def _scope_row(conn, scope_id: str):
    return conn.execute(
        "select owner_user_id, tenant_id, name from scopes where scope_id=%s",
        (scope_id,)).fetchone()


def can_write(conn, scope_id: str, user_id: str) -> bool:
    row = _scope_row(conn, scope_id)
    if not row:
        return False
    if row[0] == user_id:
        return True
    g = conn.execute(
        "select role from scope_grants where scope_id=%s and user_id=%s",
        (scope_id, user_id)).fetchone()
    return bool(g and g[0] == "write")


def grant(conn, tenant_id: str, scope_id: str, user_id: str, role: str,
          granted_by: str) -> dict:
    if role not in ("read", "write"):
        raise ScopeError("role must be read|write")
    if not _scope_row(conn, scope_id):
        raise ScopeError("no such scope")
    if not can_write(conn, scope_id, granted_by):
        raise ScopeError("only the owner or a write-granted user may share a scope")
    # Upsert portably across both dialects: replace any existing grant row.
    conn.execute("delete from scope_grants where scope_id=%s and user_id=%s",
                 (scope_id, user_id))
    conn.execute(
        "insert into scope_grants(scope_id, user_id, role, granted_by) "
        "values(%s,%s,%s,%s)", (scope_id, user_id, role, granted_by))
    return {"scope_id": scope_id, "user_id": user_id, "role": role}


def revoke_grant(conn, tenant_id: str, scope_id: str, user_id: str,
                 revoked_by: str) -> None:
    if not can_write(conn, scope_id, revoked_by):
        raise ScopeError("only the owner or a write-granted user may revoke")
    conn.execute("delete from scope_grants where scope_id=%s and user_id=%s",
                 (scope_id, user_id))


def list_scopes(conn, tenant_id: str, user_id: str) -> list[dict]:
    """Scopes the user owns or holds a grant on (their creatable/queryable set)."""
    out = []
    for sid, name, owner in conn.execute(
            "select scope_id, name, owner_user_id from scopes "
            "where tenant_id=%s and owner_user_id=%s order by created_at",
            (tenant_id, user_id)).fetchall():
        out.append({"scope_id": sid, "name": name, "role": "owner"})
    for sid, name, role in conn.execute(
            "select s.scope_id, s.name, g.role from scope_grants g "
            "join scopes s on s.scope_id=g.scope_id "
            "where s.tenant_id=%s and g.user_id=%s order by g.created_at",
            (tenant_id, user_id)).fetchall():
        out.append({"scope_id": sid, "name": name, "role": role})
    return out
