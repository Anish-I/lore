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

function buildAuthUrl(clientCfg, redirectUri, challenge, state) {
  const u = new URL(clientCfg.auth_uri || `${issuerBase(clientCfg)}/v1/authorize`);
  u.search = new URLSearchParams({
    client_id: clientCfg.client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: clientCfg.scope || 'openid email profile groups',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    prompt: 'select_account',
  }).toString();
  return u.toString();
}

// Exchange the authorization code for tokens at Okta's token endpoint. A native
// (public) client has no secret and relies on PKCE; a confidential client sends
// client_secret too — both work because Okta accepts the code_verifier either way.
function exchangeCode(clientCfg, code, verifier, redirectUri) {
  return new Promise((resolve, reject) => {
    const params = {
      code,
      client_id: clientCfg.client_id,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    };
    if (clientCfg.client_secret) params.client_secret = clientCfg.client_secret;
    const body = new URLSearchParams(params).toString();
    const tokenUrl = new URL(clientCfg.token_uri || `${issuerBase(clientCfg)}/v1/token`);
    const req = https.request(
      { method: 'POST', hostname: tokenUrl.hostname, port: tokenUrl.port || 443, path: tokenUrl.pathname,
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
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
    req.write(body);
    req.end();
  });
}

// Run the full loopback flow. `openExternal(url)` opens the system browser
// (pass Electron's shell.openExternal). Resolves to the token response.
function runLoopbackFlow(clientCfg, openExternal, { timeoutMs = 180000 } = {}) {
  const { verifier, challenge } = generatePkce();
  const state = b64url(crypto.randomBytes(16));

  return new Promise((resolve, reject) => {
    // Ephemeral loopback port — Okta allows a 127.0.0.1 redirect for native apps;
    // register http://127.0.0.1/callback (any port) as a redirect URI in the app.
    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url, `http://127.0.0.1:${server.address().port}`);
        if (reqUrl.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
        const err = reqUrl.searchParams.get('error');
        const code = reqUrl.searchParams.get('code');
        const gotState = reqUrl.searchParams.get('state');
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><body style="font-family:sans-serif;text-align:center;margin-top:80px">'
              + '<h2>Lore sign-in complete</h2><p>You can close this tab and return to Lore.</p></body></html>');
        cleanup();
        if (err) return reject(new Error(`Okta returned error: ${err}`));
        if (gotState !== state) return reject(new Error('state mismatch (possible CSRF)'));
        if (!code) return reject(new Error('no authorization code in callback'));
        const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
        const tokens = await exchangeCode(clientCfg, code, verifier, redirectUri);
        resolve(tokens);
      } catch (e) { cleanup(); reject(e); }
    });

    const timer = setTimeout(() => { cleanup(); reject(new Error('sign-in timed out')); }, timeoutMs);
    function cleanup() { clearTimeout(timer); try { server.close(); } catch { /* ignore */ } }

    server.on('error', (e) => { cleanup(); reject(e); });
    server.listen(0, '127.0.0.1', () => {
      const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
      openExternal(buildAuthUrl(clientCfg, redirectUri, challenge, state));
    });
  });
}

module.exports = { generatePkce, buildAuthUrl, exchangeCode, runLoopbackFlow };
