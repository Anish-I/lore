// Okta OIDC desktop "loopback" flow (PKCE) for the Lore Electron app.
//
// The Okta analog of ./google-oauth.js: opens the system browser to Okta's
// consent screen, runs a one-shot localhost HTTP server to catch the redirect,
// exchanges the auth code for tokens, and returns the Okta **id_token** — which
// main then POSTs to the Lore server (`/auth/okta`) to obtain a Lore session
// JWT. Groups → scope mapping happens server-side; nothing is trusted here.
//
// Endpoints derive from the Okta issuer (`{issuer}/v1/authorize`, `{issuer}/v1/token`).
// The `groups` scope is requested by default so the ID token carries the group
// claim `sync_okta_groups` reconciles against — override via clientCfg.scope
// (env OKTA_SCOPES) if the authorization server rejects an unknown scope.
//
// No external deps: Node http/https/crypto + Electron shell.openExternal.
'use strict';
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL, URLSearchParams } = require('url');

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// PKCE: a high-entropy verifier and its S256 challenge. Exported for unit testing.
function generatePkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// Trim a trailing slash so `${issuer}/v1/...` never doubles up.
function issuerBase(clientCfg) {
  return String(clientCfg.issuer || '').replace(/\/+$/, '');
}

// Decode a JWT's payload (claims) WITHOUT verifying the signature — the Lore
// server does the cryptographic verification. We use this only to read the
// `nonce` claim so the initiating client can bind the id_token to this flow.
function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) return {};
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
  } catch { return {}; }
}

function buildAuthUrl(clientCfg, redirectUri, challenge, state, nonce) {
  const u = new URL(clientCfg.auth_uri || `${issuerBase(clientCfg)}/v1/authorize`);
  const params = {
    client_id: clientCfg.client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: clientCfg.scope || 'openid email profile groups',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    prompt: 'select_account',
  };
  if (nonce) params.nonce = nonce;   // OIDC replay-binding (belt-and-suspenders over PKCE)
  u.search = new URLSearchParams(params).toString();
  return u.toString();
}

// Exchange the authorization code for tokens at Okta's token endpoint. Native
// clients use `none` + PKCE. Confidential clients must match the app integration's
// configured token_endpoint_auth_method (`client_secret_basic` or
// `client_secret_post`); Okta does not treat those methods as interchangeable.
function exchangeCode(clientCfg, code, verifier, redirectUri) {
  return new Promise((resolve, reject) => {
    const method = clientCfg.token_endpoint_auth_method
      || (clientCfg.client_secret ? 'client_secret_basic' : 'none');
    if (!['none', 'client_secret_basic', 'client_secret_post'].includes(method)) {
      reject(new Error(`unsupported Okta token endpoint auth method: ${method}`));
      return;
    }
    if (method !== 'none' && !clientCfg.client_secret) {
      reject(new Error(`Okta ${method} requires a client_secret`));
      return;
    }
    const params = {
      code,
      client_id: clientCfg.client_id,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    };
    const headers = { 'content-type': 'application/x-www-form-urlencoded' };
    if (method === 'client_secret_post') params.client_secret = clientCfg.client_secret;
    if (method === 'client_secret_basic') {
      delete params.client_id;
      headers.authorization = `Basic ${Buffer.from(`${clientCfg.client_id}:${clientCfg.client_secret}`).toString('base64')}`;
    }
    const body = new URLSearchParams(params).toString();
    const tokenUrl = new URL(clientCfg.token_uri || `${issuerBase(clientCfg)}/v1/token`);
    headers['content-length'] = Buffer.byteLength(body);
    const req = https.request(
      { method: 'POST', hostname: tokenUrl.hostname, port: tokenUrl.port || 443,
        path: `${tokenUrl.pathname}${tokenUrl.search}`, headers },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
          if (data.length > 1024 * 1024) req.destroy(new Error('Okta token response is too large'));
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode !== 200 || json.error) {
              return reject(new Error(`token exchange failed: ${json.error_description || json.error || res.statusCode}`));
            }
            resolve(json); // { id_token, access_token, refresh_token?, expires_in }
          } catch (e) { reject(e); }
        });
      });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Okta token exchange timed out')));
    req.write(body);
    req.end();
  });
}

// Run the full loopback flow. `openExternal(url)` opens the system browser
// (pass Electron's shell.openExternal). Resolves to the token response.
// `port` fixes the loopback port (0 = ephemeral). Okta native apps accept any
// 127.0.0.1 port, so ephemeral is fine; a fixed port is supported for parity and
// for setups that must register one exact redirect URI.
function runLoopbackFlow(clientCfg, openExternal, { timeoutMs = 180000, port = 0 } = {}) {
  const { verifier, challenge } = generatePkce();
  const state = b64url(crypto.randomBytes(16));
  const nonce = b64url(crypto.randomBytes(16));

  return new Promise((resolve, reject) => {
    // The loopback redirect URI — captured once the server is listening (below) and
    // reused for the token exchange. It must be read BEFORE cleanup(): server.close()
    // makes server.address() null, and the token endpoint requires the redirect_uri
    // to match the one sent to /authorize exactly, so we keep a single source of truth.
    let redirectUri;
    // Ephemeral loopback port — Okta allows a 127.0.0.1 redirect for native apps;
    // register http://127.0.0.1/callback (any port) as a redirect URI in the app.
    let callbackHandled = false;
    const respond = (res, status, heading, detail) => {
      res.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end('<!doctype html><html><body style="font-family:sans-serif;text-align:center;margin-top:80px">'
        + `<h2>${heading}</h2><p>${detail}</p></body></html>`);
    };
    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url, redirectUri || 'http://127.0.0.1');
        if (reqUrl.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
        if (callbackHandled) {
          respond(res, 409, 'Lore sign-in already handled', 'Return to Lore to continue.');
          return;
        }
        callbackHandled = true;
        const err = reqUrl.searchParams.get('error');
        const code = reqUrl.searchParams.get('code');
        const gotState = reqUrl.searchParams.get('state');
        if (err) throw new Error(`Okta returned error: ${err}`);
        if (gotState !== state) throw new Error('state mismatch (possible CSRF)');
        if (!code) throw new Error('no authorization code in callback');
        const tokens = await exchangeCode(clientCfg, code, verifier, redirectUri);
        // Bind the id_token to THIS auth request: the nonce we sent must come back
        // in the token. Combined with the server's signature verification, this
        // rejects a replayed/injected id_token that wasn't minted for our flow.
        const claims = decodeJwtPayload(tokens.id_token);
        if (!claims.nonce || claims.nonce !== nonce) {
          throw new Error('nonce mismatch (possible token replay)');
        }
        respond(res, 200, 'Lore sign-in complete', 'You can close this tab and return to Lore.');
        cleanup();
        resolve(tokens);
      } catch (e) {
        if (!res.headersSent) {
          respond(res, 400, 'Lore sign-in failed', 'Return to Lore and try again.');
        }
        cleanup();
        reject(e);
      }
    });

    const timer = setTimeout(() => { cleanup(); reject(new Error('sign-in timed out')); }, timeoutMs);
    function cleanup() { clearTimeout(timer); try { server.close(); } catch { /* ignore */ } }

    server.on('error', (e) => { cleanup(); reject(e); });
    server.listen(port, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
      Promise.resolve(openExternal(buildAuthUrl(clientCfg, redirectUri, challenge, state, nonce)))
        .catch((e) => { cleanup(); reject(e); });
    });
  });
}

module.exports = { generatePkce, buildAuthUrl, exchangeCode, runLoopbackFlow };
