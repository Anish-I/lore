# Lore Hub — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `lore-hub` repo — a shared multi-municipality webapp (Ellington Clerk Workspace design) with session login, CSRF, strict security headers, and working Search + Ask screens rendered server-side from the lore-arch engine API.

**Architecture:** One server-rendered FastAPI app (Jinja2 autoescape + HTMX fragments, zero inline JS/CSS). A SQLite control plane (`control.db`) maps users → towns → engine endpoints. A typed httpx client calls each town's engine (`/search`, `/ask`); the engine is the only ACL home — the hub never filters results. Spec: `vault-kos/docs/superpowers/specs/2026-08-12-lore-hub-webapp-design.md`.

**Tech Stack:** Python 3.11+, FastAPI, uvicorn, Jinja2, httpx, python-multipart, stdlib sqlite3 + hashlib.scrypt, pytest. HTMX vendored (no npm, no build step).

## Global Constraints

- Repo root: `C:\Users\ivatu\lore-hub` (new git repo, default branch `main`).
- NO npm, NO build step, NO client-side rendering framework (board decision, KAN-9).
- ZERO inline `<script>`/`<style>`/`style=` anywhere — strict CSP must hold (KAN-13). HTMX is self-hosted at `/static/htmx.min.js`; it is the only `<script src>` allowed.
- Jinja2 autoescape ON for all templates — hostile document text must render inert (KAN-24 lesson).
- All dependencies pinned to exact versions (KAN-26 spirit).
- The hub holds NO corpus data and NO ACL logic. Tenant + scopes go to the engine; the engine decides (spec "ACL home" decision).
- Cookie sessions: HttpOnly, SameSite=Lax, Secure (config-off for local http dev only) — KAN-10.
- Every POST carrying a session cookie requires the `X-CSRF` header (constant-time compare) — KAN-12. Cookie-less POSTs (login) are exempt (nothing for CSRF to ride).
- Engine API contract (verified against lore-arch `api.py` 2026-08-12):
  - `POST {base}/search` body `{"query": str, "scopes": [str], "tenant_id": str, "k": int}` → `{"results": [{"note_id","title","scope","heading_path","text","score"}], "scopes_used": [...], "profile": str|null}`
  - `POST {base}/ask` body `{"question": str, "principal_scopes": [str], "tenant_id": str}` → `{"answer": str, "engine": str, "scopes_used": [...], "profile": ..., "citations": [{"note_id","title","heading_path","scope","why"}], "conflicts": [...]}`
  - Optional `Authorization: Bearer lore_sk_*` header — when present the engine derives tenant/scopes from the key (server mode); without it, local mode requires body tenant/scopes.
- Hub dev port: **8180** (engine 8099, old demo BFF 8100).
- Interim confidence mapping until engine KAN-53 ships: citations and no conflicts → GREEN; citations with conflicts → AMBER; no citations → RED (abstain). Encoded in one function, replaced later.

## File Structure

```
lore-hub/
  pyproject.toml            deps (pinned) + pytest/ruff config
  .gitignore                data/, .env, __pycache__, .pytest_cache
  .env.example              documented env vars
  README.md                 quickstart + runbook (Task 9)
  hub/
    __init__.py
    config.py               env-driven settings (db path, cookie secure flag)
    app.py                  create_app() factory; middleware; static mount; module-level app
    control.py              control.db schema + towns/users/sessions helpers
    security.py             security-header + session + CSRF middleware
    engine_client.py        EngineClient + EngineError (typed errors)
    seed.py                 CLI: create town + user for dev
    routes/
      __init__.py
      pages.py              GET /healthz, GET+POST /login, POST /logout, GET /
      fragments.py          POST /search, POST /ask (HTMX partials)
    templates/
      base.html  login.html  workspace.html
      fragments/results.html  fragments/answer.html  fragments/error.html
    static/
      app.css               Ellington palette tokens
      htmx.min.js           vendored (Task 1)
  tests/
    conftest.py             app + fake-engine + logged-in client fixtures
    test_headers.py  test_control.py  test_auth.py  test_csrf.py
    test_engine_client.py  test_pages.py  test_search_fragment.py  test_ask_fragment.py
```

---

### Task 1: Repo scaffold, app factory, security headers

**Files:**
- Create: `pyproject.toml`, `.gitignore`, `.env.example`, `hub/__init__.py`, `hub/config.py`, `hub/app.py`, `hub/security.py` (headers middleware only), `hub/routes/__init__.py`, `hub/routes/pages.py` (healthz only), `hub/static/htmx.min.js` (vendored), `tests/conftest.py` (minimal), `tests/test_headers.py`

**Interfaces:**
- Produces: `create_app(engine_transport=None) -> FastAPI` (hub/app.py); `Settings` dataclass with `db_path: Path`, `cookie_secure: bool`, `session_ttl_hours: int = 8` (hub/config.py); `SECURITY_HEADERS: dict[str, str]` (hub/security.py).

- [ ] **Step 1: Initialize repo and scaffold**

```powershell
mkdir C:\Users\ivatu\lore-hub; cd C:\Users\ivatu\lore-hub
git init -b main
mkdir hub, hub\routes, hub\templates, hub\templates\fragments, hub\static, tests, data
```

`pyproject.toml`:

```toml
[project]
name = "lore-hub"
version = "0.1.0"
description = "Lore Hub - multi-municipality clerk webapp over per-town Lore engines"
requires-python = ">=3.11"
dependencies = [
    "fastapi==0.115.8",
    "uvicorn==0.34.0",
    "jinja2==3.1.5",
    "httpx==0.28.1",
    "python-multipart==0.0.20",
]

[project.optional-dependencies]
dev = ["pytest==8.3.4", "ruff==0.9.6"]

[tool.pytest.ini_options]
testpaths = ["tests"]

[tool.ruff]
line-length = 100
```

`.gitignore`:

```
__pycache__/
.pytest_cache/
data/
.env
*.egg-info/
```

`.env.example`:

```
# Local dev runs on http, so the Secure cookie flag must be off. NEVER in prod.
HUB_COOKIE_SECURE=0
HUB_DB=data/control.db
```

Vendor HTMX (the only allowed script; CSP forbids CDNs):

```powershell
Invoke-WebRequest https://unpkg.com/htmx.org@2.0.4/dist/htmx.min.js -OutFile hub\static\htmx.min.js
python -m venv .venv; .venv\Scripts\pip install -e .[dev]
```

- [ ] **Step 2: Write the failing header test**

`tests/conftest.py`:

```python
import pytest
from fastapi.testclient import TestClient

from hub.app import create_app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("HUB_DB", str(tmp_path / "control.db"))
    monkeypatch.setenv("HUB_COOKIE_SECURE", "1")
    return TestClient(create_app())
```

`tests/test_headers.py`:

```python
def test_security_headers_on_every_response(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    csp = r.headers["Content-Security-Policy"]
    assert "default-src 'self'" in csp
    assert "unsafe-inline" not in csp
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["Referrer-Policy"] == "no-referrer"
    assert "max-age=31536000" in r.headers["Strict-Transport-Security"]
```

- [ ] **Step 3: Run test to verify it fails**

Run: `.venv\Scripts\python -m pytest tests/test_headers.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'hub.app'` (or ImportError).

- [ ] **Step 4: Implement config, headers middleware, app factory**

`hub/config.py`:

```python
import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    db_path: Path
    cookie_secure: bool
    session_ttl_hours: int = 8


def load_settings() -> Settings:
    return Settings(
        db_path=Path(os.environ.get("HUB_DB", "data/control.db")),
        cookie_secure=os.environ.get("HUB_COOKIE_SECURE", "1") == "1",
    )
```

