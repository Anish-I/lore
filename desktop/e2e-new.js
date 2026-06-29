const { _electron: electron } = require('playwright'); const path = require('path');
const E2E_TENANT = process.env.LORE_E2E_TENANT || null;
const E2E_SCOPES = (process.env.LORE_E2E_SCOPES || '').split(',').map((s) => s.trim()).filter(Boolean);
(async () => {
  const app = await electron.launch({ args: ['.'], cwd: __dirname, env: { ...process.env } });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => window.lore && window.lore.mcp && window.lore.upkeep, null, { timeout: 60000 });
  await win.waitForTimeout(5000);
  const r = await win.evaluate(async ({ tenant, scopes }) => {
    const out = {};
    try { out.mcp = await window.lore.mcp.detect(); } catch (e) { out.mcpErr = String(e); }
    try { out.upkeep = await window.lore.upkeep.status(); } catch (e) { out.upkeepErr = String(e); }
    try {
      if (tenant && scopes.length) {
        const g = await window.lore.graph({ tenant, scopes }); const t = g.nodes.find(n => String(n.id).startsWith('topic:')); out.topicNode = t ? t.label : null;
        if (t) { const nd = await window.lore.notes.get(t.id); out.topicBodyChars = (nd && nd.body || '').length; }
      } else out.notesSkipped = 'tenant/scopes not configured';
    } catch (e) { out.notesErr = String(e); }
    try {
      if (tenant && scopes.length) out.search = (await window.lore.search('prompt engineering', scopes, 3)).results.length;
      else out.searchSkipped = 'tenant/scopes not configured';
    } catch (e) { out.searchErr = String(e); }
    return out;
  }, { tenant: E2E_TENANT, scopes: E2E_SCOPES });
  await win.screenshot({ path: path.join(__dirname, 'e2e-shot-new.png') });
  console.log(JSON.stringify(r, null, 2));
  await app.close(); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
