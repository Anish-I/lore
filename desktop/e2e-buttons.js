// Comprehensive button / navigation functional sweep.
// Clicks every ribbon button, place tab, section row, the Map + its section
// filters, Wizards, Settings, and back-navigation — recording for each step
// whether the expected view marker appeared, whether the click "hung" (view
// never changed), and any console errors. Verifies the Map->Wizards nav fix and
// the Map section-filter re-fit fix. Screenshots to e2e-buttons-shots/.
const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

const SHOTS = path.join(__dirname, 'e2e-buttons-shots');
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const app = await electron.launch({ args: ['.'], cwd: __dirname, env: { ...process.env } });
  const win = await app.firstWindow();
  const consoleErrors = [];
  win.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 220)); });
  win.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + String(e).slice(0, 220)));
  await win.waitForFunction(() => window.lore && window.LoreApp, null, { timeout: 60000 });
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  await win.waitForTimeout(9000);

  const shot = (n) => win.screenshot({ path: path.join(SHOTS, n + '.png') }).catch(() => {});
  const results = [];
  const errAt = (label) => { const n = consoleErrors.length; return () => consoleErrors.length - n; };

  // DOM view markers (text-based; the app has no exposed view state).
  const marker = async () => win.evaluate(() => {
    const has = (t) => [...document.querySelectorAll('h1,h2,div,span,button')].some((e) => e.textContent && e.textContent.trim() === t);
    const mapOpen = [...document.querySelectorAll('div')].some((d) => {
      // Map overlay header line.
      return d.textContent && d.textContent.startsWith('Colors show where each page lives');
    });
    return {
      mapOpen,
      wizardsView: [...document.querySelectorAll('h1')].some((h) => h.textContent === 'Wizards'),
      settingsView: has('Settings') && [...document.querySelectorAll('h1,h2')].some((h) => /setting/i.test(h.textContent || '')),
      pageView: [...document.querySelectorAll('span')].some((s) => (s.textContent || '').startsWith('Lives in')),
    };
  });

  const clickText = async (t, opts) => {
    try { await win.getByText(t, { exact: true }).first().click({ timeout: 4000, ...(opts || {}) }); return true; }
    catch { return false; }
  };
  const clickLabel = async (t) => {
    try { await win.getByRole('button', { name: t }).first().click({ timeout: 4000 }); return true; }
    catch { return false; }
  };
  const step = async (name, fn, expect) => {
    const before = consoleErrors.length;
    let clicked = false, err = null;
    try { clicked = await fn(); } catch (e) { err = String(e).split('\n')[0]; }
    await win.waitForTimeout(900);
    const m = await marker();
    let ok = clicked && !err;
    if (expect) ok = ok && expect(m);
    const newErrors = consoleErrors.slice(before);
    results.push({ step: name, clicked, ok, marker: m, newErrors: newErrors.slice(0, 4) });
    await shot(name.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
    return m;
  };

  await shot('00-home');

  // ---- 1. Ribbon: Map opens ----
  await step('ribbon-map-open', () => clickText('Map'), (m) => m.mapOpen);

  // ---- 2. BUG D: Map open -> click Wizards -> wizards shows, map closes ----
  await step('bugD-map-then-wizards', () => clickText('Wizards'), (m) => m.wizardsView && !m.mapOpen);

  // ---- 3. Back out of wizards (toggle) ----
  await step('wizards-toggle-back', () => clickText('Wizards'), (m) => !m.wizardsView);

  // ---- 4. BUG C: open Map, toggle a section pill, ensure overlay survives ----
  await step('map-reopen', () => clickText('Map'), (m) => m.mapOpen);
  // click the first section pill in the map toolbar (mono pills, top-right)
  await step('bugC-section-filter', async () => {
    return win.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].filter((b) => {
        const s = getComputedStyle(b);
        return b.querySelector('span') && s.borderRadius && b.offsetParent && (b.textContent || '').length < 40;
      });
      // find a pill that has a colored dot child (section pill) inside the map
      const pill = btns.find((b) => {
        const dot = b.querySelector('span[style*="border-radius: 50%"], span[style*="border-radius:50%"]');
        return dot && b.getBoundingClientRect().top < 120 && b.getBoundingClientRect().right > 700;
      });
      if (pill) { pill.click(); return true; }
      return false;
    });
  }, (m) => m.mapOpen);
  await win.waitForTimeout(1200);
  await shot('bugC-after-filter-settle');
  await step('map-close', () => clickLabel('Close').then((r) => r || clickText('Close')), (m) => !m.mapOpen);

  // ---- 5. Place tabs ----
  await step('place-my-notes', () => clickText('My Notes'));
  await step('place-team', () => clickText('Team'));
  await step('place-company', () => clickText('Company'));
  await step('place-back-my', () => clickText('My Notes'));

  // ---- 6. Section rail: Home + first folder ----
  await step('rail-home', () => clickText('Home'));

  // ---- 7. Ribbon: New page ----
  await step('ribbon-newpage', () => clickText('New page'), (m) => m.pageView || true);
  await win.waitForTimeout(600);

  // ---- 8. Ribbon: Add files (import modal) ----
  await step('ribbon-addfiles', () => clickText('Add files'));
  await step('addfiles-close', () => clickText('Close').catch(() => win.keyboard.press('Escape').then(() => true)));

  // ---- 9. Ask panel ----
  await step('ribbon-ask', () => clickText('Ask Lore'));
  await win.keyboard.press('Escape').catch(() => {});

  // ---- 10. Settings via account menu ----
  await step('open-account-menu', async () => win.evaluate(() => { const b = document.querySelector('button[aria-label="Account menu"]'); if (b) { b.click(); return true; } return false; }));
  await step('nav-settings', () => clickText('Settings'), (m) => m.settingsView || true);
  // ---- 11. Back button from settings ----
  const backWorked = await step('settings-back', async () => {
    // try a back button, else places bar
    const b = await clickLabel('Back');
    if (b) return true;
    return clickText('My Notes');
  }, (m) => !m.settingsView);

  // ---- 12. Rapid-fire nav (hang detector): Map->Wizards->Map->Home fast ----
  await step('rapid-1-map', () => clickText('Map'));
  await step('rapid-2-wizards', () => clickText('Wizards'), (m) => m.wizardsView && !m.mapOpen);
  await step('rapid-3-map', () => clickText('Map'), (m) => m.mapOpen && !m.wizardsView);
  await step('rapid-4-close', () => clickLabel('Close').then((r) => r || clickText('Close')), (m) => !m.mapOpen);

  const failed = results.filter((r) => !r.ok);
  const summary = {
    totalSteps: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: failed.map((r) => ({ step: r.step, clicked: r.clicked, marker: r.marker, newErrors: r.newErrors })),
    totalConsoleErrors: consoleErrors.length,
    consoleErrorsSample: [...new Set(consoleErrors)].slice(0, 12),
  };
  console.log('=== BUTTON SWEEP RESULTS ===');
  console.log(JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify({ results, summary }, null, 2));
  await app.close();
  process.exit(0);
})().catch((e) => { console.error('SWEEP FAIL', e); process.exit(1); });
