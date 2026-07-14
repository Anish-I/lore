from __future__ import annotations

import hashlib
import os
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any, Iterable


EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)

_NAME_TOKEN = r"(?:[A-Z][a-z]+(?:[-'][A-Z][a-z]+)?)"
_NAME_SEQUENCE_RE = re.compile(rf"\b({_NAME_TOKEN}(?:\s+{_NAME_TOKEN}){{1,2}})\b")
_SINGLE_NAME_RE = re.compile(rf"\b({_NAME_TOKEN})\b")
# Case-insensitive ONLY for the email — a re.I on the whole pattern lets the
# name tokens match lowercase words, capturing "from Dana Whitmore" as a name.
_ANGLE_EMAIL_RE = re.compile(
    rf"(?P<name>{_NAME_TOKEN}(?:\s+{_NAME_TOKEN}){{0,2}})\s*<\s*(?P<email>(?i:{EMAIL_RE.pattern}))\s*>")

_GENERIC_WORDS = {
    "Admin",
    "Agent",
    "Api",
    "App",
    "Assistant",
    "Branch",
    "Bucket",
    "Capture",
    "Claude",
    "Cli",
    "Code",
    "Codex",
    "Config",
    "Context",
    "Database",
    "Email",
    "Feature",
    "File",
    "Github",
    "Hook",
    "Inbox",
    "Index",
    "Invite",
    "Issue",
    "Json",
    "Lore",
    "Meeting",
    "Note",
    "Openai",
    "Postgres",
    "Pull",
    "Query",
    "Readme",
    "Repo",
    "Request",
    "Response",
    "Section",
    "Server",
    "Session",
    "Sqlite",
    "State",
    "Supersession",
    "System",
    "Task",
    "Tenant",
    "Test",
    "Thread",
    "Title",
    "Topic",
    "User",
    "Vault",
    "Window",
    "Workflow",
}

_GENERIC_PHRASES = {
    "Claude Code",
    "Codex Hook",
    "Lore Desktop",
    "Openai Api",
    "Pull Request",
}


def ensure_schema(conn: Any) -> None:
    _execute(
        conn,
        """
        create table if not exists people (
            id text primary key,
            tenant_id text not null,
            name text not null,
            emails text not null default '',
            first_seen timestamptz,
            last_seen timestamptz,
            hidden integer not null default 0
        )
        """,
    )
    _execute(
        conn,
        """
        create table if not exists person_mentions (
            tenant_id text not null,
            person_id text not null,
            note_id text not null,
            scope_id text,
            source_type text not null default 'note',
            evidence text,
            created_at timestamptz,
            unique(tenant_id, person_id, note_id)
        )
        """,
    )
    _commit(conn)


def extract_mentions(conn: Any, tenant_id: str, note_id: str) -> dict[str, int]:
    if os.environ.get("LORE_PEOPLE") == "0":
        return {"people": 0, "mentions": 0}

    ensure_schema(conn)
    note = _load_note(conn, tenant_id, note_id)
    if not note:
        return {"people": 0, "mentions": 0}

    entities = _extract_entities(note["body"], allowed_singles=_tenant_recurrent_singles(conn, tenant_id))
    people_seen = 0
    mentions_seen = 0
    for entity in entities:
        person_id = _upsert_person(
            conn,
            tenant_id=tenant_id,
            name=entity["name"],
            emails=entity["emails"],
            seen_at=note["date"],
        )
        people_seen += 1
        if _insert_mention(
            conn,
            tenant_id=tenant_id,
            person_id=person_id,
            note_id=note_id,
            scope_id=note.get("scope_id"),
            source_type=note.get("source_type") or "note",
            evidence=entity["evidence"],
            created_at=note["date"],
        ):
            mentions_seen += 1
    _commit(conn)
    return {"people": people_seen, "mentions": mentions_seen}


def backfill_people(conn: Any, tenant_id: str | None = None, limit: int = 500) -> dict[str, int]:
    ensure_schema(conn)
    notes = _list_notes(conn, tenant_id=tenant_id, limit=limit)
    stats = {"notes": 0, "people": 0, "mentions": 0}
    for note in notes:
        result = extract_mentions(conn, note["tenant_id"], note["note_id"])
        stats["notes"] += 1
        stats["people"] += result.get("people", 0)
        stats["mentions"] += result.get("mentions", 0)
    return stats


