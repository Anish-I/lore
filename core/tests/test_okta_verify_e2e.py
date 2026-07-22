"""End-to-end Okta ID-token verification with REAL RS256 crypto — no monkeypatch.

The rest of the suite (test_auth.py) stubs `verify_okta_id_token`, so the actual
signature check, JWKS fetch, issuer/audience enforcement, and RS256-only guard are
never exercised. That is exactly what the manual test plan (Parts 3–5) covers by
hand against a live Okta. This file automates it against a local JWKS server:

  * a real RSA keypair signs a real ID token,
  * a throwaway HTTP server publishes the matching JWKS at `{issuer}/v1/keys`,
  * `okta.verify_okta_id_token` / `okta.login_with_okta` run for real — PyJWKClient
    fetches our keys and PyJWT verifies the RS256 signature, issuer, and audience.

Positive path proves group -> team-scope mapping on a genuinely verified token
(plan Part 4). Negatives prove the server fails closed on a forged/expired/wrong
token and rejects alg-confusion (plan Part 5.2).
"""
import json
import threading
import http.server

import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

import jwt
from jwt.algorithms import RSAAlgorithm

from lore import db, tenancy, auth, okta


_KID = "lore-e2e-key-1"


def _make_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _jwks_for(private_key) -> dict:
    """Build the JWKS document Okta would publish for this key."""
    raw = RSAAlgorithm.to_jwk(private_key.public_key())
    jwk = json.loads(raw) if isinstance(raw, str) else dict(raw)
    jwk.update({"kid": _KID, "use": "sig", "alg": "RS256"})
    return {"keys": [jwk]}


