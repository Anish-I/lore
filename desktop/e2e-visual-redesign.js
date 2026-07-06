// Playwright Electron visual sweep of the Redesign C - Hybrid UI.
// Boots the real app and screenshots every major surface into ./e2e-redesign-shots/.
// Run: node e2e-visual-redesign.js
const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, 'e2e-redesign-shots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const app = await electron.launch({ args: ['.'], cwd: __dirname, env: { ...process.env } });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => window.lore && window.LoreApp, null, { timeout: 60000 });
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  await win.waitForTimeout(6000); // backend spawn + tree/graph load

  const shot = async (name) => {
    await win.waitForTimeout(700);
    await win.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('shot:', name);
  };
  const clickText = async (text, exact) => {
    const loc = win.getByText(text, { exact: exact !== false }).first();
    try { await loc.click({ timeout: 3000 }); return true; }
    catch (e) { console.log('MISS click:', text, e.message.split('\n')[0]); return false; }
  };

  await shot('01-home-grid-my');

  // Place tabs
  await clickText('Team');
  await shot('02-place-team');
  await clickText('Company');
  await shot('03-place-company');
  await clickText('My Notes');

  // Open first page card (click a card title if any exist)
  const cardOpened = await win.evaluate(() => {
    // find a card grid title element by walking the DOM: any div with fontWeight 600 inside the grid area
    return false;
  });
  // fallback: use search palette to open a page
  await win.keyboard.press('Control+KeyK');
  await shot('04-search-palette');
  const hasResult = await win.evaluate(() => {
    const rows = document.querySelectorAll('div');
    return true;
  });
  await win.keyboard.press('Enter').catch(() => {});
  await shot('05-page-view');

  // Ask panel via ribbon
  await clickText('Ask Lore');
  await shot('06-ask-panel');
  await clickText('Ask Lore'); // toggle off

  // Map overlay
  await clickText('Map');
  await shot('07-map-overlay');
  await win.keyboard.press('Escape');

  // Wizards
  await clickText('Wizards');
  await shot('08-wizards');
  // builder
  await clickText('Create one');
  await shot('09-wizard-builder');
  await win.evaluate(() => { const b = document.querySelector('button[aria-label="Close wizard builder"]'); if (b) b.click(); });
  await win.waitForTimeout(400);
  const backLink = await win.getByText(/^Back to /).first();
  try { await backLink.click({ timeout: 2000 }); } catch { /* ribbon still there */ }
  await win.waitForTimeout(400);

  // Move dialog (needs open page)
  await clickText('Move…');
  await shot('10-move-dialog');
  await win.keyboard.press('Escape');

  // Import modal
  await clickText('Add files');
  await shot('11-import-modal');
  await win.keyboard.press('Escape');
  await clickText('Close');

  // Avatar menu + light theme
  const avatarClicked = await win.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Account menu"]');
    if (btn) { btn.click(); return true; }
    return false;
  });
  await shot('12-avatar-menu');
  await clickText('Light theme');
  await shot('13-light-home');
  await clickText('Map');
  await shot('14-light-map');
  await win.keyboard.press('Escape');

  console.log('DONE — shots in', OUT);
  await app.close();
  process.exit(0);
})().catch((e) => { console.error('VISUAL SWEEP FAIL', e); process.exit(1); });