def list_people(conn: Any, tenant_id: str, scopes: str | Iterable[str]) -> list[dict[str, Any]]:
    ensure_schema(conn)
    scope_values = parse_scopes(scopes)
    clause, params = _scope_clause("m.scope_id", scope_values)
    rows = _fetchall(
        conn,
        f"""
        select p.id, p.name, p.emails, m.source_type, count(*) as mention_count, max(m.created_at) as last_seen
        from people p
        join person_mentions m on m.tenant_id = p.tenant_id and m.person_id = p.id
        where p.tenant_id = %s and coalesce(p.hidden, 0) = 0 and {clause}
        group by p.id, p.name, p.emails, m.source_type
        order by max(m.created_at) desc, lower(p.name) asc
        """,
        [tenant_id, *params],
    )

    by_id: dict[str, dict[str, Any]] = {}
    for row in rows:
        item = by_id.setdefault(
            _value(row, "id", 0),
            {
                "id": _value(row, "id", 0),
                "name": _value(row, "name", 1),
                "emails": _split_emails(_value(row, "emails", 2) or ""),
                "mention_count": 0,
                "last_seen": None,
                "sources": {},
            },
        )
        source = _value(row, "source_type", 3) or "note"
        count = int(_value(row, "mention_count", 4) or 0)
        last_seen = _value(row, "last_seen", 5)
        item["mention_count"] += count
        item["sources"][source] = item["sources"].get(source, 0) + count
        if last_seen and (item["last_seen"] is None or str(last_seen) > str(item["last_seen"])):
            item["last_seen"] = last_seen

    return sorted(by_id.values(), key=lambda p: (str(p["last_seen"] or ""), p["name"].lower()), reverse=True)


def person_detail(conn: Any, tenant_id: str, scopes: str | Iterable[str], person_id: str) -> dict[str, Any] | None:
    ensure_schema(conn)
    scope_values = parse_scopes(scopes)
    clause, params = _scope_clause("m.scope_id", scope_values)
    person_rows = _fetchall(
        conn,
        f"""
        select p.id, p.name, p.emails, count(m.note_id) as mention_count, max(m.created_at) as last_seen
        from people p
        join person_mentions m on m.tenant_id = p.tenant_id and m.person_id = p.id
        where p.tenant_id = %s and p.id = %s and coalesce(p.hidden, 0) = 0 and {clause}
        group by p.id, p.name, p.emails
        """,
        [tenant_id, person_id, *params],
    )
    if not person_rows:
        return None

    interactions = _fetchall(
        conn,
        f"""
        select m.note_id, n.title, m.source_type, m.created_at, m.evidence
        from person_mentions m
        left join notes n on n.tenant_id = m.tenant_id and n.id = m.note_id
        where m.tenant_id = %s and m.person_id = %s and {clause}
        order by m.created_at desc
        """,
        [tenant_id, person_id, *params],
    )

    row = person_rows[0]
    return {
        "person": {
            "id": _value(row, "id", 0),
            "name": _value(row, "name", 1),
            "emails": _split_emails(_value(row, "emails", 2) or ""),
            "mention_count": int(_value(row, "mention_count", 3) or 0),
            "last_seen": _value(row, "last_seen", 4),
        },
        "interactions": [
            {
                "note_id": _value(item, "note_id", 0),
                "title": _value(item, "title", 1) or "Untitled",
                "source_type": _value(item, "source_type", 2) or "note",
                "date": _value(item, "created_at", 3),
                "evidence": _value(item, "evidence", 4) or "",
            }
            for item in interactions
        ],
    }


