"""People-work wizard: thread -> action items (to-dos), lifecycle + scope ACL.

Extraction is exercised directly (heuristic + injected-LLM). The endpoint tests
monkeypatch extraction to a fixed set so the lifecycle/ACL logic is isolated from
extraction variability (and from whether an LLM provider happens to be configured).
"""
from fastapi.testclient import TestClient

from lore import db
from lore import todos
from lore.api import app

client = TestClient(app)


def _conn():
    c = db.connect()
    db.bootstrap_schema(c)
    return c


# --- Extraction engine (no HTTP) --------------------------------------------

_THREAD = (
    "From: Dana Ruiz <dana.ruiz@nw.example>\n"
    "To: Marcus Bell <marcus.bell@nw.example>, Priya Nair <priya.nair@nw.example>\n"
    "Subject: Q3 budget\n\n"
    "Thanks all. To close this out:\n"
    "- Marcus, send the revised headcount plan by Friday EOD.\n"
    "- Priya, please pause the two open backend reqs until we reforecast.\n\n"
    "> On Tue, someone wrote:\n"
    "> Marcus, ignore this quoted ask.\n"
)


def test_heuristic_extraction_resolves_names_and_ignores_quotes():
    out = todos.extract_todos(_THREAD)   # no llm_call -> deterministic heuristic
    by_assignee = {t["assignee"]: t for t in out}
    assert set(by_assignee) == {"Marcus Bell", "Priya Nair"}   # full names via headers
    assert by_assignee["Marcus Bell"]["task"].startswith("Send the revised headcount plan")
    assert by_assignee["Marcus Bell"]["due_text"] == "by Friday EOD"
    assert by_assignee["Priya Nair"]["task"].startswith("Pause the two open backend reqs")
    assert len(out) == 2                                        # quoted history excluded


def test_extract_uses_injected_llm_and_normalizes():
    raw = ('prose before... '
           '[{"assignee":"Alan Woods","task":"Review records for redactions",'
           '"due":"2026-07-24","due_text":"by July 24","source":"Sofia, 16 Jul"},'
           '{"task":"","due":null}]')
    out = todos.extract_todos("thread text", llm_call=lambda p: raw)
    assert len(out) == 1                        # the empty-task item is dropped
    assert out[0]["assignee"] == "Alan Woods"
    assert out[0]["due"] == "2026-07-24"
    assert out[0]["due_text"] == "by July 24"


def test_parse_todos_coerces_non_iso_due_to_none():
    out = todos.parse_todos('[{"task":"Do X","due":"next Friday","due_text":"next Friday"}]')
    assert out[0]["due"] is None                # non-ISO date dropped
    assert out[0]["due_text"] == "next Friday"  # verbatim phrase kept


def test_extract_empty_thread_returns_nothing():
    assert todos.extract_todos("") == []
    assert todos.extract_todos("   \n  ") == []


# --- Lifecycle + ACL (HTTP) --------------------------------------------------

_FIXED = [
    {"assignee": "Marcus Bell", "task": "Send headcount plan", "due": "2026-07-17",
     "due_text": "Friday", "source": "Dana"},
    {"assignee": "Priya Nair", "task": "Pause reqs", "due": None,
     "due_text": None, "source": "Dana"},
]


def test_todo_lifecycle(monkeypatch):
    monkeypatch.setattr(todos, "extract_todos", lambda *a, **k: [dict(x) for x in _FIXED])
    tenant = "todo-life"

    r = client.post("/wizards/extract-todos",
                    json={"tenant_id": tenant, "text": "thread", "scope": "private", "owner": "me"})
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 2
    ids = [t["id"] for t in body["todos"]]
    assert all(i.startswith("todo:") for i in ids)
    assert all(t["status"] == "pending" for t in body["todos"])

    assert client.get("/todos", params={"tenant": tenant, "scopes": "private"}).json()["count"] == 2

    assert client.post(f"/todos/{ids[0]}/confirm",
                       json={"tenant_id": tenant, "scopes": "private"}).json()["status"] == "confirmed"
    assert client.post(f"/todos/{ids[1]}/dismiss",
                       json={"tenant_id": tenant, "scopes": "private"}).json()["status"] == "dismissed"

    conf = client.get("/todos", params={"tenant": tenant, "scopes": "private", "status": "confirmed"}).json()
    assert conf["count"] == 1 and conf["todos"][0]["id"] == ids[0]
    assert client.get("/todos", params={"tenant": tenant, "scopes": "private", "status": "pending"}).json()["count"] == 0


def test_todo_scope_acl(monkeypatch):
    monkeypatch.setattr(todos, "extract_todos",
                        lambda *a, **k: [{"assignee": "X", "task": "secret task",
                                          "due": None, "due_text": None, "source": None}])
    tenant = "todo-acl"
    r = client.post("/wizards/extract-todos",
                    json={"tenant_id": tenant, "text": "t", "scope": "hr-restricted", "owner": "hr"})
    hid = r.json()["todos"][0]["id"]

    # a "private"-scoped caller cannot see or transition the hr-restricted todo
    assert client.get("/todos", params={"tenant": tenant, "scopes": "private"}).json()["count"] == 0
    assert client.post(f"/todos/{hid}/confirm",
                       json={"tenant_id": tenant, "scopes": "private"}).status_code == 404
    # tenant alone (no scopes, EMPTY_PROFILE) also sees nothing
    assert client.get("/todos", params={"tenant": tenant}).json()["count"] == 0

    # the authorized caller can
    assert client.get("/todos", params={"tenant": tenant, "scopes": "hr-restricted"}).json()["count"] == 1
    assert client.post(f"/todos/{hid}/confirm",
                       json={"tenant_id": tenant, "scopes": "hr-restricted"}).status_code == 200


def test_extract_requires_text_and_scope():
    r = client.post("/wizards/extract-todos", json={"tenant_id": "x", "scope": "private"})
    assert r.status_code == 422                     # neither text nor note_id
    r = client.post("/wizards/extract-todos", json={"tenant_id": "x", "text": "Marcus, do it."})
    assert r.status_code == 422                     # no scope to govern the todo


def test_extract_from_note_inherits_scope(monkeypatch, tmp_path):
    monkeypatch.setattr(todos, "extract_todos",
                        lambda *a, **k: [{"assignee": None, "task": "from note",
                                          "due": None, "due_text": None, "source": None}])
    tenant = "todo-note"
    p = tmp_path / "Threads/chain.md"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("# Chain\n\nMarcus, do the thing.\n", encoding="utf-8")
    r = client.post("/reindex", json={"path": str(p), "owner_id": "me",
                                      "scope_id": "team-x", "tenant_id": tenant})
    assert r.status_code == 200

    conn = _conn()
    row = conn.execute(
        "select id from notes where tenant_id=%s and replace(source_path,'\\','/') like %s",
        (tenant, "%/chain.md")).fetchone()
    note_id = row[0]

    # no scope passed — it must be inherited from the note (team-x)
    r = client.post("/wizards/extract-todos", json={"tenant_id": tenant, "note_id": note_id})
    assert r.status_code == 200 and r.json()["count"] == 1

    assert client.get("/todos", params={"tenant": tenant, "scopes": "private"}).json()["count"] == 0
    got = client.get("/todos", params={"tenant": tenant, "scopes": "team-x"}).json()
    assert got["count"] == 1
    assert got["todos"][0]["source_note_id"] == note_id
    assert got["todos"][0]["scope_id"] == "team-x"
