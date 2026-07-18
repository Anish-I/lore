"""Action-item ("to-do") extraction + lifecycle — the first enterprise people-work wizard.

A work thread (email chain, meeting notes, a doc) goes in; structured to-dos come
out: {assignee, task, due, due_text, source}. Extracted items persist as `pending`
and move to `confirmed` / `dismissed` via the wizard UX (the Test-3 confirm/dismiss flow).

Extraction has two paths:
  * LLM via the provider seam (resolve_llm_call) — constrained to STRICT JSON,
    validated + normalized here. Injectable `llm_call` for tests.
  * a deterministic heuristic fallback (imperative "Name, <verb> ..." asks) so the
    wizard still works with no LLM configured and stays testable under VAULT_FAKE.

Persistence mirrors the notes ACL: a todo carries the scope_id of the thread it
came from, and reads are scope-filtered exactly like /digest and /graph.
"""
import json
import re
import uuid

_THREAD_CHARS = 6000            # cap the thread text sent to the model
_TASK_CHARS = 400

_TODO_COLS = ["id", "assignee", "task", "due", "due_text", "source",
              "source_note_id", "status", "scope_id", "created_at"]

# --- Extraction --------------------------------------------------------------


def _prompt(thread_text: str, me: str = None) -> str:
    me_line = (f'The reader ("you"/"me"/"I") is {me}; resolve first-person asks to them.\n'
               if me else "")
    return (
        "You extract action items (to-dos) from a work thread (email chain, notes).\n"
        f"{me_line}"
        "THREAD:\n"
        f"{thread_text[:_THREAD_CHARS]}\n\n"
        "Return a STRICT JSON array (no prose). One object per explicit ask or "
        "commitment someone must act on. Each object:\n"
        '{"assignee":"<person responsible, full name if the thread gives one>",'
        '"task":"<the action, imperative>",'
        '"due":"<YYYY-MM-DD if a concrete date is determinable, else null>",'
        '"due_text":"<verbatim deadline phrase, or null>",'
        '"source":"<who asked + when, short>"}\n'
        "Include only real action items. If there are none, return []."
    )


def parse_todos(raw: str) -> list:
    """Parse + normalize the model's JSON array. Drops items with no task; coerces
    `due` to an ISO date or None; bounds field lengths."""
    m = re.search(r"\[.*\]", raw or "", re.DOTALL)
    if not m:
        return []
    try:
        items = json.loads(m.group(0))
    except Exception:
        return []
    out = []
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict):
            continue
        task = str(it.get("task", "")).strip()
        if not task:
            continue
        due = it.get("due")
        due = str(due).strip() if due not in (None, "", "null") else None
        if due and not re.match(r"^\d{4}-\d{2}-\d{2}$", due):
            due = None
        dtext = it.get("due_text")
        dtext = str(dtext).strip() if dtext not in (None, "", "null") else None
        source = str(it.get("source", "")).strip()
        assignee = str(it.get("assignee", "")).strip()
        out.append({
            "assignee": assignee or None,
            "task": task[:_TASK_CHARS],
            "due": due,
            "due_text": (dtext[:120] if dtext else None),
            "source": (source[:160] or None),
        })
    return out


_NAME_RE = re.compile(r"([A-Z][a-z]+(?: [A-Z][a-z]+)+)\s*<[^>]+>")
_ASK_RE = re.compile(r"^\s*[-*]?\s*([A-Z][a-z]+)\s*,\s*(.+)$")
_DUE_RE = re.compile(
    r"\bby\s+[^.,;\n]+"                                          # "by Friday EOD"
    r"|\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b"
    r"|\b(?:today|tomorrow|this week)\b"
    r"|\bend of (?:the )?(?:week|month|quarter)\b", re.I)


