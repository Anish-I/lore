const { _electron: electron } = require('playwright'); const path = require('path');
(async () => {
  const app = await electron.launch({ args: ['.'], cwd: __dirname, env: { ...process.env, LORE_VAULT: 'C:\Users\ivatu\ObsidianVault', VAULT_PROFILE: 'solo' } });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => window.lore && window.lore.mcp && window.lore.upkeep, null, { timeout: 60000 });
  await win.waitForTimeout(5000);
  const r = await win.evaluate(async () => {
    const out = {};
    try { out.mcp = await window.lore.mcp.detect(); } catch (e) { out.mcpErr = String(e); }
    try { out.upkeep = await window.lore.upkeep.status(); } catch (e) { out.upkeepErr = String(e); }
    try { const g = await window.lore.graph('private,team,enterprise'); const t = g.nodes.find(n => String(n.id).startsWith('topic:')); out.topicNode = t ? t.label : null;
      if (t) { const nd = await window.lore.notes.get(t.id); out.topicBodyChars = (nd && nd.body || '').length; } } catch (e) { out.notesErr = String(e); }
    try { out.search = (await window.lore.search('prompt engineering', ['private','team','enterprise'], 3)).results.length; } catch (e) { out.searchErr = String(e); }
    return out;
  });
  await win.screenshot({ path: path.join(__dirname, 'e2e-shot-new.png') });
  console.log(JSON.stringify(r, null, 2));
  await app.close(); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
