"""Google OAuth (desktop loopback) verification + Lore session JWTs.

Flow (server side of the desktop-loopback design):
  1. The Electron app runs the Google loopback OAuth flow and obtains a Google
     **ID token** for the signed-in user.
  2. It POSTs that ID token to the Lore server (`POST /auth/google`).
  3. `login_with_google` here VERIFIES the ID token against Google (signature via
     Google's keys + audience == our client_id), upserts the user, resolves the
     user's team scopes from membership, and issues a short-lived **Lore session
     JWT** the client then sends on `/sync` and `/ask`.

Trust boundary: we never trust client-supplied identity or scopes — the Google
ID token is cryptographically verified, and scopes come from the membership
tables (see `tenancy.authorize_scopes`).
"""
import os
import json
import time
import secrets as _secrets

import jwt  # PyJWT
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

from . import tenancy

# --- configuration ---------------------------------------------------------

# Path to the Google OAuth client JSON (the gitignored desktop/installed client).
_DEFAULT_CLIENT_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),  # repo root
    "secrets", "google_oauth_client.json",
)
_JWT_ALG = "HS256"
_JWT_TTL_SECONDS = 3600
_JWT_ISSUER = "lore"


def load_google_client(path: str = None) -> dict:
    """Load the Google OAuth client config. Looks at `path`, then
    $GOOGLE_OAUTH_CLIENT_FILE, then the repo's secrets/ default. Returns the
    inner client object (handles both 'installed' and 'web' client JSON shapes)."""
    p = path or os.environ.get("GOOGLE_OAUTH_CLIENT_FILE") or _DEFAULT_CLIENT_FILE
    with open(p, "r", encoding="utf-8") as f:
        data = json.load(f)
    # Google wraps the config under "installed" (desktop) or "web".
    return data.get("installed") or data.get("web") or data


def google_client_id(path: str = None) -> str:
    """The OAuth client_id used as the required `audience` when verifying ID tokens."""
    return load_google_client(path)["client_id"]


def _jwt_secret() -> str:
    """The HS256 signing secret for Lore session JWTs. From $LORE_JWT_SECRET, else a
    gitignored secrets/jwt_secret.txt that is generated once on first use (dev-friendly;
    in production set $LORE_JWT_SECRET explicitly)."""
    env = os.environ.get("LORE_JWT_SECRET")
    if env:
        return env
    # Fail closed in a shared/hosted deployment: never silently run on an
    # auto-generated on-disk secret a leak of which forges any user's session.
    if os.environ.get("LORE_SERVER_MODE") == "1":
        raise AuthError("LORE_JWT_SECRET must be set explicitly in server mode")
    path = os.path.join(os.path.dirname(_DEFAULT_CLIENT_FILE), "jwt_secret.txt")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    s = _secrets.token_urlsafe(48)
    with open(path, "w", encoding="utf-8") as f:
        f.write(s)
    return s


# --- Google ID token verification ------------------------------------------

class AuthError(Exception):
    """Raised when an identity or session token cannot be verified."""


def verify_google_id_token(token: str, client_id: str = None) -> dict:
    """Verify a Google ID token's signature, expiry, issuer, and audience.
    Returns {sub, email, name, email_verified}. Raises AuthError on any failure.

    `sub` is Google's stable unique user id — use it as the durable account key,
    not the email (emails can change/recycle)."""
    aud = client_id or google_client_id()
    try:
        claims = google_id_token.verify_oauth2_token(token, google_requests.Request(), aud)
    except Exception as e:  # ValueError on bad signature/aud/expiry
        raise AuthError(f"invalid Google ID token: {e}") from e
    if claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise AuthError("unexpected token issuer")
    if not claims.get("email_verified", False):
        raise AuthError("email not verified by Google")
    return {
        "sub": claims["sub"],
        "email": claims.get("email"),
        "name": claims.get("name"),
        "email_verified": True,
    }


# --- Lore session JWTs ------------------------------------------------------

def issue_session_jwt(user_id: str, ttl: int = _JWT_TTL_SECONDS, now: int = None) -> str:
    """Issue a short-lived Lore session JWT for an authenticated user."""
    iat = now if now is not None else int(time.time())
    payload = {"sub": user_id, "iss": _JWT_ISSUER, "iat": iat, "exp": iat + ttl}
    return jwt.encode(payload, _jwt_secret(), algorithm=_JWT_ALG)


def verify_session_jwt(token: str) -> dict:
    """Verify a Lore session JWT and return its claims. Raises AuthError if invalid
    or expired. NOTE: this proves identity only — authorization (which scopes the
    user may read) is always re-derived from membership, never from these claims."""
    try:
        return jwt.decode(token, _jwt_secret(), algorithms=[_JWT_ALG], issuer=_JWT_ISSUER)
    except jwt.PyJWTError as e:
        raise AuthError(f"invalid session token: {e}") from e


# --- user upsert + login ----------------------------------------------------

def upsert_user(conn, sub: str, email: str, name: str) -> str:
    """Create or update the user row keyed by Google `sub`. Returns the Lore user id
    (we use the Google sub as the durable id). Idempotent."""
    conn.execute(
        """insert into users(id, google_sub, email, name)
           values(%s,%s,%s,%s)
           on conflict (id) do update set email=excluded.email, name=excluded.name""",
        (sub, sub, email, name),
    )
    return sub


def login_with_google(conn, id_token_str: str, client_id: str = None) -> dict:
    """Full server-side login: verify the Google ID token, upsert the user, resolve
    their team scopes from membership, and issue a Lore session JWT.

    Returns {token, user_id, email, scopes}. Raises AuthError on bad identity."""
    identity = verify_google_id_token(id_token_str, client_id=client_id)
    user_id = upsert_user(conn, identity["sub"], identity["email"], identity["name"])
    scopes = tenancy.authorized_team_scope_ids(conn, user_id)
    token = issue_session_jwt(user_id)
    return {"token": token, "user_id": user_id, "email": identity["email"], "scopes": scopes}
