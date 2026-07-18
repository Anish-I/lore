// Okta desktop loopback (PKCE) — the pure, network-free pieces. The token
// exchange and the localhost redirect server need a live Okta + browser, so we
// only assert the URL construction and PKCE invariants here.
import { describe, it, expect } from 'vitest';
import okta from '../lib/okta-oauth';

const CFG = { issuer: 'https://dev-test.okta.com/oauth2/default', client_id: '0oatestclientid' };

describe('generatePkce', () => {
  it('produces a url-safe verifier and a distinct S256 challenge', () => {
    const { verifier, challenge } = okta.generatePkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).not.toBe(verifier); // challenge is a hash, not the raw verifier
  });
});

describe('buildAuthUrl', () => {
  it('targets the issuer authorize endpoint with PKCE + the groups scope', () => {
    const url = new URL(okta.buildAuthUrl(CFG, 'http://127.0.0.1:5123/callback', 'chal', 'st8'));
    expect(url.origin + url.pathname).toBe('https://dev-test.okta.com/oauth2/default/v1/authorize');
    const q = url.searchParams;
    expect(q.get('client_id')).toBe('0oatestclientid');
    expect(q.get('redirect_uri')).toBe('http://127.0.0.1:5123/callback');
    expect(q.get('response_type')).toBe('code');
    expect(q.get('code_challenge')).toBe('chal');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('state')).toBe('st8');
    // groups must be requested so the id_token carries the claim we map to scopes.
    expect(q.get('scope').split(' ')).toContain('groups');
  });

  it('tolerates a trailing slash on the issuer and honours a scope override', () => {
    const url = new URL(okta.buildAuthUrl(
      { ...CFG, issuer: CFG.issuer + '/', scope: 'openid email' }, 'http://127.0.0.1:1/callback', 'c', 's'));
    expect(url.pathname).toBe('/oauth2/default/v1/authorize'); // no doubled slash
    expect(url.searchParams.get('scope')).toBe('openid email');
  });
});
