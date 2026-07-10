// Lag probe: measures where intermittent click lag comes from.
//  - MAIN process: event-loop stall sampler (10ms heartbeat, records >50ms gaps)
//  - RENDERER: longtask observer + click→paint latency per button
// Drives a repeated click circuit over the chrome buttons for ~90s, then dumps both logs.
// Run: node e2e-lag-probe.js
const { _electron: electron } = require('playwright');

(async () => {
  const app = await electron.launch({ args: ['.'], cwd: __dirname, env: { ...process.env } });
  const win = await app.firstWindow();
  await win.waitForFunction(() => window.lore && window.LoreApp, null, { timeout: 60000 });
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});

  // ---- main-process stall sampler ----
  await app.evaluate(() => {
    global.__stalls = [];
    let last = Date.now();
    global.__stallTimer = setInterval(() => {
      const now = Date.now();
      const lag = now - last - 10;
      if (lag > 50) global.__stalls.push({ t: new Date(now).toISOString(), lagMs: lag });
      last = now;
    }, 10);
  });

  // ---- renderer probes ----
  await win.evaluate(() => {
    window.__long = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__long.push({ t: Date.now(), dur: Math.round(e.duration), name: e.name });
      }).observe({ entryTypes: ['longtask'] });
    } catch { /* longtask unsupported */ }
    window.__clicks = [];
    document.addEventListener('pointerdown', (ev) => {
      const label = (ev.target.closest('button,[role=button]')?.innerText || ev.target.innerText || '').slice(0, 30).replace(/\n/g, ' ');
      const t0 = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.__clicks.push({ label, paintMs: Math.round(performance.now() - t0), t: Date.now() });
      }));
    }, true);
  });

  await win.waitForTimeout(8000); // backend up

  const clickText = async (text) => {
    try { await win.getByText(text, { exact: true }).first().click({ timeout: 2500 }); } catch { /* skip */ }
    await win.waitForTimeout(400);
  };

  // Click circuit ×6 ≈ 90s, spanning stats polls / debounced background work.
  for (let round = 0; round < 6; round++) {
    await clickText('Search'); await win.keyboard.press('Escape');
    await clickText('Home');
    await clickText('Team'); await clickText('Company'); await clickText('My Notes');
    await clickText('Ask Lore'); await clickText('Ask Lore');
    await clickText('Map'); await clickText('Close');
    await clickText('Wizards'); await clickText('Home');
    await clickText('Knowledge'); await clickText('Home');
    console.log('round', round, 'done');
  }

  const mainStalls = await app.evaluate(() => { clearInterval(global.__stallTimer); return global.__stalls; });
  const rend = await win.evaluate(() => ({ long: window.__long, clicks: window.__clicks }));

  const slowClicks = rend.clicks.filter((c) => c.paintMs > 100).sort((a, b) => b.paintMs - a.paintMs);
  console.log('\n=== MAIN stalls >50ms ===', JSON.stringify(mainStalls.slice(0, 20), null, 1));
  console.log('\n=== RENDERER long tasks >50ms (top 15) ===',
    JSON.stringify(rend.long.sort((a, b) => b.dur - a.dur).slice(0, 15), null, 1));
  console.log('\n=== CLICK→PAINT >100ms ===', JSON.stringify(slowClicks.slice(0, 15), null, 1));
  console.log('\ntotals:', JSON.stringify({ mainStalls: mainStalls.length, longTasks: rend.long.length, clicks: rend.clicks.length, slowClicks: slowClicks.length }));
  await app.close();
  process.exit(0);
})().catch((e) => { console.error('PROBE FAIL', e); process.exit(1); });
