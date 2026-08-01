"""Bearer API keys — the dev-friendly identity for the headless API service.

A key is `lore_sk_<43 urlsafe chars>`; only its sha256 hex ever touches the
database. A verified key resolves to a (user_id, tenant_id, role) principal and
rides the SAME server-side ACL chain as Google-JWT users (private_scope_id,
tenancy.authorize_scopes) — keys grant identity, never scope width.

Bootstrap: the first key is created on-box (CLI `keys-create`); via HTTP, key
creation requires an admin-role key (api.py enforces).
"""
import hashlib
import secrets
import uuid

_PREFIX = "lore_sk_"


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def create_key(conn, tenant_id: str, user_id: str, label: str = "",
               role: str = "member", profile: str = None) -> dict:
    """Mint a key. Returns {id, key, label, role, profile} — `key` is shown ONCE.

    `profile` names the retrieval profile this key's requests default to, so an
    app carries its tuning in its identity instead of on every call."""
    if role not in ("member", "admin"):
        raise ValueError("role must be member|admin")
    raw = _PREFIX + secrets.token_urlsafe(32)
    kid = "ak-" + uuid.uuid4().hex[:12]
    conn.execute(
        "insert into api_keys(id, tenant_id, user_id, key_hash, label, role, profile) "
        "values(%s,%s,%s,%s,%s,%s,%s)",
        (kid, tenant_id, user_id, _hash(raw), label, role, profile or None))
    return {"id": kid, "key": raw, "label": label, "role": role, "profile": profile}


def verify_key(conn, raw: str):
    """Resolve a presented key. Returns {id, user_id, tenant_id, role, profile}
    or None. Touches last_used on success. Revoked/unknown/malformed → None."""
    if not raw or not raw.startswith(_PREFIX):
        return None
    row = conn.execute(
        "select id, user_id, tenant_id, role, profile from api_keys "
        "where key_hash=%s and revoked=0", (_hash(raw),)).fetchone()
    if not row:
        return None
    conn.execute("update api_keys set last_used=now() where id=%s", (row[0],))
    return {"id": row[0], "user_id": row[1], "tenant_id": row[2], "role": row[3],
            "profile": row[4]}


def revoke_key(conn, tenant_id: str, key_id: str) -> bool:
    cur = conn.execute(
        "update api_keys set revoked=1 where tenant_id=%s and id=%s",
        (tenant_id, key_id))
    return bool(getattr(cur, "rowcount", 1))


def list_keys(conn, tenant_id: str) -> list[dict]:
    """Key metadata for management UIs — never exposes hashes."""
    rows = conn.execute(
        "select id, user_id, label, role, created_at, last_used, revoked "
        "from api_keys where tenant_id=%s order by created_at", (tenant_id,)).fetchall()
    return [{"id": r[0], "user_id": r[1], "label": r[2], "role": r[3],
             "created_at": str(r[4] or ""), "last_used": str(r[5] or ""),
             "revoked": bool(r[6])} for r in rows]
