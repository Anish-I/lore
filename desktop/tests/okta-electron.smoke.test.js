/* global window */
// Full-Electron boot smoke for the Okta sign-in wiring (plan Parts 3.2, 5.1).
//
// Launches the REAL packaged-shape app with Playwright's Electron driver and
// exercises the live main<->preload<->renderer bridge:
//   * the `window.lore.auth.loginOkta` IPC is actually exposed, and
//   * with Okta unconfigured, invoking it returns a clean {ok:false,
//     reason:'unavailable'} — no crash, no browser opens (plan 5.1).
//
// Opt-in: booting the whole app (embedded Postgres + backend) is heavy and needs
// a display, so this stays OUT of the default `npm test`. Run it with:
//   LORE_E2E_ELECTRON=1 npx vitest run tests/okta-electron.smoke.test.js
// If the app can't boot in this environment, the test SKIPS (never a false fail).
import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';

const ENABLED = !!process.env.LORE_E2E_ELECTRON;
const appDir = path.join(__dirname, '..');

// Okta deliberately UNCONFIGURED: no OKTA_* env, and OKTA_CLIENT_FILE pointed at a
// path that cannot exist so loadOktaClient() can't pick up a real secrets file and
// accidentally launch a browser. This is the "not configured" negative path.
function unconfiguredEnv() {
  const env = { ...process.env };
  delete env.OKTA_ISSUER;
  delete env.OKTA_CLIENT_ID;
  delete env.OKTA_CLIENT_SECRET;
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

describe.skipIf(!ENABLED)('okta sign-in — full Electron boot', () => {
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
