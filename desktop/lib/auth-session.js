'use strict';

const { authedBackendHeaders } = require('./backend-auth');

function jwtExpiresSoon(token, nowSeconds = Math.floor(Date.now() / 1000), skewSeconds = 60) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    return !Number.isFinite(payload.exp) || payload.exp <= nowSeconds + skewSeconds;
  } catch {
    return true;
  }
}

function validRefreshBundle(body) {
  return body
    && typeof body.token === 'string'
    && body.token.split('.').length === 3
    && body.token.length <= 20000
    && typeof body.refresh_token === 'string'
    && body.refresh_token.startsWith('lore_rt_')
    && body.refresh_token.length <= 1024;
}

function secureCredentialStorageAvailable(storage, platform = process.platform) {
  if (!storage || !storage.isEncryptionAvailable()) return false;
  if (
    platform === 'linux'
    && typeof storage.getSelectedStorageBackend === 'function'
    && storage.getSelectedStorageBackend() === 'basic_text'
  ) {
    return false;
  }
  return true;
}

function createAuthSessionManager({
  fetchImpl,
  backendUrl,
  localHeaders,
  loadSession,
  saveSession,
  clearSession,
  waitUntilReady = async () => {},
}) {
  let refreshPromise = null;
  const baseUrl = () => String(typeof backendUrl === 'function' ? backendUrl() : backendUrl).replace(/\/+$/, '');
  const local = () => (typeof localHeaders === 'function' ? localHeaders() : localHeaders) || {};

  async function revokeReplacement(refreshToken) {
    try {
      await fetchImpl(`${baseUrl()}/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...local() },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
    } catch { /* best effort: the server-side token still expires */ }
  }

  async function refresh(expectedSession = loadSession()) {
    if (!expectedSession || !expectedSession.refresh_token) return null;
    if (refreshPromise) return refreshPromise;
    const expectedToken = expectedSession.refresh_token;

    refreshPromise = (async () => {
      try {
        await waitUntilReady();
        const response = await fetchImpl(`${baseUrl()}/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...local() },
          body: JSON.stringify({ refresh_token: expectedToken }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !validRefreshBundle(body)) {
          const terminalRefreshFailure = response.status === 401
            && /refresh token/i.test(String(body && body.detail || ''));
          // A malformed success may already have consumed the old token. Treat it
          // as terminal too, otherwise the desktop retains a session that can
          // never refresh again.
          if (terminalRefreshFailure || response.ok) {
            const current = loadSession();
            if (current && current.refresh_token === expectedToken) clearSession();
          }
          return null;
        }

        // Logout or another account switch may have happened while the request
        // was in flight. Never resurrect that old session; revoke the replacement.
        const current = loadSession();
        if (!current || current.refresh_token !== expectedToken) {
          await revokeReplacement(body.refresh_token);
          return null;
        }
        const updated = {
          ...current,
          token: body.token,
          refresh_token: body.refresh_token,
          scopes: Array.isArray(body.scopes) ? body.scopes : current.scopes,
        };
        try {
          saveSession(updated);
        } catch {
          // The server already consumed expectedToken. Do not leave that dead
          // session on disk or leak the replacement we failed to protect.
          await revokeReplacement(body.refresh_token);
          const latest = loadSession();
          if (latest && latest.refresh_token === expectedToken) clearSession();
          return null;
        }
        return updated;
      } catch {
        // Network/backend failures are recoverable. Preserve the encrypted token
        // so a later retry can restore the session.
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  async function usableSession() {
    const current = loadSession();
    if (!current || !current.token) return { session: null, refreshed: false };
    if (!current.refresh_token || !jwtExpiresSoon(current.token)) {
      return { session: current, refreshed: false };
    }
    const renewed = await refresh(current);
    return { session: renewed || loadSession(), refreshed: Boolean(renewed) };
  }

  async function authenticatedFetch(pathname, opts = {}) {
    await waitUntilReady();
    const initial = await usableSession();
    if (!initial.session || !initial.session.token) return null;

    const request = (session) => fetchImpl(`${baseUrl()}${pathname}`, {
      ...opts,
      headers: authedBackendHeaders(local(), session.token, opts.headers),
    });
    let response = await request(initial.session);
    if (response.status === 401 && initial.session.refresh_token && !initial.refreshed) {
      const renewed = await refresh(initial.session);
      if (renewed) response = await request(renewed);
    }
    return response;
  }

  async function logout() {
    const current = loadSession();
    clearSession();
    if (!current || !current.refresh_token) return { ok: true };
    try {
      await waitUntilReady();
      await fetchImpl(`${baseUrl()}/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...local() },
        body: JSON.stringify({ refresh_token: current.refresh_token }),
      });
    } catch { /* local sign-out succeeds even while offline */ }
    return { ok: true };
  }

  return { authenticatedFetch, refresh, logout };
}

module.exports = {
  createAuthSessionManager,
  jwtExpiresSoon,
  secureCredentialStorageAvailable,
  validRefreshBundle,
};
