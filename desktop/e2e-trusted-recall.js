/* global window, document */
const { _electron: electron } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');


const OUT = path.join(__dirname, 'e2e-trusted-recall-shots');
fs.mkdirSync(OUT, { recursive: true });


(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-trusted-recall-ui-'));
  const app = await electron.launch({
    args: ['.'],
    cwd: __dirname,
    env: { ...process.env, LORE_USER_DATA: userData },
  });
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (error) => pageErrors.push(String(error)));
  await win.waitForFunction(() => window.lore && window.LoreApp, null, { timeout: 60000 });
  await win.setViewportSize({ width: 1280, height: 800 }).catch(() => {});
  await win.getByText('Settings', { exact: true }).first().click({ timeout: 10000 });
  const heading = win.getByText('What Lore knows', { exact: true }).first();
  await heading.scrollIntoViewIfNeeded();
  await win.waitForTimeout(500);

  const labels = await win.evaluate(() => {
    const text = document.body.innerText;
    return {
      section: text.includes('What Lore knows'),
      about: text.includes('About you'),
      working: text.includes('Working context'),
      export: text.includes('Export'),
      past: !!document.querySelector('input[placeholder="Find past work"]'),
    };
  });
  const box = await heading.boundingBox();
  const visible = !!box && box.y >= 0 && box.y + box.height <= 800;
  await win.screenshot({ path: path.join(OUT, 'settings-trusted-recall.png') });
  const pastInput = win.locator('input[placeholder="Find past work"]');
  await pastInput.scrollIntoViewIfNeeded();
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, 'settings-past-work.png') });
  await app.close();
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}

  const result = { labels, headingVisible: visible, pageErrors };
  console.log(JSON.stringify(result, null, 2));
  if (!Object.values(labels).every(Boolean) || !visible || pageErrors.length) process.exit(1);
})().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
