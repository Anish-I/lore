// Fire one /reindex and capture the backend traceback from main-process stdout.
const { _electron: electron } = require('playwright');
(async () => {
  const app = await electron.launch({ args: ['.'], cwd: __dirname, env: { ...process.env } });
  const proc = app.process();
  let buf = '';
  proc.stdout.on('data', (d) => { buf += d; });
  proc.stderr.on('data', (d) => { buf += d; });
  const win = await app.firstWindow();
  await win.waitForFunction(() => window.lore && window.LoreApp, null, { timeout: 60000 });
  await win.waitForTimeout(6000);
  buf = ''; // keep only post-boot logs
  const r = await win.evaluate(async () => {
    const cfg = await window.lore.config.get();
    const td = await window.lore.readTree(cfg.roots[0]);
    const findNote = (nodes) => { for (const n of nodes) { if (n.kind === 'note') return n.id; if (n.children) { const f = findNote(n.children); if (f) return f; } } return null; };
    const note = findNote(td.tree);
    const res = await fetch('http://localhost:8099/reindex', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Lore-Token': cfg.localToken || '' },
      body: JSON.stringify({ path: note, owner_id: cfg.owner, scope_id: cfg.scope, tenant_id: cfg.tenant }),
    });
    return { note, status: res.status };
  });
  await win.waitForTimeout(3000);
  console.log('REQUEST:', JSON.stringify(r));
  console.log('--- backend/main logs after request ---');
  console.log(buf.slice(-6000));
  await app.close();
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
