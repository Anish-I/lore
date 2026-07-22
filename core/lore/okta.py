"""Okta (OIDC) identity + SSO-group → Lore-scope mapping.

This is the enterprise multi-user gate (assessment §6a #3): identity is tied to
Okta SSO, and *membership is derived from Okta groups*, not from client claims.

Flow — mirrors the Google desktop-loopback path in `auth.py`:
  1. The Electron app runs Okta's OIDC loopback flow and obtains an Okta
     **ID token** (with the `groups` claim) for the signed-in user.
  2. It POSTs that ID token to `POST /auth/okta`.
  3. `login_with_okta` VERIFIES the token against Okta (RS256 signature via
     Okta's JWKS + issuer + audience == our client_id), upserts the user,
     RECONCILES their team memberships from the token's `groups` claim through a
     configured group→team map, and issues a short-lived Lore session JWT.

Trust boundary (identical to Google): we never trust client-supplied identity or
scopes. The Okta ID token is cryptographically verified, and the resulting scopes
come from the membership tables — which SSO itself reconciles here.

Config is ENV-ONLY (no secrets in the repo):
  OKTA_ISSUER            e.g. https://dev-12345.okta.com/oauth2/default
  OKTA_CLIENT_ID         the app's client_id (required `audience` on the token)
  OKTA_CLIENT_SECRET     optional; only for confidential-client/code exchange
                         (ID-token verification does not need it)
  OKTA_GROUP_SCOPE_MAP   JSON {"<okta-group-name>": "<lore-team-id>", ...}
                         SSO OWNS exactly the teams named here; invite-based
                         memberships to any other team are left untouched.
"""
import os
import json

import jwt  # PyJWT (RS256 needs pyjwt[crypto])

from . import auth, tenancy

_JWKS_PATH = "/v1/keys"

# Cache one PyJWKClient per issuer — it fetches + caches Okta's signing keys.
_jwks_clients: dict = {}


def okta_config() -> dict:
    """Load Okta config from the environment. Raises AuthError if the pieces
    required to VERIFY a token (issuer + client_id) are missing — fail closed so
    a misconfigured server never silently accepts unverifiable identities."""
    issuer = (os.environ.get("OKTA_ISSUER") or "").rstrip("/")
    client_id = os.environ.get("OKTA_CLIENT_ID") or ""
    if not issuer or not client_id:
        raise auth.AuthError("OKTA_ISSUER and OKTA_CLIENT_ID must be set")
    return {
        "issuer": issuer,
        "client_id": client_id,
        "client_secret": os.environ.get("OKTA_CLIENT_SECRET") or "",
        "group_scope_map": group_scope_map(),
    }


def group_scope_map() -> dict:
    """Parse OKTA_GROUP_SCOPE_MAP (JSON object of okta-group-name → lore-team-id).
    Empty/unset → {} (SSO manages no teams; login still works, groups just don't
    grant scopes). Raises AuthError on malformed JSON so the mistake is loud."""
    raw = os.environ.get("OKTA_GROUP_SCOPE_MAP")
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise auth.AuthError(f"OKTA_GROUP_SCOPE_MAP is not valid JSON: {e}") from e
    if not isinstance(data, dict):
        raise auth.AuthError("OKTA_GROUP_SCOPE_MAP must be a JSON object")
    return {str(k): str(v) for k, v in data.items()}


def _jwks_client(issuer: str):
    client = _jwks_clients.get(issuer)
    if client is None:
        client = jwt.PyJWKClient(issuer + _JWKS_PATH)
        _jwks_clients[issuer] = client
    return client


# --- Okta ID token verification --------------------------------------------