def merge_people(conn: Any, tenant_id: str, keep_id: str, merge_id: str) -> dict[str, Any]:
    ensure_schema(conn)
    if keep_id == merge_id:
        return {"ok": True, "person_id": keep_id}

    keep = _load_person(conn, tenant_id, keep_id)
    merge = _load_person(conn, tenant_id, merge_id)
    if not keep or not merge:
        return {"ok": False, "error": "person_not_found"}

    rows = _fetchall(
        conn,
        """
        select note_id, scope_id, source_type, evidence, created_at
        from person_mentions
        where tenant_id = %s and person_id = %s
        """,
        [tenant_id, merge_id],
    )
    for row in rows:
        _insert_mention(
            conn,
            tenant_id=tenant_id,
            person_id=keep_id,
            note_id=_value(row, "note_id", 0),
            scope_id=_value(row, "scope_id", 1),
            source_type=_value(row, "source_type", 2) or "note",
            evidence=_value(row, "evidence", 3) or "",
            created_at=_value(row, "created_at", 4) or _now(),
        )

    emails = _join_emails([*_split_emails(keep.get("emails") or ""), *_split_emails(merge.get("emails") or "")])
    last_seen = max(str(keep.get("last_seen") or ""), str(merge.get("last_seen") or "")) or None
    first_seen_values = [v for v in [keep.get("first_seen"), merge.get("first_seen")] if v]
    first_seen = min(map(str, first_seen_values)) if first_seen_values else None
    _execute(
        conn,
        "update people set emails = %s, first_seen = %s, last_seen = %s where tenant_id = %s and id = %s",
        [emails, first_seen, last_seen, tenant_id, keep_id],
    )
    _execute(conn, "delete from person_mentions where tenant_id = %s and person_id = %s", [tenant_id, merge_id])
    _execute(conn, "delete from people where tenant_id = %s and id = %s", [tenant_id, merge_id])
    _commit(conn)
    return {"ok": True, "person_id": keep_id}


def hide_person(conn: Any, tenant_id: str, person_id: str) -> dict[str, Any]:
    ensure_schema(conn)
    _execute(conn, "update people set hidden = 1 where tenant_id = %s and id = %s", [tenant_id, person_id])
    _commit(conn)
    return {"ok": True, "person_id": person_id}


def parse_scopes(scopes: str | Iterable[str]) -> list[str]:
    if isinstance(scopes, str):
        values = [part.strip() for part in scopes.split(",")]
    else:
        values = [str(part).strip() for part in scopes]
    values = [value for value in values if value]
    if not values:
        raise ValueError("scopes is required")
    return values


def _extract_entities(body: str, allowed_singles: set[str] | None = None) -> list[dict[str, Any]]:
    text = _strip_code_blocks(body or "")
    allowed_singles = allowed_singles or set()
    lines = text.splitlines() or [text]
    by_key: dict[str, dict[str, Any]] = {}
    multi_spans = [(match.start(), match.end()) for match in _NAME_SEQUENCE_RE.finditer(text)]
    single_counts = Counter(
        match.group(1)
        for match in _SINGLE_NAME_RE.finditer(text)
        if _valid_single_name(text, match) and not _inside_spans(match, multi_spans)
    )

    def add(name: str, emails: Iterable[str], evidence: str) -> None:
        clean_name = _clean_name(name)
        clean_emails = sorted({email.lower() for email in emails if email})
        if not clean_name and not clean_emails:
            return
        if clean_name and not _valid_name(clean_name):
            return
        display_name = clean_name or _display_name_from_email(clean_emails[0])
        key = display_name.casefold()
        if clean_emails:
            key = clean_emails[0]
        entity = by_key.setdefault(key, {"name": display_name, "emails": set(), "evidence": _evidence(evidence)})
        entity["emails"].update(clean_emails)
        if clean_name and "@" in entity["name"]:
            entity["name"] = clean_name

    for line in lines:
        for match in _ANGLE_EMAIL_RE.finditer(line):
            add(match.group("name"), [match.group("email")], line)

        emails = [email.lower() for email in EMAIL_RE.findall(line)]
        if emails:
            for email in emails:
                name = _nearest_name_for_email(line, email)
                add(name or "", [email], line)

        for match in _NAME_SEQUENCE_RE.finditer(line):
            name = match.group(1)
            if EMAIL_RE.search(name):
                continue
            add(name, [], line)

    for match in _SINGLE_NAME_RE.finditer(text):
        name = match.group(1)
        if (single_counts[name] >= 3 or name in allowed_singles) and _valid_single_name(text, match) and not _inside_spans(match, multi_spans):
            add(name, [], _line_for_offset(text, match.start()))

    email_bound_names = {entity["name"].casefold() for entity in by_key.values() if entity["emails"]}
    return [
        {"name": entity["name"], "emails": sorted(entity["emails"]), "evidence": entity["evidence"]}
        for entity in by_key.values()
        if entity["emails"] or entity["name"].casefold() not in email_bound_names
    ]


def _inside_spans(match: re.Match[str], spans: list[tuple[int, int]]) -> bool:
    return any(start <= match.start() and match.end() <= end for start, end in spans)


