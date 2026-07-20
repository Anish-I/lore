"""Versioned, user-controlled personal memory documents."""

import hashlib
import uuid

from . import qdrant_store
from .index import index_document
from .redact import redact
from .sqlutil import in_clause


BUDGETS = {"memory": 2200, "user": 1375}


class PersonalMemoryError(ValueError):
    pass


def _iso(value):
    return value.isoformat() if hasattr(value, "isoformat") else (str(value) if value else None)


def _validate_kind(kind: str) -> str:
    kind = (kind or "").strip().lower()
    if kind not in BUDGETS:
        raise PersonalMemoryError("kind must be memory or user")
    return kind


def note_id_for(tenant: str, owner: str, scope: str, kind: str) -> str:
    raw = "\0".join((tenant, owner, scope, _validate_kind(kind)))
    return f"learn-memory:{kind}:{hashlib.sha256(raw.encode()).hexdigest()[:20]}"


def _version(conn, note_id: str) -> int:
    row = conn.execute(
        "select coalesce(max(version),0) from memory_versions where note_id=%s",
        (note_id,),
    ).fetchone()
    return int(row[0] or 0) + 1


def replace_document(
    conn, *, tenant: str, owner: str, scope: str, kind: str, text: str,
    embedder, sparse_embedder=None, origin: str = "user", origin_session: str = None,
) -> dict:
    kind = _validate_kind(kind)
    safe = redact(text or "").strip()
    if not safe:
        raise PersonalMemoryError("text is required")
    if len(safe) > BUDGETS[kind]:
        raise PersonalMemoryError(
            f"{kind} document exceeds its {BUDGETS[kind]} character budget"
        )
    note_id = note_id_for(tenant, owner, scope, kind)
    version = _version(conn, note_id)
    title = "What Lore remembers" if kind == "memory" else "About you"
    chunks = index_document(
        source_id=note_id,
        title=title,
        text=safe,
        scope_id=scope,
        owner_id=owner,
        tenant_id=tenant,
        embedder=embedder,
        sparse_embedder=sparse_embedder,
        conn=conn,
        source_type="learn-memory",
    )
    body_sha = hashlib.sha256(safe.encode()).hexdigest()
    conn.execute(
        """insert into memory_versions(
               id,note_id,tenant_id,owner_id,scope_id,kind,version,body,
               body_sha256,origin,origin_session)
           values(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (str(uuid.uuid4()), note_id, tenant, owner, scope, kind, version, safe,
         body_sha, origin, origin_session),
    )
    return {
        "ok": True,
        "note_id": note_id,
        "kind": kind,
        "text": safe,
        "version": version,
        "budget": BUDGETS[kind],
        "chunks": chunks,
    }


def list_documents(conn, tenant: str, owner: str, scopes) -> list[dict]:
    scope_pred, params = in_clause("n.scope_id", scopes)
    rows = conn.execute(
        f"""select n.id,n.scope_id,n.body,n.updated_at,v.kind,v.version
            from notes n
            join memory_versions v on v.note_id=n.id
            where n.tenant_id=%s and n.owner_id=%s and n.source_type='learn-memory'
              and {scope_pred}
              and v.version=(select max(v2.version) from memory_versions v2
                             where v2.note_id=n.id)
            order by case v.kind when 'user' then 0 else 1 end""",
        (tenant, owner, *params),
    ).fetchall()
    return [{
        "note_id": r[0], "scope": r[1], "text": r[2],
        "updated_at": _iso(r[3]),
        "kind": r[4], "version": int(r[5]), "budget": BUDGETS[r[4]],
    } for r in rows]


def history(conn, *, tenant: str, owner: str, scope: str, kind: str) -> list[dict]:
    note_id = note_id_for(tenant, owner, scope, kind)
    rows = conn.execute(
        """select version,body,body_sha256,origin,origin_session,created_at
           from memory_versions
           where note_id=%s and tenant_id=%s and owner_id=%s and scope_id=%s
           order by version desc""",
        (note_id, tenant, owner, scope),
    ).fetchall()
    return [{
        "version": int(r[0]), "text": r[1], "sha256": r[2], "origin": r[3],
        "origin_session": r[4], "created_at": _iso(r[5]),
    } for r in rows]


def export_bundle(conn, *, tenant: str, owner: str, scope: str) -> dict:
    """Return the complete user-owned personal-memory record for one scope."""
    documents = []
    for current in list_documents(conn, tenant, owner, [scope]):
        kind = current["kind"]
        documents.append({
            "kind": kind,
            "current": current,
            "history": history(
                conn, tenant=tenant, owner=owner, scope=scope, kind=kind,
            ),
        })
    return {
        "schema": "lore-personal-memory/v1",
        "identity": {"tenant": tenant, "owner": owner, "scope": scope},
        "documents": documents,
    }


def rollback_document(
    conn, *, tenant: str, owner: str, scope: str, kind: str, version: int,
    embedder, sparse_embedder=None,
) -> dict:
    note_id = note_id_for(tenant, owner, scope, kind)
    row = conn.execute(
        """select body from memory_versions
           where note_id=%s and tenant_id=%s and owner_id=%s and scope_id=%s
             and version=%s""",
        (note_id, tenant, owner, scope, int(version)),
    ).fetchone()
    if not row:
        raise PersonalMemoryError("memory version not found")
    return replace_document(
        conn, tenant=tenant, owner=owner, scope=scope, kind=kind, text=row[0],
        embedder=embedder, sparse_embedder=sparse_embedder,
        origin="rollback", origin_session=f"version:{version}",
    )


def delete_document(conn, *, tenant: str, owner: str, scope: str, kind: str) -> bool:
    note_id = note_id_for(tenant, owner, scope, kind)
    row = conn.execute(
        "select 1 from notes where id=%s and tenant_id=%s and owner_id=%s and scope_id=%s",
        (note_id, tenant, owner, scope),
    ).fetchone()
    if not row:
        return False
    qdrant_store.delete_note(note_id)
    conn.execute("delete from notes where id=%s", (note_id,))
    return True