def _heuristic_todos(thread_text: str, me: str = None) -> list:
    """No-LLM fallback: extract 'Name, <do something>' asks from the top (unquoted)
    message. Resolves first names to full names via the thread's From/To headers."""
    first_to_full = {}
    for full in _NAME_RE.findall(thread_text):
        first_to_full.setdefault(full.split()[0], full)

    top = []
    for line in thread_text.splitlines():
        if line.lstrip().startswith(">"):   # quoted history begins — stop
            break
        top.append(line)

    todos = []
    for line in top:
        if re.match(r"^(From|To|Date|Subject|Cc|Bcc)\s*:", line.strip(), re.I):
            continue
        m = _ASK_RE.match(line)
        if not m:
            continue
        first, rest = m.group(1), m.group(2).strip()
        rest = re.sub(r"^(please|kindly)\s+", "", rest, flags=re.I)
        # first sentence only
        task = re.split(r"(?<=[.!?])\s", rest)[0].rstrip(" .")
        if not task:
            continue
        task = task[0].upper() + task[1:]
        due_m = _DUE_RE.search(rest)
        assignee = first_to_full.get(first, first)
        todos.append({
            "assignee": assignee,
            "task": task[:_TASK_CHARS],
            "due": None,
            "due_text": (due_m.group(0).strip() if due_m else None),
            "source": None,
        })
    return todos


def extract_todos(thread_text: str, llm_call=None, me: str = None, provider: str = None) -> list:
    """Extract to-dos from a thread. Uses the LLM when available (injectable
    `llm_call` for tests; else the configured provider), falling back to the
    deterministic heuristic if no LLM is configured or it yields nothing."""
    if not thread_text or not thread_text.strip():
        return []
    if llm_call is None:
        try:
            from .llm_providers import resolve_llm_call
            llm_call = resolve_llm_call(provider)
        except Exception:
            llm_call = None
    if llm_call is not None:
        try:
            todos = parse_todos(llm_call(_prompt(thread_text, me)))
            if todos:
                return todos
        except Exception:
            pass
    return _heuristic_todos(thread_text, me)


# --- Persistence (scope-aware, dialect-safe %s / now()) ----------------------


def create_todos(conn, tenant: str, items: list, scope: str = None,
                 owner: str = None, source_note_id: str = None) -> list:
    """Insert extracted items as `pending`. Returns them with id + status."""
    created = []
    for it in items:
        tid = "todo:" + uuid.uuid4().hex[:16]
        conn.execute(
            "insert into todos(id,tenant_id,scope_id,owner_id,assignee,task,due,"
            "due_text,source,source_note_id,status) "
            "values(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'pending')",
            (tid, tenant, scope, owner, it.get("assignee"), it.get("task"),
             it.get("due"), it.get("due_text"), it.get("source"), source_note_id))
        created.append({**it, "id": tid, "status": "pending",
                        "scope_id": scope, "source_note_id": source_note_id})
    return created


def list_todos(conn, tenant: str, allowed_scopes: list, status: str = None) -> list:
    """Scope-filtered list. `allowed_scopes` empty → returns nothing (deny)."""
    from .sqlutil import in_clause
    if not allowed_scopes:
        return []
    frag, sp = in_clause("scope_id", allowed_scopes)
    q = ("select id,assignee,task,due,due_text,source,source_note_id,status,scope_id,"
         f"created_at from todos where tenant_id=%s and {frag}")
    params = [tenant, *sp]
    if status:
        q += " and status=%s"
        params.append(status)
    q += " order by created_at desc, id"
    rows = conn.execute(q, params).fetchall()
    return [dict(zip(_TODO_COLS, r)) for r in rows]


def get_todo(conn, tenant: str, todo_id: str):
    """Minimal row for ACL checks: {id, scope_id, status} or None."""
    r = conn.execute(
        "select id,scope_id,status from todos where tenant_id=%s and id=%s",
        (tenant, todo_id)).fetchone()
    return {"id": r[0], "scope_id": r[1], "status": r[2]} if r else None


def set_status(conn, tenant: str, todo_id: str, status: str) -> bool:
    """Move a todo to confirmed/dismissed. Returns True if a row changed."""
    cur = conn.execute(
        "update todos set status=%s, updated_at=now() where tenant_id=%s and id=%s",
        (status, tenant, todo_id))
    return cur.rowcount != 0
