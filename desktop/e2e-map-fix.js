// Let the boot reconcile re-index the vault, then screenshot the populated Map.
const { _electron: electron } = require('playwright');
const path = require('path');
(async () => {
  const app = await electron.launch({ args: ['.'], cwd: __dirname, env: { ...process.env } });
  const win = await app.firstWindow();
  await win.waitForFunction(() => window.lore && window.LoreApp, null, { timeout: 60000 });
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  await win.waitForTimeout(8000);

  // Poll stats while the background reconcile indexes the vault.
  const t0 = Date.now();
  let last = -1;
  while (Date.now() - t0 < 15 * 60 * 1000) {
    const st = await win.evaluate(async () => {
      try { const cfg = await window.lore.config.get(); return await window.lore.stats(cfg.tenant); }
      catch (e) { return { err: String(e) }; }
    });
    const n = (st && st.notes) || 0;
    if (n !== last) { console.log(`[${Math.round((Date.now() - t0) / 1000)}s] indexed notes=${n} edges=${st.edges || 0}`); last = n; }
    if (n >= 300) break;
    await win.waitForTimeout(10000);
  }
  console.log('final notes:', last);

  // Give the renderer's live-stats poll (8s) time to notice and refetch the graph.
  await win.waitForTimeout(15000);
  await win.getByText('Map', { exact: true }).first().click();
  await win.waitForTimeout(4000); // graph layout settle
  await win.screenshot({ path: path.join(__dirname, 'e2e-redesign-shots', '07b-map-after-fix.png') });
  console.log('after shot saved');
  await app.close();
  process.exit(0);
})().catch((e) => { console.error('MAP FIX FAIL', e); process.exit(1); });
