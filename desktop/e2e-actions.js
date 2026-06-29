// Playwright Electron test — exercises: build a team (install a team-scoped Wizard),
// import a file, and ask the AI with team scope. Reports the deltas.
const { _electron: electron } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');

(async () => {
  const tmp = path.join(os.tmpdir(), 'Lore Test Import.md');
  fs.writeFileSync(tmp, '# Lore Test Import\n\nImported by the Playwright e2e test to verify the import pipeline. Mentions [[Kalshi]] and prompt engineering.\n', 'utf8');

  const app = await electron.launch({ args: ['.'], cwd: __dirname, env: { ...process.env, LORE_VAULT: 'C:\\Users\\ivatu\\ObsidianVault', VAULT_PROFILE: 'solo' } });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => window.lore && window.lore.wizards, null, { timeout: 60000 });
  await win.waitForTimeout(5000);

  const r = await win.evaluate(async (tmpPath) => {
    const out = {};
    const g0 = await window.lore.graph('private,team,enterprise'); out.nodesBefore = g0.nodes.length;
    out.installResult = await window.lore.wizards.install('prompt-engineering');   // build a TEAM knowledge base
    out.importResult = await window.lore.importFiles([tmpPath]);                    // try an import
    await new Promise((res) => setTimeout(res, 2500));
    const g1 = await window.lore.graph('private,team,enterprise');
    out.nodesAfter = g1.nodes.length;
    out.teamNodes = g1.nodes.filter((n) => n.scope === 'team').length;
    const t = await window.lore.ask('What are prompt engineering best practices?', ['team'], 'solo');  // AI with team scope
    out.askEngine = t.engine; out.askTeamChunks = (t.final || []).length;
    const cat = await window.lore.wizards.catalog();
    out.promptEngInstalled = (cat.find((w) => w.id === 'prompt-engineering') || {}).installed;
    return out;
  }, tmp);

  await win.screenshot({ path: path.join(__dirname, 'e2e-shot-actions.png') });
  console.log('=== LORE ACTIONS TEST (team install + import + ai-with-team) ===');
  console.log(JSON.stringify(r, null, 2));
  await app.close();
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
