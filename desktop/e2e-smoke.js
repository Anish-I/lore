// Playwright Electron smoke test — launches the real app and exercises its features
// through the live window.lore IPC bridge + backend. Run: node e2e-smoke.js
const { _electron: electron } = require('playwright');
const path = require('path');

(async () => {
  const app = await electron.launch({
    args: ['.'], cwd: __dirname,
    env: { ...process.env, LORE_VAULT: 'C:\\Users\\ivatu\\ObsidianVault', VAULT_PROFILE: 'solo' },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  // Wait for the React app + IPC bridge, then give the backend a moment to spawn/load.
  await win.waitForFunction(() => window.lore && window.lore.wizards && window.LoreApp, null, { timeout: 60000 });
  await win.waitForTimeout(5000);

  const r = await win.evaluate(async () => {
    const out = {};
    // SEARCH — the wizard store catalog + result counts
    try {
      const cat = await window.lore.wizards.catalog();
      out.catalogTotal = cat.length;
      out.byCategory = cat.reduce((a, w) => { const k = w.kind === 'wizard' ? 'featured' : ((w.topics && w.topics[0]) || 'tool'); a[k] = (a[k] || 0) + 1; return a; }, {});
      const q = (s) => cat.filter((w) => (w.name + ' ' + (w.desc || '') + ' ' + (w.topics || []).join(' ')).toLowerCase().includes(s)).length;
      out.searchCounts = { mcp: q('mcp'), agent: q('agent'), github: q('github'), debugging: q('debugging'), security: q('security'), memory: q('memory') };
    } catch (e) { out.catalogErr = String(e); }
    // GRAPH — nodes/edges (knowledge graph)
    try { const g = await window.lore.graph('private,team,enterprise'); out.graphNodes = g.nodes.length; out.graphEdges = g.edges.length; } catch (e) { out.graphErr = String(e); }
    // AI WITH TEAM SCOPE — ask across private+team+enterprise
    try { const t = await window.lore.ask('What is the Kalshi trading bot architecture?', ['private', 'team', 'enterprise'], 'solo'); out.askEngine = t.engine; out.askChunks = (t.final || []).length; out.askAnswerChars = (t.answer || '').length; } catch (e) { out.askErr = String(e); }
    // CONFIG — vault + identity
    try { const c = await window.lore.config.get(); out.vaultRoot = (c && c.roots && c.roots[0]) || null; out.tenant = c && c.tenant; out.installedWizards = Object.keys((c && c.installedWizards) || {}).length; } catch (e) { /* */ }
    return out;
  });

  await win.screenshot({ path: path.join(__dirname, 'e2e-shot-home.png') });
  console.log('=== LORE SMOKE TEST RESULTS ===');
  console.log(JSON.stringify(r, null, 2));
  await app.close();
  const ok = r.catalogTotal > 0 && r.graphNodes > 0 && r.askEngine;
  console.log(ok ? 'SMOKE: PASS' : 'SMOKE: INCOMPLETE');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('SMOKE FAIL', e); process.exit(1); });
