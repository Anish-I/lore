"""Deterministic browse and scroll helpers for captured agent sessions."""

from .sqlutil import in_clause


SOURCE_TYPES = ("claude-session", "codex-session", "claude-history")


def _iso(value):
    return value.isoformat() if hasattr(value, "isoformat") else (str(value) if value else None)


def browse(conn, *, tenant: str, scopes, limit: int = 20) -> list[dict]:
    scope_pred, scope_params = in_clause("scope_id", scopes)
    type_pred, type_params = in_clause("source_type", SOURCE_TYPES)
    rows = conn.execute(
        f"""select id,title,scope_id,coalesce(created_at,updated_at),body
            from notes where tenant_id=%s and {scope_pred} and {type_pred}
            order by coalesce(updated_at,created_at) desc limit %s""",
        (tenant, *scope_params, *type_params, max(1, min(int(limit), 100))),
    ).fetchall()
    return [{
        "note_id": r[0], "title": r[1], "scope": r[2],
        "updated_at": _iso(r[3]),
        "excerpt": " ".join((r[4] or "").split())[:280],
        "why": "Recent past work",
    } for r in rows]


def scroll(
    conn, *, tenant: str, scopes, note_id: str, offset: int = 0, limit: int = 4000,
) -> dict | None:
    scope_pred, scope_params = in_clause("scope_id", scopes)
    type_pred, type_params = in_clause("source_type", SOURCE_TYPES)
    row = conn.execute(
        f"""select title,scope_id,body from notes
            where id=%s and tenant_id=%s and {scope_pred} and {type_pred}""",
        (note_id, tenant, *scope_params, *type_params),
    ).fetchone()
    if not row:
        return None
    body = row[2] or ""
    offset = max(0, min(int(offset), len(body)))
    limit = max(1, min(int(limit), 12000))
    end = min(len(body), offset + limit)
    return {
        "note_id": note_id, "title": row[0], "scope": row[1],
        "text": body[offset:end], "offset": offset,
        "next_offset": end if end < len(body) else None,
        "total_chars": len(body),
    }