def _tenant_recurrent_singles(conn: Any, tenant_id: str, limit: int = 1000) -> set[str]:
    try:
        rows = _fetchall(conn, "select body from notes where tenant_id = %s limit %s", [tenant_id, limit])
    except Exception:
        return set()
    counts: Counter[str] = Counter()
    for row in rows:
        text = _strip_code_blocks(_value(row, "body", 0) or "")
        spans = [(match.start(), match.end()) for match in _NAME_SEQUENCE_RE.finditer(text)]
        for match in _SINGLE_NAME_RE.finditer(text):
            if _valid_single_name(text, match) and not _inside_spans(match, spans):
                counts[match.group(1)] += 1
    return {name for name, count in counts.items() if count >= 3}


def _nearest_name_for_email(line: str, email: str) -> str | None:
    idx = line.lower().find(email.lower())
    if idx < 0:
        return None
    before = line[max(0, idx - 80) : idx]
    match = list(_NAME_SEQUENCE_RE.finditer(before))
    if match:
        return match[-1].group(1)
    single = list(_SINGLE_NAME_RE.finditer(before))
    if single:
        return single[-1].group(1)
    return None


def _strip_code_blocks(text: str) -> str:
    stripped: list[str] = []
    in_fence = False
    for line in text.splitlines():
        if line.strip().startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if line.startswith("    ") or line.startswith("\t"):
            stripped.append("")
            continue
        stripped.append(line)
    return "\n".join(stripped)


def _clean_name(name: str) -> str:
    cleaned = re.sub(r"\s+", " ", (name or "").strip(" \t\r\n:;,.()[]{}<>\"'"))
    return cleaned


def _valid_name(name: str) -> bool:
    if not name:
        return False
    words = name.split()
    if len(words) > 3:
        return False
    if name.title() in _GENERIC_PHRASES:
        return False
    if any(word in _GENERIC_WORDS for word in words):
        return False
    return True


def _valid_single_name(text: str, match: re.Match[str]) -> bool:
    name = match.group(1)
    if name in _GENERIC_WORDS:
        return False
    prefix = text[max(0, match.start() - 3) : match.start()]
    if match.start() == 0 or re.search(r"(^|[.!?]\s)$", prefix):
        return False
    return True


def _evidence(line: str) -> str:
    return re.sub(r"\s+", " ", line.strip())[:240]


def _line_for_offset(text: str, offset: int) -> str:
    start = text.rfind("\n", 0, offset) + 1
    end = text.find("\n", offset)
    if end < 0:
        end = len(text)
    return text[start:end]


def _upsert_person(conn: Any, *, tenant_id: str, name: str, emails: list[str], seen_at: str) -> str:
    existing = None
    for email in emails:
        existing = _find_person_by_email(conn, tenant_id, email)
        if existing:
            break
    if not existing and name:
        # A name-keyed person may already exist (seen before any email was
        # known) — reuse it rather than splitting into an email-keyed twin.
        existing = _load_person(conn, tenant_id, _person_id(tenant_id, name.casefold()))
    person_id = existing["id"] if existing else _person_id(tenant_id, emails[0] if emails else name.casefold())
    current_emails = _split_emails(existing.get("emails") or "") if existing else []
    merged_emails = _join_emails([*current_emails, *emails])
    current_name = existing.get("name") if existing else None
    display_name = name if current_name is None or "@" in current_name else current_name
    _execute(
        conn,
        """
        insert into people (id, tenant_id, name, emails, first_seen, last_seen, hidden)
        values (%s, %s, %s, %s, %s, %s, 0)
        on conflict(id) do update set
            name = excluded.name,
            emails = excluded.emails,
            first_seen = coalesce(people.first_seen, excluded.first_seen),
            last_seen = excluded.last_seen
        """,
        [person_id, tenant_id, display_name, merged_emails, seen_at, seen_at],
    )
    return person_id


def _insert_mention(
    conn: Any,
    *,
    tenant_id: str,
    person_id: str,
    note_id: str,
    scope_id: str | None,
    source_type: str,
    evidence: str,
    created_at: str,
) -> bool:
    cur = _execute(
        conn,
        """
        insert into person_mentions (tenant_id, person_id, note_id, scope_id, source_type, evidence, created_at)
        values (%s, %s, %s, %s, %s, %s, %s)
        on conflict(tenant_id, person_id, note_id) do update set
            scope_id = excluded.scope_id,
            source_type = excluded.source_type,
            evidence = excluded.evidence,
            created_at = excluded.created_at
        """,
        [tenant_id, person_id, note_id, scope_id, source_type, evidence, created_at],
    )
    return bool(getattr(cur, "rowcount", 1))


