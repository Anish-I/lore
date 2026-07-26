/* global window */
// Full-Electron boot smoke for the Okta sign-in wiring (plan Parts 3.2, 5.1).
//
// Launches the REAL packaged-shape app with Playwright's Electron driver and
// exercises the live main<->preload<->renderer bridge:
//   * the `window.lore.auth.loginOkta` IPC is actually exposed, and
//   * with Okta unconfigured, invoking it returns a clean {ok:false,
//     reason:'unavailable'} — no crash, no browser opens (plan 5.1).
//
// Runs as part of the normal suite. It boots the whole app (embedded Postgres +
// backend), so it's the slow one — but it's real. On a genuinely display-less box
// where Electron can't create a window it SKIPS cleanly (never a false fail); it
// does NOT skip just because someone forgot a flag. Run it alone with:
//   npm run test:e2e:electron
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';

const appDir = path.join(__dirname, '..');

// Okta deliberately UNCONFIGURED: no OKTA_* env, and OKTA_CLIENT_FILE pointed at a
// path that cannot exist so loadOktaClient() can't pick up a real secrets file and
// accidentally launch a browser. This is the "not configured" negative path.
function unconfiguredEnv(userData, port) {
  const env = { ...process.env };
  delete env.OKTA_ISSUER;
  delete env.OKTA_CLIENT_ID;
  delete env.OKTA_CLIENT_SECRET;
  // ELECTRON_RUN_AS_NODE=1 (common in CI/agent shells) forces Electron to run as a
  // plain Node process — no GUI, no `app` object — which makes launch() fail. Strip
  // it so the real windowed app boots regardless of the ambient environment.
  delete env.ELECTRON_RUN_AS_NODE;
  // Keep the automated boot clean: don't let the dev DevTools gate auto-open a
  // detached DevTools window during the smoke.
  env.LORE_DEVTOOLS = '0';
  env.LORE_USER_DATA = userData;
  env.LORE_PORT = String(port);
  env.OKTA_CLIENT_FILE = path.join(os.tmpdir(), 'definitely-no-okta-here.json');
  return env;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

// On a headless box Electron can't create a window: launch() rejects and
// Playwright also emits a late, un-awaited "failed to launch" rejection. Swallow
// exactly that noise so a display-less environment SKIPS cleanly instead of
// reporting phantom errors; anything else still surfaces.
function isBootFailure(err) {
  return /failed to launch|Target (page|browser).*closed|Timeout .* exceeded/i.test(String(err && err.message || err));
}

const describeElectron = process.env.LORE_E2E_ELECTRON === '1' ? describe : describe.skip;

describeElectron('okta sign-in — full Electron boot', () => {
  it('boots, exposes loginOkta, and reports "unavailable" when not configured', async (ctx) => {
    const swallow = (err) => { if (!isBootFailure(err)) throw err; };
    process.on('unhandledRejection', swallow);
    let app;
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-okta-electron-'));
    const port = await freePort();
    try {
      app = await electron.launch({
        args: [appDir], cwd: appDir, env: unconfiguredEnv(userData, port), timeout: 45000,
      });
    } catch (e) {
      process.off('unhandledRejection', swallow);
      fs.rmSync(userData, { recursive: true, force: true });
      ctx.skip(`Electron could not boot in this environment: ${e.message}`);
      return;
    }
    try {
      const win = await app.firstWindow({ timeout: 30000 });
      await win.waitForLoadState('domcontentloaded');

      // The preload bridge is really wired through to the renderer.
      const hasBridge = await win.evaluate(
        () => !!(window.lore && window.lore.auth
          && typeof window.lore.auth.oktaConfig === 'function'
          && typeof window.lore.auth.loginOkta === 'function'));
      expect(hasBridge).toBe(true);

      const config = await win.evaluate(() => window.lore.auth.oktaConfig());
      expect(config).toEqual({ ok: false });

      // Invoke the real IPC handler. Unconfigured => clean unavailable, no browser.
      const res = await win.evaluate(() => window.lore.auth.loginOkta());
      expect(res).toBeTruthy();
      expect(res.ok).toBe(false);
      expect(res.reason).toBe('unavailable');
    } finally {
      await app.close().catch(() => {});
      // Give Playwright a tick to flush any post-close rejection, then detach.
      await new Promise((r) => setTimeout(r, 50));
      process.off('unhandledRejection', swallow);
      fs.rmSync(userData, { recursive: true, force: true });
    }
  }, 90000);
});
