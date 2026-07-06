// Quick probe: does window.lore.graph return nodes with the real config?
const { _electron: electron } = require('playwright');
(async () => {
  const app = await electron.launch({ args: ['.'], cwd: __dirname, env: { ...process.env } });
  const win = await app.firstWindow();
  await win.waitForFunction(() => window.lore && window.LoreApp, null, { timeout: 60000 });
  await win.waitForTimeout(8000);
  const r = await win.evaluate(async () => {
    const out = {};
    try {
      const cfg = await window.lore.config.get();
      out.tenant = cfg && cfg.tenant;
      out.scope = cfg && cfg.scope;
      out.roots = cfg && cfg.roots;
      let p = null;
      try { p = await window.lore.presets(); } catch (e) { out.presetsErr = String(e); }
      out.personas = p && p.personas && p.personas.map((x) => ({ label: x.label, scopes: x.scopes }));
      out.presetTenant = p && p.tenant;
      const scopes = (p && p.personas && p.personas[0] && p.personas[0].scopes) || (cfg.scope ? [cfg.scope] : []);
      out.scopesUsed = scopes;
      const tenant = cfg.tenant || (p && p.tenant);
      if (tenant && scopes.length) {
        const g = await window.lore.graph({ tenant, scopes });
        out.nodes = g && g.nodes ? g.nodes.length : null;
        out.edges = g && g.edges ? g.edges.length : null;
        out.gErr = g && g.error;
      } else out.skipped = 'no tenant/scopes';
    } catch (e) { out.err = String(e); }
    return out;
  });
  console.log(JSON.stringify(r, null, 2));
  await app.close();
  process.exit(0);
})().catch((e) => { console.error('PROBE FAIL', e); process.exit(1); });