def _load_person(conn: Any, tenant_id: str, person_id: str) -> dict[str, Any] | None:
    rows = _fetchall(
        conn,
        "select id, name, emails, first_seen, last_seen from people where tenant_id = %s and id = %s",
        [tenant_id, person_id],
    )
    if not rows:
        return None
    row = rows[0]
    return {
        "id": _value(row, "id", 0),
        "name": _value(row, "name", 1),
        "emails": _value(row, "emails", 2) or "",
        "first_seen": _value(row, "first_seen", 3),
        "last_seen": _value(row, "last_seen", 4),
    }


def _find_person_by_email(conn: Any, tenant_id: str, email: str) -> dict[str, Any] | None:
    rows = _fetchall(
        conn,
        "select id, name, emails, first_seen, last_seen from people where tenant_id = %s",
        [tenant_id],
    )
    email = email.lower()
    for row in rows:
        emails = _split_emails(_value(row, "emails", 2) or "")
        if email in emails:
            return {
                "id": _value(row, "id", 0),
                "name": _value(row, "name", 1),
                "emails": _value(row, "emails", 2) or "",
                "first_seen": _value(row, "first_seen", 3),
                "last_seen": _value(row, "last_seen", 4),
            }
    return None


# The notes schema is known (db.py bootstrap): id, tenant_id, scope_id, title,
# source_type, body, created_at, updated_at — no introspection needed.

def _load_note(conn: Any, tenant_id: str, note_id: str) -> dict[str, Any] | None:
    rows = _fetchall(
        conn,
        """select id, body, title, source_type, scope_id,
                  coalesce(created_at, updated_at)
           from notes where tenant_id = %s and id = %s""",
        [tenant_id, note_id],
    )
    if not rows:
        return None
    row = rows[0]
    return {
        "note_id": row[0],
        "body": row[1] or "",
        "title": row[2] or "",
        "source_type": row[3] or "note",
        "scope_id": row[4],
        "date": str(row[5]) if row[5] else _now(),
    }


def _list_notes(conn: Any, tenant_id: str | None, limit: int) -> list[dict[str, str]]:
    if tenant_id:
        rows = _fetchall(
            conn,
            "select tenant_id, id from notes where tenant_id = %s"
            " order by coalesce(created_at, updated_at) desc limit %s",
            [tenant_id, limit],
        )
    else:
        rows = _fetchall(
            conn,
            "select tenant_id, id from notes order by coalesce(created_at, updated_at) desc limit %s",
            [limit],
        )
    return [{"tenant_id": r[0], "note_id": r[1]} for r in rows]


def _scope_clause(column: str, values: list[str]) -> tuple[str, list[str]]:
    try:
        from .sqlutil import in_clause

        result = in_clause(column, values)
        if isinstance(result, tuple) and len(result) == 2:
            return result[0], list(result[1])
    except Exception:
        pass
    return f"{column} in ({', '.join(['%s'] * len(values))})", values


def _person_id(tenant_id: str, key: str) -> str:
    digest = hashlib.sha1(f"{tenant_id}:{key.casefold()}".encode("utf-8")).hexdigest()[:20]
    return f"person_{digest}"


def _display_name_from_email(email: str) -> str:
    local = email.split("@", 1)[0]
    return local.replace(".", " ").replace("_", " ").replace("-", " ").title() or email


def _split_emails(value: str) -> list[str]:
    return [part for part in value.split(",") if part]


def _join_emails(values: Iterable[str]) -> str:
    return ",".join(sorted({value.lower() for value in values if value}))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fetchall(conn: Any, sql: str, params: Iterable[Any] | None = None) -> list[Any]:
    cursor = _execute(conn, sql, params)
    return list(cursor.fetchall())


def _execute(conn: Any, sql: str, params: Iterable[Any] | None = None) -> Any:
    values = list(params or [])
    try:
        return conn.execute(sql, values)
    except Exception:
        if "%s" not in sql:
            raise
        return conn.execute(sql.replace("%s", "?"), values)


def _value(row: Any, key: str, index: int) -> Any:
    try:
        return row[key]
    except Exception:
        return row[index]


def _commit(conn: Any) -> None:
    try:
        conn.commit()
    except Exception:
        pass
