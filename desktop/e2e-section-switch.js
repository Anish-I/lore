// Repro: select section A → its scoped chat; select section B → chat must
// visibly switch (chip, heading, fresh thread). Screenshots at each step.
const { _electron: electron } = require('playwright');
const path = require('path');

(async () => {
  const app = await electron.launch({ args: ['.'], cwd: __dirname, env: { ...process.env } });
  const win = await app.firstWindow();
  await win.waitForFunction(() => window.lore, null, { timeout: 60000 });
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  await win.waitForTimeout(8000); // backend + tree load

  const shot = (n) => win.screenshot({ path: path.join(__dirname, 'e2e-buttons-shots', n) });
  const state = async (label) => {
    const t = await win.evaluate(() => document.body.innerText.slice(0, 4000));
    const chip = (t.match(/Section: [^\n]+/) || [null])[0];
    const askWithin = (t.match(/Ask within [^\n…]+/) || [null])[0];
    console.log(`[${label}] chip=${JSON.stringify(chip)} heading=${JSON.stringify(askWithin)}`);
  };

  // Click section "Kalshi" in the rail.
  await win.getByText('Kalshi', { exact: true }).first().click({ timeout: 5000 });
  await win.waitForTimeout(1200);
  await state('after Kalshi');
  await shot('switch-1-kalshi.png');

  // Now click section "Smartclips".
  await win.getByText('Smartclips', { exact: true }).first().click({ timeout: 5000 });
  await win.waitForTimeout(1200);
  await state('after Smartclips');
  await shot('switch-2-smartclips.png');

  // And a third, "Wingman".
  await win.getByText('Wingman', { exact: true }).first().click({ timeout: 5000 });
  await win.waitForTimeout(1200);
  await state('after Wingman');
  await shot('switch-3-wingman.png');

  await app.close();
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
