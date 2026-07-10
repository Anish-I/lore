// Verifies the map-filter fix end-to-end (2026-07-09 "only 3 nodes" bug):
//  1. A sidebar section selection must NOT filter the map — map opens showing everything.
//  2. Filtering via the map's own chips shows a "Showing X of Y · Show all" pill.
//  3. "Show all" restores the full map.
//  4. Place = Team (0 shared notes) → map explains filters hide pages + "Show everything" works.
// Run: node e2e-map-filter-fix.js
const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, 'e2e-map-fix-shots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const app = await electron.launch({ args: ['.'], cwd: __dirname, env: { ...process.env } });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => window.lore && window.LoreApp, null, { timeout: 60000 });
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  await win.waitForTimeout(9000); // backend spawn + graph load

  const shot = async (name) => { await win.waitForTimeout(600); await win.screenshot({ path: path.join(OUT, name + '.png') }); };
  const clickText = async (text) => {
    const loc = win.getByText(text, { exact: true }).first();
    await loc.click({ timeout: 5000 });
  };
  const bodyText = () => win.evaluate(() => document.body.innerText);
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? ' :: ' + detail : '')); };

  // --- 1. sidebar section selected, then open map → full graph, no pill ---
  await clickText('Files').catch(() => {}); // select a small section in the sidebar
  await win.waitForTimeout(800);
  await clickText('Map');
  await win.waitForTimeout(1500);
  let t = await bodyText();
  check('map opens despite sidebar section filter', t.includes('Knowledge map'));
  check('map opens UNFILTERED (no "Showing X of Y" pill)', !/Showing \d+ of \d+ pages/.test(t), (t.match(/Showing \d+ of \d+ pages/) || [''])[0]);
  check('map not empty-stated', !t.includes('hidden by the current filters'));
  await shot('01-map-open-unfiltered');

  // --- 2. filter via a map chip → pill appears ---
  // Chip row caps at 5 visible pills; "Bugs" is small (3 pages) and inside the cap.
  // .last() = the map-overlay copy (overlay mounts after the sidebar in the DOM).
  const chip = win.getByText('Bugs', { exact: true }).last();
  await chip.click({ timeout: 5000 });
  await win.waitForTimeout(1200);
  t = await bodyText();
  const pill = (t.match(/Showing \d+ of \d+ pages/) || [null])[0];
  check('chip filter shows count pill', Boolean(pill), pill);
  await shot('02-chip-filtered-pill');

  // --- 3. Show all restores ---
  await clickText('Showing ' + (pill ? pill.replace('Showing ', '').replace(/ pages.*/, ' pages') : '') + ' · Show all').catch(async () => {
    // pill text includes the counts — click via regex instead
    await win.getByText(/Showing \d+ of \d+ pages · Show all/).first().click({ timeout: 5000 });
  });
  await win.waitForTimeout(1200);
  t = await bodyText();
  check('"Show all" clears the pill', !/Showing \d+ of \d+ pages/.test(t));
  await shot('03-show-all-restored');

  // --- 4. Team place (0 shared notes) → explanatory empty state + escape hatch ---
  await clickText('Close');
  await win.waitForTimeout(600);
  await clickText('Team');
  await win.waitForTimeout(800);
  await clickText('Map');
  await win.waitForTimeout(1500);
  t = await bodyText();
  const filteredEmpty = t.includes('hidden by the current filters');
  check('empty-because-filtered state explains itself', filteredEmpty);
  await shot('04-team-empty-explained');
  if (filteredEmpty) {
    await clickText('Show everything');
    await win.waitForTimeout(1500);
    t = await bodyText();
    check('"Show everything" restores the full map', !t.includes('hidden by the current filters') && !/Showing \d+ of \d+ pages/.test(t));
    await shot('05-show-everything-restored');
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (failed.length ? 'RESULT: FAIL (' + failed.length + ')' : 'RESULT: ALL PASS (' + results.length + ')'));
  await app.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('E2E FAIL', e); process.exit(1); });