class _JwksServer:
    """A local stand-in for Okta's JWKS endpoint at `{issuer}/v1/keys`."""

    def __init__(self, jwks: dict):
        body = json.dumps(jwks).encode()

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                if self.path.endswith("/v1/keys"):
                    self.send_response(200)
                    self.send_header("content-type", "application/json")
                    self.send_header("content-length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                else:
                    self.send_response(404)
                    self.end_headers()

            def log_message(self, *a):  # silence the default stderr spam
                pass

        self._srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self._srv.server_address[1]
        self._t = threading.Thread(target=self._srv.serve_forever, daemon=True)

    def __enter__(self):
        self._t.start()
        return self

    def __exit__(self, *a):
        self._srv.shutdown()
        self._srv.server_close()


def _mint(private_key, issuer, aud, *, sub="00u-e2e", groups=("Engineering",),
          groups_present=True, exp_delta=3600, alg="RS256", email="e2e@corp.com"):
    """Mint a signed ID token the way Okta would. `exp_delta<0` => already expired."""
    import time
    now = int(time.time())
    claims = {
        "iss": issuer, "aud": aud, "sub": sub,
        "email": email, "email_verified": True, "name": "E2E User",
        "iat": now, "exp": now + exp_delta, "nonce": "n-abc",
    }
    if groups_present:
        claims["groups"] = list(groups)
    if alg == "none":
        return jwt.encode(claims, key="", algorithm="none")
    return jwt.encode(claims, private_key, algorithm=alg, headers={"kid": _KID})


@pytest.fixture
def okta_env(monkeypatch):
    """A live JWKS server + a keypair, with OKTA_* env pointed at it.

    Yields (issuer, client_id, private_key). PyJWKClient caches one client per
    issuer process-wide, so we clear that cache to keep tests independent."""
    key = _make_key()
    with _JwksServer(_jwks_for(key)) as srv:
        issuer = f"http://127.0.0.1:{srv.port}/oauth2/default"
        client_id = "0oa-e2e-clientid"
        monkeypatch.setenv("OKTA_ISSUER", issuer)
        monkeypatch.setenv("OKTA_CLIENT_ID", client_id)
        monkeypatch.setenv("OKTA_GROUP_SCOPE_MAP", '{"Engineering":"t-eng"}')
        okta._jwks_clients.clear()
        try:
            yield issuer, client_id, key
        finally:
            okta._jwks_clients.clear()


def test_verify_real_rs256_token_returns_identity(okta_env):
    issuer, client_id, key = okta_env
    token = _mint(key, issuer, client_id)
    ident = okta.verify_okta_id_token(token, issuer, client_id)
    assert ident["sub"] == "00u-e2e"
    assert ident["email"] == "e2e@corp.com"
    assert ident["groups"] == ["Engineering"]
    assert ident["groups_present"] is True


def test_login_with_okta_maps_group_to_team_scope_end_to_end(okta_env):
    """Plan Part 4, automated: a genuinely verified token's Okta group becomes a
    Lore team scope — derived server-side, never sent by the client."""
    issuer, client_id, key = okta_env
    conn = db.connect()
    db.bootstrap_schema(conn)
    tenancy.bootstrap_tenancy(conn)

    token = _mint(key, issuer, client_id, sub="00u-map")
    result = okta.login_with_okta(conn, token)

    assert result["user_id"] == "00u-map"
    assert result["scopes"] == ["team:t-eng"]        # from group -> map, not client
    assert result["groups"] == ["Engineering"]
    # The issued Lore session JWT verifies back to the same user.
    assert auth.verify_session_jwt(result["token"])["sub"] == "00u-map"


def test_revoke_on_group_removal_end_to_end(okta_env):
    """Plan Part 4.2, automated: drop the group in the next (real) token and the
    SSO-managed team scope is revoked."""
    issuer, client_id, key = okta_env
    conn = db.connect()
    db.bootstrap_schema(conn)
    tenancy.bootstrap_tenancy(conn)

    first = okta.login_with_okta(conn, _mint(key, issuer, client_id, sub="00u-rev"))
    assert first["scopes"] == ["team:t-eng"]

    # Next login: still emits a groups claim, but Engineering is gone.
    second = okta.login_with_okta(
        conn, _mint(key, issuer, client_id, sub="00u-rev", groups=()))
    assert second["scopes"] == []
    status = conn.execute(
        "select status from memberships where user_id='00u-rev' and team_id='t-eng'"
    ).fetchone()
    assert status[0] == "revoked"


def test_wrong_audience_is_rejected(okta_env):
    issuer, client_id, key = okta_env
    token = _mint(key, issuer, aud="some-other-app")
    with pytest.raises(auth.AuthError):
        okta.verify_okta_id_token(token, issuer, client_id)


def test_wrong_issuer_is_rejected(okta_env):
    issuer, client_id, key = okta_env
    token = _mint(key, "https://evil.example.com/oauth2/default", client_id)
    with pytest.raises(auth.AuthError):
        okta.verify_okta_id_token(token, issuer, client_id)


def test_expired_token_is_rejected(okta_env):
    issuer, client_id, key = okta_env
    token = _mint(key, issuer, client_id, exp_delta=-30)
    with pytest.raises(auth.AuthError):
        okta.verify_okta_id_token(token, issuer, client_id)


def test_tampered_signature_is_rejected(okta_env):
    issuer, client_id, key = okta_env
    token = _mint(key, issuer, client_id)
    head, payload, sig = token.split(".")
    forged = ".".join([head, payload, sig[:-4] + ("AAAA" if not sig.endswith("AAAA") else "BBBB")])
    with pytest.raises(auth.AuthError):
        okta.verify_okta_id_token(forged, issuer, client_id)


def test_alg_none_is_rejected(okta_env):
    """alg=none / alg-confusion must never pass — RS256 is enforced explicitly."""
    issuer, client_id, key = okta_env
    token = _mint(key, issuer, client_id, alg="none")
    with pytest.raises(auth.AuthError):
        okta.verify_okta_id_token(token, issuer, client_id)


def test_signed_by_a_different_key_is_rejected(okta_env):
    """A token signed by a key that isn't in the published JWKS is rejected —
    proves the signature is actually checked against Okta's keys, not just parsed."""
    issuer, client_id, _key = okta_env
    attacker_key = _make_key()          # not the key the JWKS server publishes
    token = _mint(attacker_key, issuer, client_id)
    with pytest.raises(auth.AuthError):
        okta.verify_okta_id_token(token, issuer, client_id)
