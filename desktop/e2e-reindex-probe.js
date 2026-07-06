// Probe the backend /reindex response body for one real note (renderer fetch; CSP allows localhost).
const { _electron: electron } = require('playwright');
(async () => {
  const app = await electron.launch({ args: ['.'], cwd: __dirname, env: { ...process.env } });
  const win = await app.firstWindow();
  await win.waitForFunction(() => window.lore && window.LoreApp, null, { timeout: 60000 });
  await win.waitForTimeout(6000);
  const r = await win.evaluate(async () => {
    const cfg = await window.lore.config.get();
    const td = await window.lore.readTree(cfg.roots[0]);
    const findNote = (nodes) => { for (const n of nodes) { if (n.kind === 'note') return n.id; if (n.children) { const f = findNote(n.children); if (f) return f; } } return null; };
    const note = findNote(td.tree);
    const out = { note, tenant: cfg.tenant, scope: cfg.scope, owner: cfg.owner };
    const base = 'http://localhost:8099';
    const hdrs = { 'content-type': 'application/json', 'X-Lore-Token': cfg.localToken || '' };
    try {
      const res = await fetch(base + '/reindex', { method: 'POST', headers: hdrs, body: JSON.stringify({ path: note, owner_id: cfg.owner, scope_id: cfg.scope, tenant_id: cfg.tenant }) });
      out.reindex = { status: res.status, body: (await res.text()).slice(0, 1200) };
    } catch (e) { out.reindex = { err: String(e) }; }
    for (const ep of ['/stats?tenant=solo']) {
      try { const res = await fetch(base + ep, { headers: { 'X-Lore-Token': cfg.localToken || '' } }); out[ep] = { status: res.status, body: (await res.text()).slice(0, 300) }; }
      catch (e) { out[ep] = { err: String(e) }; }
    }
    return out;
  });
  console.log(JSON.stringify(r, null, 2));
  await app.close();
  process.exit(0);
})().catch((e) => { console.error('PROBE FAIL', e); process.exit(1); });