def verify_okta_id_token(token: str, issuer: str = None, client_id: str = None) -> dict:
    """Verify an Okta ID token's RS256 signature, expiry, issuer, and audience.
    Returns {sub, email, name, email_verified, groups}. Raises auth.AuthError on
    any failure.

    `sub` is Okta's stable unique user id — the durable account key (emails can
    change). `groups` is the SSO group list this login reconciles membership from
    (empty if the app isn't configured to emit a groups claim)."""
    cfg_issuer = (issuer or os.environ.get("OKTA_ISSUER") or "").rstrip("/")
    aud = client_id or os.environ.get("OKTA_CLIENT_ID") or ""
    if not cfg_issuer or not aud:
        raise auth.AuthError("OKTA_ISSUER and OKTA_CLIENT_ID must be set")
    try:
        signing_key = _jwks_client(cfg_issuer).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token, signing_key.key, algorithms=["RS256"],
            audience=aud, issuer=cfg_issuer,
        )
    except Exception as e:  # PyJWTError + JWKS/network failures
        raise auth.AuthError(f"invalid Okta ID token: {e}") from e
    if claims.get("email_verified") is False:
        raise auth.AuthError("email not verified by Okta")
    sub = claims.get("sub")
    if not sub:  # no durable account key -> can't identify the user; fail closed as 401
        raise auth.AuthError("Okta ID token has no subject (sub)")
    # Distinguish "groups claim absent" (app not emitting one) from "present but empty".
    # The former must NOT trigger a mass membership revoke on a misconfigured app.
    groups_present = "groups" in claims
    groups = claims.get("groups") or []
    if not isinstance(groups, list):
        groups = [groups]
    return {
        "sub": sub,
        "email": claims.get("email"),
        "name": claims.get("name") or claims.get("preferred_username"),
        "email_verified": claims.get("email_verified", True),
        "groups": [str(g) for g in groups],
        "groups_present": groups_present,
    }


# --- SSO group → scope reconciliation --------------------------------------

def sync_okta_groups(conn, user_id: str, group_names, group_scope_map: dict) -> list[str]:
    """Reconcile a user's team memberships to match their current Okta groups.

    SSO OWNS exactly the teams that appear as VALUES in `group_scope_map`:
      - a mapped group present in the token  → active membership (team auto-
        provisioned on first sight so an admin needn't pre-create it);
      - a mapped team the user no longer has → membership revoked.
    Memberships to any team NOT in the map (invite-based joins) are left alone,
    so SSO and invites compose without clobbering each other.

    Returns the user's resulting authorized team scope ids."""
    managed_team_ids = set(group_scope_map.values())
    desired_team_ids = {
        group_scope_map[g] for g in (group_names or []) if g in group_scope_map
    }

    for team_id in sorted(desired_team_ids):
        # Auto-provision the team (its own single-team org) if it's new.
        org_id = f"org-{team_id}"
        conn.execute("insert into orgs(id,name) values(%s,%s) on conflict do nothing",
                     (org_id, team_id))
        conn.execute("insert into teams(id,org_id,name) values(%s,%s,%s) on conflict do nothing",
                     (team_id, org_id, team_id))
        conn.execute(
            "insert into memberships(user_id,org_id,team_id,role,status) "
            "values(%s,%s,%s,'member','active') "
            "on conflict (user_id,team_id) do update set status='active'",
            (user_id, org_id, team_id))

    # Revoke SSO-managed memberships the user no longer qualifies for.
    stale = managed_team_ids - desired_team_ids
    for team_id in sorted(stale):
        conn.execute(
            "update memberships set status='revoked' where user_id=%s and team_id=%s",
            (user_id, team_id))

    if managed_team_ids:
        tenancy._audit(conn, user_id, "okta.sync",
                       ",".join(sorted(tenancy.team_scope_id(t) for t in desired_team_ids)),
                       f"groups={sorted(set(group_names or []))}")
    return tenancy.authorized_team_scope_ids(conn, user_id)


# --- login ------------------------------------------------------------------

def login_with_okta(conn, id_token_str: str) -> dict:
    """Full server-side Okta login: verify the ID token, upsert the user, reconcile
    team membership from the token's `groups` claim, and issue a Lore session JWT.

    Returns {token, user_id, email, scopes, groups}. Raises auth.AuthError on a
    bad identity."""
    cfg = okta_config()
    identity = verify_okta_id_token(id_token_str, cfg["issuer"], cfg["client_id"])
    # Reuse the users table; `sub` is the durable account id (Okta subs and Google
    # subs live in disjoint namespaces, so the shared `id` key never collides).
    user_id = auth.upsert_user(conn, identity["sub"], identity["email"], identity["name"])
    if identity.get("groups_present"):
        scopes = sync_okta_groups(conn, user_id, identity["groups"], cfg["group_scope_map"])
    else:
        # No `groups` claim at all — the app isn't emitting one (common Okta setup
        # slip). Don't reconcile: leaving memberships untouched beats silently
        # revoking every SSO-managed team on a misconfiguration. Use what's on record.
        scopes = tenancy.authorized_team_scope_ids(conn, user_id)
    token = auth.issue_session_jwt(user_id)
    return {
        "token": token,
        "user_id": user_id,
        "email": identity["email"],
        "scopes": scopes,
        "groups": identity["groups"],
    }
