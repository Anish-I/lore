// Google desktop loopback (PKCE) — the pure, network-free pieces. The token
// exchange + localhost redirect need a live Google + browser (manual), so we only
// assert URL construction / PKCE / the scope override the Gmail connector relies on.
import { describe, it, expect } from 'vitest';
import google from '../lib/google-oauth';

const CFG = { client_id: '45207-test.apps.googleusercontent.com', client_secret: 'shh' };

describe('generatePkce', () => {
  it('produces a url-safe verifier and a distinct S256 challenge', () => {
    const { verifier, challenge } = google.generatePkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).not.toBe(verifier);
  });
});

describe('buildAuthUrl', () => {
  it('targets Google authorize with PKCE and the default sign-in scope', () => {
    const url = new URL(google.buildAuthUrl(CFG, 'http://127.0.0.1:5123/callback', 'chal', 'st8'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/auth');
    const q = url.searchParams;
    expect(q.get('client_id')).toBe('45207-test.apps.googleusercontent.com');
    expect(q.get('redirect_uri')).toBe('http://127.0.0.1:5123/callback');
    expect(q.get('response_type')).toBe('code');
    expect(q.get('code_challenge')).toBe('chal');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('state')).toBe('st8');
    expect(q.get('scope')).toBe('openid email profile');   // default: just sign-in
    expect(q.get('access_type')).toBe('offline');
    expect(q.get('include_granted_scopes')).toBe('true');  // keeps prior grants on incremental consent
  });

  it('honours a scope override so the Gmail connector can request gmail.readonly', () => {
    const gmailScope = 'openid email https://www.googleapis.com/auth/gmail.readonly';
    const url = new URL(google.buildAuthUrl(
      { ...CFG, scope: gmailScope }, 'http://127.0.0.1:1/callback', 'c', 's'));
    expect(url.searchParams.get('scope')).toBe(gmailScope);
    expect(url.searchParams.get('scope').split(' '))
      .toContain('https://www.googleapis.com/auth/gmail.readonly');
  });
});
