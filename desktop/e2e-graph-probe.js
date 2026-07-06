// Probe: enumerate what the backend actually has — stats + graph under many scopes.
const { _electron: electron } = require('playwright');
(async () => {
  const app = await electron.launch({ args: ['.'], cwd: __dirname, env: { ...process.env } });
  const win = await app.firstWindow();
  await win.waitForFunction(() => window.lore && window.LoreApp, null, { timeout: 60000 });
  await win.waitForTimeout(8000);
  const r = await win.evaluate(async () => {
    const out = {};
    const cfg = await window.lore.config.get();
    out.tenant = cfg && cfg.tenant;
    out.cfgScope = cfg && cfg.scope;
    try { out.stats = await window.lore.stats(cfg.tenant); } catch (e) { out.statsErr = String(e); }
    const candidates = ['research', 'private', 'engineering', 'default', 'personal', 'team', 'enterprise', 'company', 'solo', 'wingman'];
    out.byScope = {};
    for (const s of candidates) {
      try {
        const g = await window.lore.graph({ tenant: cfg.tenant, scopes: [s] });
        out.byScope[s] = g && g.nodes ? g.nodes.length : (g && g.error) || null;
      } catch (e) { out.byScope[s] = 'err:' + String(e).slice(0, 60); }
    }
    try {
      const g = await window.lore.graph({ tenant: cfg.tenant, scopes: candidates });
      out.allCandidates = g && g.nodes ? g.nodes.length : null;
      if (g && g.nodes && g.nodes.length) {
        const sc = {};
        g.nodes.forEach((n) => { sc[n.scope] = (sc[n.scope] || 0) + 1; });
        out.nodeScopes = sc;
      }
    } catch (e) { out.allErr = String(e); }
    // Also try other tenants
    for (const t of ['default', 'local', 'lore']) {
      try { const st = await window.lore.stats(t); if (st && st.notes) out['tenant_' + t] = st; } catch { /* */ }
    }
    return out;
  });
  console.log(JSON.stringify(r, null, 2));
  await app.close();
  process.exit(0);
})().catch((e) => { console.error('PROBE FAIL', e); process.exit(1); });
