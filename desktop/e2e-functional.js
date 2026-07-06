// Functional verification of the redesigned app against the live backend:
// Ask/chat E2E with citations, search->page, move dialog, wizards, settings,
// import modal, theme toggle, console errors. Screenshots to e2e-redesign-shots/.
const { _electron: electron } = require('playwright');
const path = require('path');
(async () => {
  const app = await electron.launch({ args: ['.'], cwd: __dirname, env: { ...process.env } });
  const win = await app.firstWindow();
  const consoleErrors = [];
  win.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  await win.waitForFunction(() => window.lore && window.LoreApp, null, { timeout: 60000 });
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  await win.waitForTimeout(9000);
  const results = {};
  const shot = (n) => win.screenshot({ path: path.join(__dirname, 'e2e-redesign-shots', n + '.png') });
  const clickText = async (t) => { try { await win.getByText(t, { exact: true }).first().click({ timeout: 4000 }); return true; } catch { return false; } };

  // 1. ASK / CHAT E2E — real question through the live RAG.
  try {
    const ask = await win.evaluate(async () => {
      const cfg = await window.lore.config.get();
      const t = await window.lore.ask('What is the Kalshi trading bot?', [cfg.scope], cfg.tenant);
      return { answerChars: (t.answer || '').length, chunks: (t.final || []).length, engine: t.engine || null, err: t.error || null };
    });
    results.askIPC = ask;
  } catch (e) { results.askIPC = { err: String(e) }; }

  // 2. Chat through the UI: hero input -> send -> wait for citations card.
  try {
    await win.getByPlaceholder('Ask anything about your pages…').first().fill('What is the Kalshi trading bot?');
    await win.keyboard.press('Enter');
    await win.waitForTimeout(500);
    await win.waitForFunction(() => {
      const el = [...document.querySelectorAll('div')].find((d) => d.textContent === 'FROM THESE PAGES');
      return Boolean(el);
    }, null, { timeout: 90000 });
    results.chatUI = 'answered with receipts card';
  } catch (e) { results.chatUI = 'FAIL: ' + String(e).split('\n')[0]; }
  await shot('20-chat-answer');

  // 3. Search -> open page.
  await win.keyboard.press('Control+KeyK');
  await win.keyboard.type('kalshi');
  await win.waitForTimeout(600);
  await win.keyboard.press('Enter');
  await win.waitForTimeout(1200);
  results.searchOpen = await win.evaluate(() => Boolean([...document.querySelectorAll('span')].find((s) => s.textContent && s.textContent.startsWith('Lives in'))));
  await shot('21-page-after-search');

  // 4. Move dialog opens from page header.
  results.moveDialog = await clickText('Move…');
  await win.waitForTimeout(600);
  await shot('22-move-dialog');
  await win.keyboard.press('Escape');

  // 5. Wizards view loads real list.
  await clickText('Wizards');
  await win.waitForTimeout(1500);
  results.wizards = await win.evaluate(() => Boolean([...document.querySelectorAll('h1')].find((h) => h.textContent === 'Wizards')));
  await clickText('Wizards'); // toggle back

  // 6. Settings + theme via avatar menu.
  await win.evaluate(() => document.querySelector('button[aria-label="Account menu"]').click());
  await win.waitForTimeout(400);
  results.settingsRoute = await clickText('Settings');
  await win.waitForTimeout(1000);
  await shot('23-settings');
  await clickText('My Notes'); // back to workspace via places bar
  await win.evaluate(() => document.querySelector('button[aria-label="Account menu"]').click());
  await win.waitForTimeout(300);
  results.themeToggle = await clickText('Light theme');
  await win.waitForTimeout(600);
  results.themeApplied = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
  // back to dark
  await win.evaluate(() => document.querySelector('button[aria-label="Account menu"]').click());
  await win.waitForTimeout(300);
  await clickText('Dark theme');

  // 7. Import modal.
  results.importModal = await clickText('Add files');
  await win.waitForTimeout(500);
  await shot('24-import');
  await clickText('Close');

  // 8. IPC surface sanity (teams/wizards/settings-backed APIs reachable).
  results.ipc = await win.evaluate(async () => {
    const out = {};
    try { out.presets = Boolean(await window.lore.presets()); } catch { out.presets = false; }
    try { const w = await window.lore.wizards.personal.list(); out.wizardsList = Array.isArray(w.wizards); } catch { out.wizardsList = false; }
    try { const c = await window.lore.wizards.catalog(); out.catalog = Array.isArray(c) && c.length > 0; } catch { out.catalog = false; }
    try { const cfg = await window.lore.config.get(); const g = await window.lore.graph({ tenant: cfg.tenant, scopes: [cfg.scope] }); out.graphNodes = g.nodes.length; } catch (e) { out.graphNodes = 'err'; }
    return out;
  });

  results.consoleErrors = consoleErrors.slice(0, 10);
  console.log('=== FUNCTIONAL RESULTS ===');
  console.log(JSON.stringify(results, null, 2));
  await app.close();
  process.exit(0);
})().catch((e) => { console.error('FUNCTIONAL FAIL', e); process.exit(1); });
