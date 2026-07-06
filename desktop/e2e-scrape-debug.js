// Debug: capture main-process logs and watch scrape progress until it finishes or errors.
const { _electron: electron } = require('playwright');
(async () => {
  const app = await electron.launch({ args: ['.'], cwd: __dirname, env: { ...process.env } });
  const proc = app.process();
  proc.stdout.on('data', (d) => process.stdout.write('[main] ' + d));
  proc.stderr.on('data', (d) => process.stdout.write('[main:err] ' + d));
  const win = await app.firstWindow();
  await win.waitForFunction(() => window.lore && window.LoreApp, null, { timeout: 60000 });
  await win.waitForTimeout(5000);

  await win.evaluate(() => {
    window.__scrapeEvents = [];
    if (window.lore.scrapeProgress) window.lore.scrapeProgress((p) => { window.__scrapeEvents.push({ t: Date.now(), ...p }); });
  });
  // The boot reconcile already starts a scrape; just observe.
  const t0 = Date.now();
  let lastLen = 0;
  while (Date.now() - t0 < 8 * 60 * 1000) {
    await win.waitForTimeout(8000);
    const s = await win.evaluate(async () => {
      const cfg = await window.lore.config.get();
      let st = null;
      try { st = await window.lore.stats(cfg.tenant); } catch (e) { st = { err: String(e) }; }
      return { events: window.__scrapeEvents.slice(-3), n: window.__scrapeEvents.length, st };
    });
    if (s.n !== lastLen || true) {
      console.log(`[${Math.round((Date.now() - t0) / 1000)}s] events=${s.n} last=${JSON.stringify(s.events[s.events.length - 1] || null)} stats=${JSON.stringify(s.st)}`);
      lastLen = s.n;
    }
    const last = s.events[s.events.length - 1];
    if (last && last.phase === 'done') break;
    if (s.st && s.st.notes > 300) break;
  }
  await app.close();
  process.exit(0);
})().catch((e) => { console.error('DEBUG FAIL', e); process.exit(1); });
