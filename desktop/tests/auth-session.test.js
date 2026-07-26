import { describe, it, expect } from 'vitest';
import authSession from '../lib/auth-session';

function jwt(exp) {
  return `head.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.sig`;
}

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

function harness(fetchImpl, initial) {
  let stored = initial;
  let clears = 0;
  const manager = authSession.createAuthSessionManager({
    fetchImpl,
    backendUrl: () => 'http://127.0.0.1:8099',
    localHeaders: () => ({ 'X-Lore-Token': 'local-token' }),
    loadSession: () => stored,
    saveSession: (next) => { stored = next; },
    clearSession: () => { stored = null; clears += 1; },
  });
  return { manager, stored: () => stored, clears: () => clears };
}

describe('desktop refresh session manager', () => {
  it('rejects Electron basic_text as secure credential storage', () => {
    const storage = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'basic_text',
    };
    expect(authSession.secureCredentialStorageAvailable(storage, 'linux')).toBe(false);
    expect(authSession.secureCredentialStorageAvailable(storage, 'win32')).toBe(true);
    expect(authSession.secureCredentialStorageAvailable({
      ...storage,
      getSelectedStorageBackend: () => 'gnome_libsecret',
    }, 'linux')).toBe(true);
    expect(authSession.secureCredentialStorageAvailable({
      isEncryptionAvailable: () => false,
    }, 'win32')).toBe(false);
  });

  it('detects access tokens that are expired or near expiry', () => {
    expect(authSession.jwtExpiresSoon(jwt(1100), 1000, 60)).toBe(false);
    expect(authSession.jwtExpiresSoon(jwt(1050), 1000, 60)).toBe(true);
    expect(authSession.jwtExpiresSoon('broken', 1000, 60)).toBe(true);
  });

  it('rotates once for concurrent refresh callers and persists the replacement', async () => {
    let calls = 0;
    const initial = { token: jwt(1), refresh_token: 'lore_rt_old', email: 'a@example.com' };
    const h = harness(async (url, opts) => {
      calls += 1;
      expect(url.endsWith('/auth/refresh')).toBe(true);
      expect(opts.headers['X-Lore-Token']).toBe('local-token');
      return jsonResponse(200, {
        token: jwt(9999999999),
        refresh_token: 'lore_rt_new',
        scopes: ['team:a'],
      });
    }, initial);

    const [a, b] = await Promise.all([
      h.manager.refresh(initial),
      h.manager.refresh(initial),
    ]);
    expect(calls).toBe(1);
    expect(a.refresh_token).toBe('lore_rt_new');
    expect(b.refresh_token).toBe('lore_rt_new');
    expect(h.stored().scopes).toEqual(['team:a']);
  });

  it('retries an authenticated request once after a 401', async () => {
    const seen = [];
    const initial = { token: jwt(9999999999), refresh_token: 'lore_rt_old' };
    const h = harness(async (url, opts) => {
      seen.push({ url, authorization: opts.headers.Authorization });
      if (url.endsWith('/auth/refresh')) {
        return jsonResponse(200, {
          token: jwt(9999999999),
          refresh_token: 'lore_rt_new',
          scopes: [],
        });
      }
      if (seen.filter((x) => x.url.endsWith('/teams')).length === 1) {
        return jsonResponse(401, { detail: 'expired' });
      }
      return jsonResponse(200, { teams: [] });
    }, initial);

    const response = await h.manager.authenticatedFetch('/teams');
    expect(response.status).toBe(200);
    expect(seen.map((x) => x.url.split('/').pop())).toEqual(['teams', 'refresh', 'teams']);
    expect(seen[0].authorization).toBe(`Bearer ${initial.token}`);
    expect(seen[2].authorization).toBe(`Bearer ${h.stored().token}`);
  });

  it('clears a terminally rejected refresh token but preserves it on network failure', async () => {
    const rejected = harness(
      async () => jsonResponse(401, { detail: 'invalid refresh token' }),
      { token: jwt(1), refresh_token: 'lore_rt_rejected' },
    );
    expect(await rejected.manager.refresh(rejected.stored())).toBeNull();
    expect(rejected.stored()).toBeNull();
    expect(rejected.clears()).toBe(1);

    const offline = harness(
      async () => { throw new Error('offline'); },
      { token: jwt(1), refresh_token: 'lore_rt_offline' },
    );
    expect(await offline.manager.refresh(offline.stored())).toBeNull();
    expect(offline.stored().refresh_token).toBe('lore_rt_offline');
    expect(offline.clears()).toBe(0);

    const localTokenMismatch = harness(
      async () => jsonResponse(401, { detail: 'Local API token required.' }),
      { token: jwt(1), refresh_token: 'lore_rt_still_valid' },
    );
    expect(await localTokenMismatch.manager.refresh(localTokenMismatch.stored())).toBeNull();
    expect(localTokenMismatch.stored().refresh_token).toBe('lore_rt_still_valid');
    expect(localTokenMismatch.clears()).toBe(0);

    const malformedSuccess = harness(
      async () => jsonResponse(200, { token: 'malformed' }),
      { token: jwt(1), refresh_token: 'lore_rt_consumed' },
    );
    expect(await malformedSuccess.manager.refresh(malformedSuccess.stored())).toBeNull();
    expect(malformedSuccess.stored()).toBeNull();
    expect(malformedSuccess.clears()).toBe(1);
  });

  it('revokes a replacement and clears the consumed session when persistence fails', async () => {
    let stored = { token: jwt(1), refresh_token: 'lore_rt_old_write' };
    const revoked = [];
    const manager = authSession.createAuthSessionManager({
      fetchImpl: async (url, opts) => {
        const body = JSON.parse(opts.body);
        if (url.endsWith('/auth/refresh')) {
          return jsonResponse(200, {
            token: jwt(9999999999),
            refresh_token: 'lore_rt_new_write',
            scopes: [],
          });
        }
        revoked.push(body.refresh_token);
        return jsonResponse(200, { ok: true });
      },
      backendUrl: 'http://127.0.0.1:8099',
      localHeaders: {},
      loadSession: () => stored,
      saveSession: () => { throw new Error('disk full'); },
      clearSession: () => { stored = null; },
    });

    expect(await manager.refresh(stored)).toBeNull();
    expect(stored).toBeNull();
    expect(revoked).toEqual(['lore_rt_new_write']);
  });

  it('clears locally before logout and revokes the server-side refresh token', async () => {
    let requestBody;
    const h = harness(async (url, opts) => {
      expect(h.stored()).toBeNull();
      expect(url.endsWith('/auth/logout')).toBe(true);
      requestBody = JSON.parse(opts.body);
      return jsonResponse(200, { ok: true });
    }, { token: jwt(9999999999), refresh_token: 'lore_rt_logout' });

    expect(await h.manager.logout()).toEqual({ ok: true });
    expect(requestBody).toEqual({ refresh_token: 'lore_rt_logout' });
    expect(h.stored()).toBeNull();
  });

  it('does not resurrect a session when logout races an in-flight refresh', async () => {
    let finishRefresh;
    const revoked = [];
    const initial = { token: jwt(1), refresh_token: 'lore_rt_old_race' };
    const h = harness(async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (url.endsWith('/auth/refresh')) {
        return new Promise((resolve) => { finishRefresh = resolve; });
      }
      revoked.push(body.refresh_token);
      return jsonResponse(200, { ok: true });
    }, initial);

    const refreshing = h.manager.refresh(initial);
    while (!finishRefresh) await new Promise((resolve) => setTimeout(resolve, 0));
    await h.manager.logout();
    finishRefresh(jsonResponse(200, {
      token: jwt(9999999999),
      refresh_token: 'lore_rt_new_race',
      scopes: [],
    }));

    expect(await refreshing).toBeNull();
    expect(h.stored()).toBeNull();
    expect(revoked).toEqual(['lore_rt_old_race', 'lore_rt_new_race']);
  });
});
