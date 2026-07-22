// Okta desktop loopback flow — REAL end-to-end, no live tenant.
//
// tests/okta-oauth.test.js only covers the pure URL/PKCE bits; the browser
// round-trip, the localhost callback server, the code->token exchange, and the
// nonce/state binding are exactly what the manual plan (Parts 3.3-3.4, 5.2)
// tests by hand. This drives the actual runLoopbackFlow against a mock Okta
// served over HTTPS (a self-signed 127.0.0.1 cert), so every branch runs for
// real: PKCE challenge, state echo, code exchange, id_token decode, nonce check.
//
// The only thing faked is the human clicking "approve": `browser()` follows
// Okta's 302 to the loopback callback the way a real browser would.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import https from 'https';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { URL } from 'url';
import okta from '../lib/okta-oauth';

function b64url(s) {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// A well-formed (but unsigned) JWT — the desktop only base64-decodes the payload
// to read `nonce`; the Lore server does the cryptographic verification. The
// server-side signature path is covered for real in core/tests/test_okta_verify_e2e.py.
function makeIdToken(payload) {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'mock' }));
  const body = b64url(JSON.stringify(payload));
  return `${head}.${body}.${b64url('mock-sig')}`;
}

// Per-test control over how the mock Okta behaves.
let scenario;
function resetScenario() { scenario = { seenAuth: null, sentNonce: null }; }

let server, port, tmpDir, savedCa;

beforeAll(async () => {
  // Self-signed cert for 127.0.0.1 so exchangeCode's https.request trusts us
  // WITHOUT globally disabling TLS verification (we add the cert to the agent CA).
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okta-loopback-'));
  const keyPath = path.join(tmpDir, 'key.pem');
  const certPath = path.join(tmpDir, 'cert.pem');
  execSync(
    `openssl req -x509 -newkey rsa:2048 -nodes -keyout "${keyPath}" -out "${certPath}" ` +
    `-days 1 -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1"`,
    { stdio: 'ignore' });
  const cert = fs.readFileSync(certPath);
  savedCa = https.globalAgent.options.ca;
  https.globalAgent.options.ca = cert;   // trust our mock, nothing else changes

  server = https.createServer(
    { key: fs.readFileSync(keyPath), cert },
    (req, res) => {
      const u = new URL(req.url, `https://127.0.0.1:${port}`);
      if (u.pathname.endsWith('/v1/authorize')) {
        scenario.seenAuth = Object.fromEntries(u.searchParams);
        scenario.sentNonce = u.searchParams.get('nonce');
        const redirect = u.searchParams.get('redirect_uri');
        const state = scenario.forceState != null ? scenario.forceState : u.searchParams.get('state');
        const loc = scenario.authError
          ? `${redirect}?error=${scenario.authError}`
          : `${redirect}?code=THE_AUTH_CODE&state=${encodeURIComponent(state)}`;
        res.writeHead(302, { location: loc });
        res.end();
      } else if (u.pathname.endsWith('/v1/token')) {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (scenario.tokenError) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'bad code' }));
            return;
          }
          const nonce = scenario.forceNonce != null ? scenario.forceNonce : scenario.sentNonce;
          const id_token = makeIdToken({ sub: '00u-e2e', email: 'e2e@corp.com', name: 'E2E User', nonce });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id_token, access_token: 'at', token_type: 'Bearer', expires_in: 3600 }));
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

afterAll(() => {
  https.globalAgent.options.ca = savedCa;
  try { server && server.close(); } catch { /* ignore */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function cfg() {
  const base = `https://127.0.0.1:${port}/oauth2/default`;
  return {
    issuer: base,
    client_id: '0oa-e2e-client',
    client_secret: 'test-secret',            // exercise the confidential-client branch
    auth_uri: `${base}/v1/authorize`,
    token_uri: `${base}/v1/token`,
  };
}

// Stand in for the human + system browser: fetch the authorize URL and follow
// Okta's 302 to the loopback callback, exactly as a real browser would.
function browser(authUrl) {
  https.get(authUrl, (res) => {
    res.resume();
    const loc = res.headers.location;
    if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
      http.get(loc, (r2) => r2.resume()).on('error', () => {});
    }
  }).on('error', () => {});
}

describe('okta loopback flow (real, mock-Okta over HTTPS)', () => {
  beforeAll(resetScenario);

  it('completes the full PKCE loopback and returns a nonce-bound id_token', async () => {
    resetScenario();
    const tokens = await okta.runLoopbackFlow(cfg(), browser, { timeoutMs: 8000 });
    expect(tokens.id_token).toBeTruthy();

    // The authorize request carried real PKCE + a nonce (not a stray "undefined").
    const a = scenario.seenAuth;
    expect(a.client_id).toBe('0oa-e2e-client');
    expect(a.response_type).toBe('code');
    expect(a.code_challenge_method).toBe('S256');
    expect(a.code_challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.nonce).toMatch(/^[A-Za-z0-9_-]+$/);

    // The id_token we accepted is bound to the nonce we sent.
    const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64').toString('utf8'));
    expect(claims.nonce).toBe(a.nonce);
  });

  it('rejects a state mismatch (CSRF guard)', async () => {
    resetScenario();
    scenario.forceState = 'attacker-supplied-state';
    await expect(okta.runLoopbackFlow(cfg(), browser, { timeoutMs: 8000 }))
      .rejects.toThrow(/state mismatch/i);
  });

  it('rejects a replayed/injected id_token whose nonce does not match', async () => {
    resetScenario();
    scenario.forceNonce = 'nonce-from-a-different-flow';
    await expect(okta.runLoopbackFlow(cfg(), browser, { timeoutMs: 8000 }))
      .rejects.toThrow(/nonce mismatch/i);
  });

  it('surfaces an Okta error redirect cleanly (no crash)', async () => {
    resetScenario();
    scenario.authError = 'access_denied';
    await expect(okta.runLoopbackFlow(cfg(), browser, { timeoutMs: 8000 }))
      .rejects.toThrow(/Okta returned error: access_denied/i);
  });

  it('surfaces a token-exchange failure cleanly', async () => {
    resetScenario();
    scenario.tokenError = true;
    await expect(okta.runLoopbackFlow(cfg(), browser, { timeoutMs: 8000 }))
      .rejects.toThrow(/token exchange failed/i);
  });
});