`hub/security.py`:

```python
from starlette.middleware.base import BaseHTTPMiddleware

# Set once here, asserted in CI - not sprinkled per-route (KAN-13).
SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self'; style-src 'self'; "
        "img-src 'self' data:; frame-ancestors 'none'"
    ),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        for k, v in SECURITY_HEADERS.items():
            response.headers[k] = v
        return response
```

`hub/routes/pages.py`:

```python
from fastapi import APIRouter

router = APIRouter()


@router.get("/healthz")
def healthz():
    return {"ok": True}
```

`hub/app.py`:

```python
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from hub.config import load_settings
from hub.routes import pages
from hub.security import SecurityHeadersMiddleware

HERE = Path(__file__).parent


def create_app(engine_transport=None) -> FastAPI:
    """engine_transport: httpx transport override so tests fake the engine."""
    settings = load_settings()
    app = FastAPI(title="Lore Hub")
    app.state.settings = settings
    app.state.engine_transport = engine_transport
    app.add_middleware(SecurityHeadersMiddleware)
    app.mount("/static", StaticFiles(directory=HERE / "static"), name="static")
    app.include_router(pages.router)
    return app


app = create_app()
```

`hub/__init__.py` and `hub/routes/__init__.py`: empty files.

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv\Scripts\python -m pytest tests/test_headers.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: scaffold lore-hub - app factory, strict security headers, vendored htmx"
```

---

### Task 2: Control plane — towns, users, password hashing

**Files:**
- Create: `hub/control.py`, `tests/test_control.py`

**Interfaces:**
- Consumes: `Settings.db_path` from Task 1.
- Produces (hub/control.py): `connect(db_path) -> sqlite3.Connection` (runs schema); `create_town(conn, slug, name, engine_url, tenant_id, key_ref=None) -> str`; `get_town(conn, town_id) -> dict|None` (keys: id, slug, name, engine_url, tenant_id, key_ref); `create_user(conn, username, password, town_id, scopes: list[str]) -> str`; `verify_user(conn, username, password) -> dict|None` (keys: id, username, town_id, scopes:list).

- [ ] **Step 1: Write the failing tests**

`tests/test_control.py`:

```python
import sqlite3

import pytest

from hub import control


@pytest.fixture()
def conn(tmp_path):
    return control.connect(tmp_path / "control.db")


def test_create_and_get_town(conn):
    tid = control.create_town(conn, "ellington", "Town of Ellington",
                              "http://127.0.0.1:8099", "ellington")
    town = control.get_town(conn, tid)
    assert town["slug"] == "ellington"
    assert town["engine_url"] == "http://127.0.0.1:8099"
    assert town["key_ref"] is None


def test_user_password_roundtrip(conn):
    tid = control.create_town(conn, "e", "E", "http://x", "e")
    control.create_user(conn, "donna", "correct horse", tid, ["clerk", "public"])
    ok = control.verify_user(conn, "donna", "correct horse")
    assert ok["username"] == "donna"
    assert ok["scopes"] == ["clerk", "public"]
    assert control.verify_user(conn, "donna", "wrong") is None
    assert control.verify_user(conn, "nobody", "x") is None


def test_password_not_stored_plaintext(conn):
    tid = control.create_town(conn, "e", "E", "http://x", "e")
    control.create_user(conn, "donna", "hunter2secret", tid, ["clerk"])
    raw = sqlite3.connect(conn.execute("pragma database_list").fetchone()[2])
    stored = raw.execute("select password from users").fetchone()[0]
    assert "hunter2secret" not in stored
    assert stored.startswith("scrypt$")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv\Scripts\python -m pytest tests/test_control.py -v`
Expected: FAIL with `AttributeError`/`ImportError` (control module missing).

- [ ] **Step 3: Implement control.py**

```python
"""Control plane: towns, users, sessions. Holds routing + identity - NEVER corpus data."""
import hashlib
import json
import secrets
import sqlite3
import uuid
from pathlib import Path

SCHEMA = """
create table if not exists towns(
  id text primary key, slug text unique not null, name text not null,
  engine_url text not null, tenant_id text not null, key_ref text);
create table if not exists users(
  id text primary key, username text unique not null, password text not null,
  town_id text not null references towns(id), scopes text not null);
create table if not exists sessions(
  sid_hash text primary key, user_id text not null references users(id),
  csrf text not null, created integer not null, expires integer not null,
  revoked integer not null default 0);
"""


def connect(db_path) -> sqlite3.Connection:
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.executescript(SCHEMA)
    return conn


def _hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${digest.hex()}"


def _check_password(password: str, stored: str) -> bool:
    try:
        _, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1)
    return secrets.compare_digest(digest.hex(), digest_hex)


def create_town(conn, slug, name, engine_url, tenant_id, key_ref=None) -> str:
    tid = "tw-" + uuid.uuid4().hex[:12]
    conn.execute("insert into towns values(?,?,?,?,?,?)",
                 (tid, slug, name, engine_url, tenant_id, key_ref))
    conn.commit()
    return tid


def get_town(conn, town_id):
    r = conn.execute("select id, slug, name, engine_url, tenant_id, key_ref "
                     "from towns where id=?", (town_id,)).fetchone()
    if not r:
        return None
    return dict(zip(["id", "slug", "name", "engine_url", "tenant_id", "key_ref"], r))


def create_user(conn, username, password, town_id, scopes) -> str:
    uid = "u-" + uuid.uuid4().hex[:12]
    conn.execute("insert into users values(?,?,?,?,?)",
                 (uid, username, _hash_password(password), town_id, json.dumps(scopes)))
    conn.commit()
    return uid


def verify_user(conn, username, password):
    r = conn.execute("select id, username, password, town_id, scopes "
                     "from users where username=?", (username,)).fetchone()
    if not r or not _check_password(password, r[2]):
        return None
    return {"id": r[0], "username": r[1], "town_id": r[3], "scopes": json.loads(r[4])}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv\Scripts\python -m pytest tests/test_control.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add hub/control.py tests/test_control.py
git commit -m "feat: control.db - towns, users, scrypt password hashing"
```

---

### Task 3: Sessions, login/logout, cookie flags (KAN-10)

**Files:**
- Create: `hub/templates/base.html`, `hub/templates/login.html`, `hub/static/app.css` (minimal tokens now, full design Task 6), `tests/test_auth.py`
- Modify: `hub/control.py` (session helpers), `hub/security.py` (session middleware), `hub/app.py` (templates + conn wiring), `hub/routes/pages.py` (login/logout), `tests/conftest.py` (seeded fixture)

**Interfaces:**
- Consumes: `verify_user`, `connect` (Task 2); `Settings` (Task 1).
- Produces (hub/control.py): `create_session(conn, user_id, ttl_hours) -> tuple[str, str]` returning `(sid, csrf)`; `get_session(conn, sid) -> dict|None` (keys: user_id, csrf) — expired/revoked → None; `revoke_session(conn, sid) -> None`.
- Produces (hub/security.py): `SessionMiddleware` setting `request.state.principal` to `{user, town, csrf}` (user dict from verify_user shape + town dict from get_town) or `None`. Cookie name: `hub_sid`.
- Produces (hub/app.py): `app.state.conn` (control.db connection), `templates: Jinja2Templates` module attr.

- [ ] **Step 1: Write the failing tests**

`tests/conftest.py` — replace with:

```python
import pytest
from fastapi.testclient import TestClient

from hub import control
from hub.app import create_app


@pytest.fixture()
def app_and_db(tmp_path, monkeypatch):
    monkeypatch.setenv("HUB_DB", str(tmp_path / "control.db"))
    monkeypatch.setenv("HUB_COOKIE_SECURE", "1")
    app = create_app()
    conn = app.state.conn
    town_id = control.create_town(conn, "ellington", "Town of Ellington",
                                  "http://engine.test", "ellington")
    control.create_user(conn, "donna", "pw123456", town_id, ["clerk", "public"])
    return app, conn


@pytest.fixture()
def client(app_and_db):
    app, _ = app_and_db
    return TestClient(app)


@pytest.fixture()
def logged_in(client):
    r = client.post("/login", data={"username": "donna", "password": "pw123456"},
                    follow_redirects=False)
    assert r.status_code == 303
    return client
```

`tests/test_auth.py`:

```python
def test_login_sets_hardened_cookie(client):
    r = client.post("/login", data={"username": "donna", "password": "pw123456"},
                    follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/"
    cookie = r.headers["set-cookie"]
    assert "hub_sid=" in cookie and "HttpOnly" in cookie
    assert "SameSite=lax" in cookie.lower().replace("samesite=lax", "SameSite=lax")
    assert "Secure" in cookie


def test_bad_password_rejected(client):
    r = client.post("/login", data={"username": "donna", "password": "nope"},
                    follow_redirects=False)
    assert r.status_code == 200 and "try again" in r.text.lower()
    assert "hub_sid" not in r.headers.get("set-cookie", "")


def test_logout_revokes_session_immediately(logged_in):
    csrf = logged_in.get("/").text  # workspace page carries the token (Task 6 asserts how)
    home = logged_in.get("/", follow_redirects=False)
    assert home.status_code == 200
    token = logged_in.cookies.get("hub_sid")
    r = logged_in.post("/logout", headers={"X-CSRF": _extract_csrf(csrf)},
                       follow_redirects=False)
    assert r.status_code == 303
    # old sid must be dead server-side even if replayed
    logged_in.cookies.set("hub_sid", token)
    again = logged_in.get("/", follow_redirects=False)
    assert again.status_code == 303 and again.headers["location"] == "/login"


def _extract_csrf(html: str) -> str:
    import re
    return re.search(r'name="csrf-token" content="([^"]+)"', html).group(1)


def test_anonymous_redirected_to_login(client):
    r = client.get("/", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/login"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv\Scripts\python -m pytest tests/test_auth.py -v`
Expected: FAIL (405/404 — no login route yet).

- [ ] **Step 3: Implement sessions + middleware + routes + minimal templates**

Append to `hub/control.py`:

```python
import time


def _sid_hash(sid: str) -> str:
    return hashlib.sha256(sid.encode()).hexdigest()


def create_session(conn, user_id, ttl_hours=8):
    sid = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(32)
    now = int(time.time())
    conn.execute("insert into sessions values(?,?,?,?,?,0)",
                 (_sid_hash(sid), user_id, csrf, now, now + ttl_hours * 3600))
    conn.commit()
    return sid, csrf


def get_session(conn, sid):
    r = conn.execute("select user_id, csrf, expires, revoked from sessions "
                     "where sid_hash=?", (_sid_hash(sid),)).fetchone()
    if not r or r[3] or r[2] < int(time.time()):
        return None
    return {"user_id": r[0], "csrf": r[1]}


def revoke_session(conn, sid):
    conn.execute("update sessions set revoked=1 where sid_hash=?", (_sid_hash(sid),))
    conn.commit()


def get_user(conn, user_id):
    r = conn.execute("select id, username, town_id, scopes from users where id=?",
                     (user_id,)).fetchone()
    if not r:
        return None
    return {"id": r[0], "username": r[1], "town_id": r[2], "scopes": json.loads(r[3])}
```

Append to `hub/security.py`:

```python
from hub import control

SESSION_COOKIE = "hub_sid"


class SessionMiddleware(BaseHTTPMiddleware):
    """Resolves hub_sid cookie -> request.state.principal {user, town, csrf} | None.
    Permissions live and die with the session row - never in a token (KAN-10)."""

    async def dispatch(self, request, call_next):
        request.state.principal = None
        sid = request.cookies.get(SESSION_COOKIE)
        if sid:
            conn = request.app.state.conn
            sess = control.get_session(conn, sid)
            if sess:
                user = control.get_user(conn, sess["user_id"])
                if user:
                    town = control.get_town(conn, user["town_id"])
                    request.state.principal = {"user": user, "town": town,
                                               "csrf": sess["csrf"]}
        return await call_next(request)
```

Replace `hub/routes/pages.py`:

```python
from fastapi import APIRouter, Form, Request
from fastapi.responses import RedirectResponse

from hub import control
from hub.security import SESSION_COOKIE

router = APIRouter()


@router.get("/healthz")
def healthz():
    return {"ok": True}


@router.get("/login")
def login_page(request: Request):
    from hub.app import templates
    return templates.TemplateResponse(request, "login.html", {"error": None})


@router.post("/login")
def login(request: Request, username: str = Form(...), password: str = Form(...)):
    from hub.app import templates
    conn = request.app.state.conn
    user = control.verify_user(conn, username, password)
    if not user:
        return templates.TemplateResponse(request, "login.html",
                                          {"error": "Sign-in failed - try again."})
    sid, _csrf = control.create_session(conn, user["id"],
                                        request.app.state.settings.session_ttl_hours)
    resp = RedirectResponse("/", status_code=303)
    resp.set_cookie(SESSION_COOKIE, sid, httponly=True, samesite="lax",
                    secure=request.app.state.settings.cookie_secure,
                    max_age=request.app.state.settings.session_ttl_hours * 3600)
    return resp


@router.post("/logout")
def logout(request: Request):
    sid = request.cookies.get(SESSION_COOKIE)
    if sid:
        control.revoke_session(request.app.state.conn, sid)
    resp = RedirectResponse("/login", status_code=303)
    resp.delete_cookie(SESSION_COOKIE)
    return resp


@router.get("/")
def workspace(request: Request):
    from hub.app import templates
    p = request.state.principal
    if not p:
        return RedirectResponse("/login", status_code=303)
    return templates.TemplateResponse(request, "workspace.html",
                                      {"principal": p, "csrf": p["csrf"]})
```

`hub/templates/base.html` (no inline anything; csrf exposed via meta + hx-headers):

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  {% if csrf %}<meta name="csrf-token" content="{{ csrf }}">{% endif %}
  <title>{% block title %}Lore Hub{% endblock %}</title>
  <link rel="stylesheet" href="/static/app.css">
</head>
<body {% if csrf %}hx-headers='{"X-CSRF": "{{ csrf }}"}'{% endif %}>
  {% block content %}{% endblock %}
  <script src="/static/htmx.min.js"></script>
</body>
</html>
```

`hub/templates/login.html`:

```html
{% extends "base.html" %}
{% block title %}Sign in - Lore Hub{% endblock %}
{% block content %}
<main class="login-card">
  <h1>Lore Hub</h1>
  <p class="sub">Municipal clerk workspace</p>
  {% if error %}<p class="error">{{ error }}</p>{% endif %}
  <form method="post" action="/login">
    <label for="username">Username</label>
    <input id="username" name="username" autocomplete="username" required>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">Sign in</button>
  </form>
</main>
{% endblock %}
```

`hub/templates/workspace.html` (minimal now — full Ellington shell in Task 6):

```html
{% extends "base.html" %}
{% block content %}
<header class="topbar"><h1>{{ principal.town.name }}</h1>
  <form method="post" action="/logout" hx-post="/logout"><button type="submit">Sign out</button></form>
</header>
{% endblock %}
```

`hub/static/app.css` (tokens only for now):

```css
:root {
  --paper: #f4f1e6; --brand: #8b0000; --ink: #26221a;
  --muted: #6b6455; --card: #ffffff; --line: #ddd6c2;
}
body { background: var(--paper); color: var(--ink); margin: 0;
       font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
h1 { font-family: Georgia, "Times New Roman", serif; }
.error { color: var(--brand); }
```

Modify `hub/app.py` — add templates + conn + middleware (order matters: session must run inside headers):

```python
from fastapi.templating import Jinja2Templates

from hub import control
from hub.security import SecurityHeadersMiddleware, SessionMiddleware

templates = Jinja2Templates(directory=HERE / "templates")  # autoescape ON by default


def create_app(engine_transport=None) -> FastAPI:
    settings = load_settings()
    app = FastAPI(title="Lore Hub")
    app.state.settings = settings
    app.state.engine_transport = engine_transport
    app.state.conn = control.connect(settings.db_path)
    app.add_middleware(SessionMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.mount("/static", StaticFiles(directory=HERE / "static"), name="static")
    app.include_router(pages.router)
    return app
```

- [ ] **Step 4: Run the full suite**

Run: `.venv\Scripts\python -m pytest -v`
Expected: test_auth PASS. NOTE: `test_logout_revokes_session_immediately` needs the CSRF middleware from Task 4 to *not* exist yet — it passes now because nothing enforces X-CSRF; it keeps passing after Task 4 because it sends the header. If it fails on the meta tag, that regex is satisfied by base.html's `csrf-token` meta — confirm workspace.html extends base with `csrf` in context.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: cookie sessions + login/logout - HttpOnly SameSite Secure, server-side revocation (KAN-10)"
```

---

### Task 4: CSRF guard (KAN-12)

**Files:**
- Create: `tests/test_csrf.py`
- Modify: `hub/security.py` (CSRFMiddleware), `hub/app.py` (register it)

**Interfaces:**
- Consumes: `request.state.principal` (Task 3).
- Produces: `CSRFMiddleware` — any POST/PUT/DELETE with a resolved session principal must carry header `X-CSRF` equal (constant-time) to the session csrf, else 403. Cookie-less requests pass through (login has nothing for CSRF to ride).

- [ ] **Step 1: Write the failing tests**

`tests/test_csrf.py`:

```python
def test_post_with_session_but_no_token_403(logged_in):
    r = logged_in.post("/logout", follow_redirects=False)  # no X-CSRF header
    assert r.status_code == 403


def test_post_with_wrong_token_403(logged_in):
    r = logged_in.post("/logout", headers={"X-CSRF": "wrong"}, follow_redirects=False)
    assert r.status_code == 403


def test_post_with_correct_token_passes(logged_in):
    import re
    html = logged_in.get("/").text
    token = re.search(r'name="csrf-token" content="([^"]+)"', html).group(1)
    r = logged_in.post("/logout", headers={"X-CSRF": token}, follow_redirects=False)
    assert r.status_code == 303


def test_login_post_without_cookie_is_exempt(client):
    r = client.post("/login", data={"username": "donna", "password": "pw123456"},
                    follow_redirects=False)
    assert r.status_code == 303
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv\Scripts\python -m pytest tests/test_csrf.py -v`
Expected: first two FAIL (logout currently succeeds without token).

- [ ] **Step 3: Implement CSRFMiddleware**

Append to `hub/security.py`:

```python
import secrets as _secrets

from starlette.responses import PlainTextResponse

MUTATING = {"POST", "PUT", "DELETE", "PATCH"}


class CSRFMiddleware(BaseHTTPMiddleware):
    """Cookie-authed mutation must carry a token the attacking site cannot read
    (KAN-12). Header-only: every HTMX request inherits it from body hx-headers."""

    async def dispatch(self, request, call_next):
        if request.method in MUTATING and request.state.principal is not None:
            sent = request.headers.get("X-CSRF", "")
            good = request.state.principal["csrf"]
            if not _secrets.compare_digest(sent, good):
                return PlainTextResponse("CSRF token missing or wrong", status_code=403)
        return await call_next(request)
```

In `hub/app.py`, register between session and headers (added AFTER SessionMiddleware so it runs INSIDE it and sees `request.state.principal`):

```python
    app.add_middleware(CSRFMiddleware)
    app.add_middleware(SessionMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
```

(Starlette runs middlewares outermost-last-added: SecurityHeaders → Session → CSRF → routes.)

- [ ] **Step 4: Run the full suite**

Run: `.venv\Scripts\python -m pytest -v`
Expected: all PASS, including Task 3's logout test (it sends the header).

- [ ] **Step 5: Commit**

```bash
git add hub/security.py hub/app.py tests/test_csrf.py
git commit -m "feat: CSRF guard on cookie-authed mutations - constant-time header check (KAN-12)"
```

---

### Task 5: Engine client — typed httpx wrapper with error mapping

**Files:**
- Create: `hub/engine_client.py`, `tests/test_engine_client.py`

**Interfaces:**
- Consumes: town dict shape from `control.get_town` (Task 2); `app.state.engine_transport` (Task 1).
- Produces (hub/engine_client.py):
  - `class EngineError(Exception)` with `.kind: str` in `{"down", "denied", "bad_request", "server"}` and `.detail: str` (safe for logs, never rendered raw).
  - `class EngineClient` — `__init__(self, town: dict, scopes: list[str], transport=None)`; `search(self, query: str, k: int = 10) -> list[dict]` (engine result dicts: note_id, title, scope, heading_path, text, score); `ask(self, question: str) -> dict` (keys: answer, citations, conflicts, engine, scopes_used).
  - Auth: if `town["key_ref"]` is set, header `Authorization: Bearer <os.environ[key_ref]>`; body always carries tenant/scopes (engine local mode needs it; server mode ignores in favor of the key).
  - Timeouts: connect 3s; read 15s for search, 90s for ask (LLM latency).

- [ ] **Step 1: Write the failing tests**

`tests/test_engine_client.py`:

```python
import json

import httpx
import pytest

from hub.engine_client import EngineClient, EngineError

TOWN = {"id": "tw-1", "slug": "e", "name": "E", "engine_url": "http://engine.test",
        "tenant_id": "ellington", "key_ref": None}


def make_client(handler):
    return EngineClient(TOWN, ["clerk", "public"],
                        transport=httpx.MockTransport(handler))


def test_search_sends_contract_body_and_returns_results():
    seen = {}

    def handler(req):
        seen["url"] = str(req.url)
        seen["body"] = json.loads(req.content)
        return httpx.Response(200, json={"results": [
            {"note_id": "n-1", "title": "Dog licenses", "scope": "public",
             "heading_path": "Licensing > Dogs", "text": "Renew by June 30.",
             "score": 0.91}], "scopes_used": ["clerk", "public"], "profile": None})

    results = make_client(handler).search("dog license", k=5)
    assert seen["url"] == "http://engine.test/search"
    assert seen["body"] == {"query": "dog license", "scopes": ["clerk", "public"],
                            "tenant_id": "ellington", "k": 5}
    assert results[0]["note_id"] == "n-1" and results[0]["score"] == 0.91


def test_ask_returns_answer_citations_conflicts():
    def handler(req):
        body = json.loads(req.content)
        assert body == {"question": "when do dog licenses renew?",
                        "principal_scopes": ["clerk", "public"],
                        "tenant_id": "ellington"}
        return httpx.Response(200, json={
            "answer": "Renewals are due June 30.", "engine": "gemma",
            "scopes_used": ["clerk", "public"], "profile": None,
            "citations": [{"note_id": "n-1", "title": "Dog licenses",
                           "heading_path": "Licensing > Dogs", "scope": "public",
                           "why": None}],
            "conflicts": []})

    out = make_client(handler).ask("when do dog licenses renew?")
    assert out["answer"].startswith("Renewals")
    assert out["citations"][0]["note_id"] == "n-1"


def test_key_ref_sends_bearer(monkeypatch):
    monkeypatch.setenv("TOWN_E_KEY", "lore_sk_test123")
    town = dict(TOWN, key_ref="TOWN_E_KEY")

    def handler(req):
        assert req.headers["authorization"] == "Bearer lore_sk_test123"
        return httpx.Response(200, json={"results": [], "scopes_used": [], "profile": None})

    EngineClient(town, ["clerk"], transport=httpx.MockTransport(handler)).search("x")


@pytest.mark.parametrize("status,kind", [(401, "denied"), (403, "denied"),
                                         (422, "bad_request"), (500, "server")])
def test_http_errors_map_to_kinds(status, kind):
    def handler(req):
        return httpx.Response(status, json={"detail": "nope"})

    with pytest.raises(EngineError) as e:
        make_client(handler).search("x")
    assert e.value.kind == kind


def test_connection_failure_maps_to_down():
    def handler(req):
        raise httpx.ConnectError("refused")

    with pytest.raises(EngineError) as e:
        make_client(handler).search("x")
    assert e.value.kind == "down"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv\Scripts\python -m pytest tests/test_engine_client.py -v`
Expected: FAIL with ImportError.

- [ ] **Step 3: Implement engine_client.py**

```python
"""Typed client for a town's Lore engine API. The engine is the ONLY ACL home -
this client forwards identity, it never filters (spec: ACL home decision)."""
import os

import httpx


class EngineError(Exception):
    def __init__(self, kind: str, detail: str = ""):
        super().__init__(f"{kind}: {detail}")
        self.kind = kind        # down | denied | bad_request | server
        self.detail = detail


def _map_status(status: int) -> str:
    if status in (401, 403):
        return "denied"
    if status in (400, 404, 422):
        return "bad_request"
    return "server"


class EngineClient:
    def __init__(self, town: dict, scopes: list, transport=None):
        self.town = town
        self.scopes = list(scopes)
        headers = {}
        if town.get("key_ref"):
            key = os.environ.get(town["key_ref"], "")
            headers["Authorization"] = f"Bearer {key}"
        self._http = httpx.Client(base_url=town["engine_url"], headers=headers,
                                  transport=transport,
                                  timeout=httpx.Timeout(15, connect=3))

    def _post(self, path: str, body: dict, read_timeout: float) -> dict:
        try:
            r = self._http.post(path, json=body,
                                timeout=httpx.Timeout(read_timeout, connect=3))
        except httpx.HTTPError as e:
            raise EngineError("down", str(e))
        if r.status_code != 200:
            raise EngineError(_map_status(r.status_code), r.text[:300])
        return r.json()

    def search(self, query: str, k: int = 10) -> list:
        body = {"query": query, "scopes": self.scopes,
                "tenant_id": self.town["tenant_id"], "k": k}
        return self._post("/search", body, read_timeout=15).get("results", [])

    def ask(self, question: str) -> dict:
        body = {"question": question, "principal_scopes": self.scopes,
                "tenant_id": self.town["tenant_id"]}
        return self._post("/ask", body, read_timeout=90)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv\Scripts\python -m pytest tests/test_engine_client.py -v`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add hub/engine_client.py tests/test_engine_client.py
git commit -m "feat: typed engine client - contract bodies, bearer key_ref, error kinds"
```

---

### Task 6: Ellington workspace shell + full stylesheet

**Files:**
- Modify: `hub/templates/workspace.html`, `hub/static/app.css`
- Create: `tests/test_pages.py`

**Interfaces:**
- Consumes: `principal` context (Task 3).
- Produces: workspace layout with `#results` and `#answer` swap targets, forms `hx-post="/search"` / `hx-post="/ask"` (fragments implemented in Tasks 7–8 — until then submissions 404, which is fine: tests here only assert markup). CSS classes used by fragments: `.card`, `.result-row`, `.scope-chip`, `.score-bar`, `.banner.green|.amber|.red`, `.muted`, `.error`.

- [ ] **Step 1: Write the failing tests**

`tests/test_pages.py`:

```python
import re


def test_workspace_renders_ellington_shell(logged_in):
    html = logged_in.get("/").text
    assert "Town of Ellington" in html
    assert 'hx-post="/search"' in html and 'hx-target="#results"' in html
    assert 'hx-post="/ask"' in html and 'hx-target="#answer"' in html
    assert re.search(r'name="csrf-token" content="[^"]+"', html)


def test_no_inline_script_or_style_anywhere(logged_in):
    for path in ("/", "/login"):
        html = logged_in.get(path).text
        assert "<style" not in html
        assert 'style="' not in html
        for m in re.finditer(r"<script\b([^>]*)>", html):
            assert 'src="/static/htmx.min.js"' in m.group(1)  # only the vendored script


def test_css_carries_ellington_palette(client):
    css = client.get("/static/app.css").text
    assert "#f4f1e6" in css and "#8b0000" in css and "Georgia" in css
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv\Scripts\python -m pytest tests/test_pages.py -v`
Expected: first test FAILS (no search/ask forms yet).

- [ ] **Step 3: Build the shell and stylesheet**

`hub/templates/workspace.html`:

```html
{% extends "base.html" %}
{% block title %}{{ principal.town.name }} - Lore Hub{% endblock %}
{% block content %}
<div class="shell">
  <header class="topbar">
    <div class="brand-lockup">
      <span class="seal">{{ principal.town.name[:1] }}</span>
      <div>
        <h1>{{ principal.town.name }}</h1>
        <p class="sub">Clerk Workspace</p>
      </div>
    </div>
    <nav class="user-nav">
      <span class="muted">{{ principal.user.username }}</span>
      <form method="post" action="/logout" hx-post="/logout">
        <button type="submit" class="ghost">Sign out</button>
      </form>
    </nav>
  </header>

  <main class="panes">
    <section class="card" aria-labelledby="search-h">
      <h2 id="search-h">Search the record</h2>
      <form hx-post="/search" hx-target="#results" hx-indicator="#search-busy">
        <div class="query-row">
          <input name="q" placeholder="Search minutes, permits, licenses..."
                 autocomplete="off" required>
          <button type="submit">Search</button>
        </div>
      </form>
      <p id="search-busy" class="muted htmx-indicator">Searching...</p>
      <div id="results" aria-live="polite"></div>
    </section>

    <section class="card" aria-labelledby="ask-h">
      <h2 id="ask-h">Ask Lore</h2>
      <form hx-post="/ask" hx-target="#answer" hx-indicator="#ask-busy">
        <div class="query-row">
          <input name="q" placeholder="Ask a question - answers cite the record"
                 autocomplete="off" required>
          <button type="submit">Ask</button>
        </div>
      </form>
      <p id="ask-busy" class="muted htmx-indicator">Reading the record...</p>
      <div id="answer" aria-live="polite"></div>
    </section>
  </main>
</div>
{% endblock %}
```

`hub/static/app.css` — replace with the full Ellington sheet:

```css
/* Ellington Clerk Workspace design language - cream paper, town-seal red, serif headings. */
:root {
  --paper: #f4f1e6; --brand: #8b0000; --ink: #26221a;
  --muted: #6b6455; --card: #ffffff; --line: #ddd6c2;
  --green: #2e6b34; --amber: #9a6b00; --red: #8b0000;
}
* { box-sizing: border-box; }
body { background: var(--paper); color: var(--ink); margin: 0;
       font: 15px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; }
h1, h2 { font-family: Georgia, "Times New Roman", serif; margin: 0; }

.shell { max-width: 1180px; margin: 0 auto; padding: 20px; }
.topbar { display: flex; justify-content: space-between; align-items: center;
          border-bottom: 2px solid var(--brand); padding-bottom: 14px; margin-bottom: 20px; }
.brand-lockup { display: flex; gap: 12px; align-items: center; }
.seal { width: 44px; height: 44px; border-radius: 50%; background: var(--brand);
        color: var(--paper); font-family: Georgia, serif; font-size: 24px;
        display: flex; align-items: center; justify-content: center; }
.sub { color: var(--muted); margin: 0; font-size: 13px; }
.user-nav { display: flex; gap: 12px; align-items: center; }

.panes { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
@media (max-width: 860px) { .panes { grid-template-columns: 1fr; } }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px;
        padding: 18px; }
.card h2 { font-size: 19px; margin-bottom: 10px; }

.query-row { display: flex; gap: 8px; margin: 8px 0 12px; }
input { flex: 1; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px;
        background: #fdfcf7; font-size: 15px; color: var(--ink); }
button { background: var(--brand); color: var(--paper); border: 0; border-radius: 8px;
         padding: 10px 18px; font-weight: 600; cursor: pointer; }
button.ghost { background: transparent; color: var(--muted);
               border: 1px solid var(--line); font-weight: 500; }

.muted { color: var(--muted); }
.error { color: var(--red); }
.htmx-indicator { display: none; }
.htmx-request .htmx-indicator, .htmx-request.htmx-indicator { display: block; }

.result-row { display: flex; gap: 10px; align-items: baseline; padding: 9px 0;
              border-bottom: 1px solid var(--line); }
.result-row:last-child { border-bottom: 0; }
.result-title { font-weight: 600; }
.result-path { color: var(--muted); font-size: 12.5px; }
.result-text { font-size: 13.5px; margin: 2px 0 0; }
.scope-chip { font-size: 11px; padding: 2px 9px; border-radius: 999px;
              border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
.score-bar { height: 5px; border-radius: 3px; background: var(--brand); opacity: .75; }

.banner { border-radius: 8px; padding: 8px 12px; font-weight: 600; font-size: 13px;
          margin-bottom: 10px; border: 1px solid; }
.banner.green { color: var(--green); border-color: var(--green); background: #eef4ec; }
.banner.amber { color: var(--amber); border-color: var(--amber); background: #f8f2e2; }
.banner.red   { color: var(--red);   border-color: var(--red);   background: #f7ebe9; }
.answer-text { white-space: pre-wrap; }
.citations { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--line); }
.citation { display: inline-block; margin: 2px 6px 2px 0; font-size: 12.5px;
            color: var(--muted); border: 1px solid var(--line); border-radius: 6px;
            padding: 2px 8px; }
.login-card { max-width: 380px; margin: 12vh auto; background: var(--card);
              border: 1px solid var(--line); border-radius: 10px; padding: 26px;
              display: flex; flex-direction: column; gap: 8px; }
.login-card h1 { color: var(--brand); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv\Scripts\python -m pytest tests/test_pages.py -v`
Expected: PASS (3 tests). Also rerun the whole suite: `.venv\Scripts\python -m pytest -q` — all green.

- [ ] **Step 5: Commit**

```bash
git add hub/templates/workspace.html hub/static/app.css tests/test_pages.py
git commit -m "feat: Ellington clerk workspace shell - search/ask panes, palette, zero inline"
```

---

### Task 7: Search fragment (KAN-15 search half) + XSS regression

**Files:**
- Create: `hub/routes/fragments.py`, `hub/templates/fragments/results.html`, `hub/templates/fragments/error.html`, `tests/test_search_fragment.py`
- Modify: `hub/app.py` (include fragments router), `tests/conftest.py` (fake engine fixture)

**Interfaces:**
- Consumes: `EngineClient`, `EngineError` (Task 5); `request.state.principal` (Task 3); CSS classes (Task 6); `app.state.engine_transport` (Task 1).
- Produces: `POST /search` form field `q` → HTML fragment; helper `get_engine(request) -> EngineClient` reused by Task 8; `fragments/error.html` context `{message: str}` reused by Task 8.

- [ ] **Step 1: Add the fake engine fixture**

Append to `tests/conftest.py`:

```python
import json as _json

import httpx


class FakeEngine:
    """Programmable engine double. Set .search_response / .ask_response / .fail."""

    def __init__(self):
        self.search_response = {"results": [], "scopes_used": [], "profile": None}
        self.ask_response = {"answer": "", "engine": "fake", "scopes_used": [],
                             "profile": None, "citations": [], "conflicts": []}
        self.fail = None            # None | "down" | int status
        self.last_body = None

    def handler(self, req: httpx.Request) -> httpx.Response:
        if self.fail == "down":
            raise httpx.ConnectError("refused")
        if isinstance(self.fail, int):
            return httpx.Response(self.fail, json={"detail": "nope"})
        self.last_body = _json.loads(req.content)
        payload = self.search_response if req.url.path == "/search" else self.ask_response
        return httpx.Response(200, json=payload)


@pytest.fixture()
def fake_engine():
    return FakeEngine()


@pytest.fixture()
def app_and_db(tmp_path, monkeypatch, fake_engine):
    monkeypatch.setenv("HUB_DB", str(tmp_path / "control.db"))
    monkeypatch.setenv("HUB_COOKIE_SECURE", "1")
    app = create_app(engine_transport=httpx.MockTransport(fake_engine.handler))
    conn = app.state.conn
    town_id = control.create_town(conn, "ellington", "Town of Ellington",
                                  "http://engine.test", "ellington")
    control.create_user(conn, "donna", "pw123456", town_id, ["clerk", "public"])
    return app, conn


@pytest.fixture()
def csrf(logged_in):
    import re
    html = logged_in.get("/").text
    return re.search(r'name="csrf-token" content="([^"]+)"', html).group(1)
```

(The old `app_and_db` fixture is replaced by this one — single definition.)

- [ ] **Step 2: Write the failing tests**

`tests/test_search_fragment.py`:

```python
def test_search_renders_result_rows(logged_in, csrf, fake_engine):
    fake_engine.search_response = {"results": [
        {"note_id": "n-1", "title": "Dog licenses", "scope": "public",
         "heading_path": "Licensing > Dogs", "text": "Renew by June 30.", "score": 0.91},
    ], "scopes_used": ["clerk", "public"], "profile": None}
    r = logged_in.post("/search", data={"q": "dog license"}, headers={"X-CSRF": csrf})
    assert r.status_code == 200
    assert "Dog licenses" in r.text and "Licensing &gt; Dogs" in r.text
    assert fake_engine.last_body["query"] == "dog license"
    assert fake_engine.last_body["tenant_id"] == "ellington"
    assert fake_engine.last_body["scopes"] == ["clerk", "public"]


def test_search_empty_state(logged_in, csrf, fake_engine):
    r = logged_in.post("/search", data={"q": "zoning marmots"}, headers={"X-CSRF": csrf})
    assert r.status_code == 200
    assert "No records matched" in r.text


def test_search_engine_down_renders_friendly_error(logged_in, csrf, fake_engine):
    fake_engine.fail = "down"
    r = logged_in.post("/search", data={"q": "x"}, headers={"X-CSRF": csrf})
    assert r.status_code == 200
    assert "engine is unreachable" in r.text.lower()
    assert "Traceback" not in r.text and "ConnectError" not in r.text


def test_search_requires_session(client):
    r = client.post("/search", data={"q": "x"}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/login"


def test_search_requires_csrf(logged_in):
    r = logged_in.post("/search", data={"q": "x"})
    assert r.status_code == 403


def test_hostile_engine_text_renders_escaped(logged_in, csrf, fake_engine):
    payload = '<img src=x onerror=alert(1)>'
    fake_engine.search_response = {"results": [
        {"note_id": "n-2", "title": payload, "scope": "public",
         "heading_path": "X", "text": payload, "score": 0.5}],
        "scopes_used": ["clerk"], "profile": None}
    r = logged_in.post("/search", data={"q": "x"}, headers={"X-CSRF": csrf})
    assert "<img" not in r.text
    assert "&lt;img" in r.text
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `.venv\Scripts\python -m pytest tests/test_search_fragment.py -v`
Expected: FAIL with 404 (no /search route).

- [ ] **Step 4: Implement the fragment route + templates**

`hub/routes/fragments.py`:

```python
from fastapi import APIRouter, Form, Request
from fastapi.responses import RedirectResponse

from hub.engine_client import EngineClient, EngineError

router = APIRouter()

ERROR_COPY = {
    "down": "The town engine is unreachable right now. Try again in a moment.",
    "denied": "The engine declined this request for your account.",
    "bad_request": "The engine could not process that query.",
    "server": "The engine hit an internal error. Try again in a moment.",
}


def get_engine(request: Request) -> EngineClient:
    p = request.state.principal
    return EngineClient(p["town"], p["user"]["scopes"],
                        transport=request.app.state.engine_transport)


@router.post("/search")
def search(request: Request, q: str = Form(...)):
    from hub.app import templates
    if not request.state.principal:
        return RedirectResponse("/login", status_code=303)
    try:
        results = get_engine(request).search(q)
    except EngineError as e:
        return templates.TemplateResponse(request, "fragments/error.html",
                                          {"message": ERROR_COPY[e.kind]})
    return templates.TemplateResponse(request, "fragments/results.html",
                                      {"results": results, "q": q})
```

`hub/templates/fragments/results.html`:

```html
{% if not results %}
<p class="muted">No records matched "{{ q }}". Try different words - the engine
searches meaning and exact terms.</p>
{% else %}
{% for r in results %}
<div class="result-row">
  <div>
    <span class="result-title">{{ r.title or "Untitled" }}</span>
    <div class="result-path">{{ r.heading_path }}</div>
    <p class="result-text">{{ r.text }}</p>
  </div>
  <span class="scope-chip">{{ r.scope }}</span>
  <span class="muted">{{ "%.2f"|format(r.score) }}</span>
</div>
{% endfor %}
{% endif %}
```

`hub/templates/fragments/error.html`:

```html
<p class="error">{{ message }}</p>
```

In `hub/app.py`, import and include:

```python
from hub.routes import fragments, pages
    ...
    app.include_router(pages.router)
    app.include_router(fragments.router)
```

- [ ] **Step 5: Run the full suite**

Run: `.venv\Scripts\python -m pytest -v`
Expected: all PASS, including the XSS regression (Jinja autoescape does the work — the test proves it stays on).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: search fragment - engine results, empty/error states, XSS regression test"
```

---

### Task 8: Ask fragment with citations + GREEN/AMBER/RED (KAN-15)

**Files:**
- Create: `hub/templates/fragments/answer.html`, `tests/test_ask_fragment.py`
- Modify: `hub/routes/fragments.py`

**Interfaces:**
- Consumes: `get_engine`, `ERROR_COPY`, error template (Task 7); `EngineClient.ask` response shape (Task 5).
- Produces: `POST /ask` form field `q` → answer fragment; `_confidence(payload) -> tuple[str, str]` returning `(state, note)` where state ∈ green|amber|red — the interim rule until engine KAN-53 ships a real calibration field.

- [ ] **Step 1: Write the failing tests**

`tests/test_ask_fragment.py`:

```python
CITATION = {"note_id": "n-1", "title": "Dog licenses",
            "heading_path": "Licensing > Dogs", "scope": "public", "why": None}


def test_ask_green_when_cited_no_conflicts(logged_in, csrf, fake_engine):
    fake_engine.ask_response = {"answer": "Renewals are due June 30.", "engine": "gemma",
                                "scopes_used": ["clerk"], "profile": None,
                                "citations": [CITATION], "conflicts": []}
    r = logged_in.post("/ask", data={"q": "when are renewals?"}, headers={"X-CSRF": csrf})
    assert r.status_code == 200
    assert 'banner green' in r.text and "Renewals are due June 30." in r.text
    assert "Dog licenses" in r.text            # citation chip
    assert fake_engine.last_body["question"] == "when are renewals?"


def test_ask_amber_when_conflicts(logged_in, csrf, fake_engine):
    fake_engine.ask_response = {"answer": "Two sources disagree.", "engine": "gemma",
                                "scopes_used": ["clerk"], "profile": None,
                                "citations": [CITATION],
                                "conflicts": [{"evidence": "2024 minutes contradict 2026 fee schedule"}]}
    r = logged_in.post("/ask", data={"q": "fee?"}, headers={"X-CSRF": csrf})
    assert 'banner amber' in r.text
    assert "2024 minutes contradict" in r.text


def test_ask_red_when_no_citations(logged_in, csrf, fake_engine):
    fake_engine.ask_response = {"answer": "I could not find this in the record.",
                                "engine": "gemma", "scopes_used": ["clerk"],
                                "profile": None, "citations": [], "conflicts": []}
    r = logged_in.post("/ask", data={"q": "moon cheese?"}, headers={"X-CSRF": csrf})
    assert 'banner red' in r.text
    assert "not supported by the record" in r.text.lower()


def test_ask_engine_down_friendly(logged_in, csrf, fake_engine):
    fake_engine.fail = "down"
    r = logged_in.post("/ask", data={"q": "x"}, headers={"X-CSRF": csrf})
    assert "engine is unreachable" in r.text.lower()


def test_hostile_answer_text_escaped(logged_in, csrf, fake_engine):
    fake_engine.ask_response = {"answer": '<script>alert(1)</script>', "engine": "gemma",
                                "scopes_used": ["clerk"], "profile": None,
                                "citations": [dict(CITATION, title="<b>bold</b>")],
                                "conflicts": []}
    r = logged_in.post("/ask", data={"q": "x"}, headers={"X-CSRF": csrf})
    assert "<script>alert" not in r.text
    assert "&lt;script&gt;" in r.text and "&lt;b&gt;" in r.text
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv\Scripts\python -m pytest tests/test_ask_fragment.py -v`
Expected: FAIL with 404 (no /ask route).

- [ ] **Step 3: Implement /ask + answer template**

Append to `hub/routes/fragments.py`:

```python
def _confidence(payload: dict) -> tuple[str, str]:
    """Interim mapping until the engine ships calibrated confidence (KAN-53):
    cited + clean -> green; cited but disputed -> amber; uncited -> red."""
    if not payload.get("citations"):
        return "red", "Not supported by the record - Lore abstains rather than guesses."
    if payload.get("conflicts"):
        return "amber", "Cited, but the record disagrees with itself - review before relying on this."
    return "green", "Every claim below is cited to the record."


@router.post("/ask")
def ask(request: Request, q: str = Form(...)):
    from hub.app import templates
    if not request.state.principal:
        return RedirectResponse("/login", status_code=303)
    try:
        payload = get_engine(request).ask(q)
    except EngineError as e:
        return templates.TemplateResponse(request, "fragments/error.html",
                                          {"message": ERROR_COPY[e.kind]})
    state, note = _confidence(payload)
    return templates.TemplateResponse(request, "fragments/answer.html",
                                      {"a": payload, "state": state, "note": note})
```

`hub/templates/fragments/answer.html`:

```html
<div class="banner {{ state }}">{{ note }}</div>
<p class="answer-text">{{ a.answer }}</p>
{% if a.conflicts %}
<div class="citations">
  <span class="muted">Disputed:</span>
  {% for c in a.conflicts %}<span class="citation">{{ c.evidence or c }}</span>{% endfor %}
</div>
{% endif %}
{% if a.citations %}
<div class="citations">
  <span class="muted">Sources:</span>
  {% for c in a.citations %}
  <span class="citation" title="{{ c.heading_path }}">{{ c.title }} ({{ c.scope }})</span>
  {% endfor %}
</div>
{% endif %}
```

- [ ] **Step 4: Run the full suite**

Run: `.venv\Scripts\python -m pytest -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: ask fragment - cited answers with GREEN/AMBER/RED interim confidence (KAN-15)"
```

---

### Task 9: Seed CLI, README runbook, live-engine verification

**Files:**
- Create: `hub/seed.py`, `README.md`
- Modify: `.env.example` (document seed usage)

**Interfaces:**
- Consumes: `control.connect/create_town/create_user` (Task 2), `load_settings` (Task 1).
- Produces: `python -m hub.seed --slug ellington --name "Town of Ellington" --engine-url http://127.0.0.1:8099 --tenant solo --user donna --password <pw> --scopes clerk,public`.

- [ ] **Step 1: Implement seed CLI**

`hub/seed.py`:

```python
"""Dev seeding: create a town + user in control.db. NOT for production onboarding."""
import argparse

from hub import control
from hub.config import load_settings


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--slug", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--engine-url", required=True)
    p.add_argument("--tenant", required=True)
    p.add_argument("--key-ref", default=None,
                   help="env var NAME holding this town's lore_sk_* key (value never stored)")
    p.add_argument("--user", required=True)
    p.add_argument("--password", required=True)
    p.add_argument("--scopes", required=True, help="comma-separated, e.g. clerk,public")
    a = p.parse_args()

    conn = control.connect(load_settings().db_path)
    row = conn.execute("select id from towns where slug=?", (a.slug,)).fetchone()
    town_id = row[0] if row else control.create_town(
        conn, a.slug, a.name, a.engine_url, a.tenant, a.key_ref)
    control.create_user(conn, a.user, a.password, town_id, a.scopes.split(","))
    print(f"town={town_id} user={a.user} scopes={a.scopes}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Write README.md**

```markdown
# Lore Hub

Multi-municipality clerk webapp over per-town Lore engines. Server-rendered
FastAPI + Jinja2 + HTMX - no npm, no build step, zero inline JS/CSS (strict CSP).
The engine API is the only ACL home; the hub renders and holds no corpus data.

Spec: vault-kos/docs/superpowers/specs/2026-08-12-lore-hub-webapp-design.md
Board: Jira KAN-1 epic (KAN-9, KAN-15, KAN-77 in this slice).

## Quickstart (dev)

    python -m venv .venv
    .venv\Scripts\pip install -e .[dev]
    copy .env.example .env          # sets HUB_COOKIE_SECURE=0 for http dev
    # town #1 = your local lore-arch engine
    .venv\Scripts\python -m hub.seed --slug ellington --name "Town of Ellington" ^
        --engine-url http://127.0.0.1:8099 --tenant solo ^
        --user donna --password change-me --scopes clerk,public
    .venv\Scripts\python -m uvicorn hub.app:app --port 8180

Open http://localhost:8180 - sign in - Search and Ask hit the engine live.

## Tests

    .venv\Scripts\python -m pytest -q

## Environment

| var | default | meaning |
|---|---|---|
| HUB_DB | data/control.db | control-plane SQLite (towns/users/sessions - never corpus) |
| HUB_COOKIE_SECURE | 1 | Secure flag on the session cookie; 0 ONLY for local http |
| <key_ref names> | - | per-town lore_sk_* engine keys, referenced by env var name |
```

- [ ] **Step 3: Load .env for dev runs**

`hub/config.py` — make `load_settings` read a `.env` file if present (stdlib, no python-dotenv):

```python
def _load_dotenv():
    env_file = Path(".env")
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())


def load_settings() -> Settings:
    _load_dotenv()
    return Settings(
        db_path=Path(os.environ.get("HUB_DB", "data/control.db")),
        cookie_secure=os.environ.get("HUB_COOKIE_SECURE", "1") == "1",
    )
```

(Tests are unaffected: monkeypatch.setenv wins because `setdefault` never overrides.)

- [ ] **Step 4: Verify against the live engine**

With the local lore-arch engine running on :8099 (launcher `~/.lore`):

```powershell
cd C:\Users\ivatu\lore-hub
.venv\Scripts\python -m hub.seed --slug ellington --name "Town of Ellington" --engine-url http://127.0.0.1:8099 --tenant solo --user donna --password change-me --scopes clerk,public
.venv\Scripts\python -m uvicorn hub.app:app --port 8180
```

Then in the browser preview: sign in as donna, run one Search and one Ask, and confirm: results render; the answer shows a banner + citation chips; DevTools console shows zero CSP violations; `curl -I http://localhost:8180/login` shows the full header set. If the engine rejects scopes ("scopes and tenant_id are required"), the seeded scopes don't exist in that tenant — check the engine's scope names via `GET :8099/presets` and reseed with matching ones.

- [ ] **Step 5: Run the full suite one last time, commit, tag Jira**

Run: `.venv\Scripts\python -m pytest -q`
Expected: all green.

```bash
git add -A
git commit -m "feat: seed CLI + README runbook - slice 1 complete against live engine"
```

Move KAN-9 to In Progress→Done column commentary is handled outside this plan (acli in vault-kos session).

---

## Self-Review (done at write time)

- **Spec coverage:** skeleton/factory (T1), control plane (T2), sessions KAN-10 (T3), CSRF KAN-12 (T4), engine client + KAN-77 shape (T5 — key_ref bearer), Ellington shell + zero-inline KAN-9/13 (T6, headers in T1), Search (T7) + Ask + confidence states KAN-15 (T8), runbook + live verification (T9). Not in slice (per spec): OIDC, inbox/tasks/drafts, admin, rate limits, audit log.
- **Placeholder scan:** none — every step carries real code.
- **Type consistency:** `create_app(engine_transport=None)` consumed in conftest (T1/T7); `principal = {user, town, csrf}` shape consistent across T3/T4/T7/T8; `EngineError.kind` values match `ERROR_COPY` keys; `get_town` dict keys match `EngineClient.__init__` usage; CSS classes referenced by fragments exist in T6's sheet.
