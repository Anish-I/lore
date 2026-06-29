// Lore desktop — Electron main process.
// Owns the OS: file explorer (fs), spawns the Python `lore` retrieval backend,
// and serves IPC for the renderer's window.lore bridge.
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { runScrape } = require('./scraper');
const installer    = require('./hooks-installer');
const mcpInstaller = require('./mcp-installer');

const BACKEND_PORT = 8099;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const CORE_DIR = path.join(__dirname, '..', 'core');
const ENV_VAULT_ROOT = process.env.LORE_VAULT || null;

let win = null;
let backendProc = null;
let watcher = null;
let upkeepInterval = null;

// ---------- upkeep auto-scheduler ----------
// Fires a background /upkeep/run every 30 minutes when auto-mode is on.
const UPKEEP_INTERVAL_MS = 30 * 60 * 1000;

function startUpkeepInterval(tenant) {
  if (!tenant) return;
  if (upkeepInterval) { clearInterval(upkeepInterval); upkeepInterval = null; }
  upkeepInterval = setInterval(async () => {
    try {
      await fetch(`${BACKEND_URL}/upkeep/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant }),
      });
      if (win && !win.isDestroyed())
        win.webContents.send('scrape:progress', { phase: 'done', done: 0, total: 0, current: 'upkeep complete', errors: 0 });
    } catch { /* backend may not be up; silently skip */ }
  }, UPKEEP_INTERVAL_MS);
}

function stopUpkeepInterval() {
  if (upkeepInterval) { clearInterval(upkeepInterval); upkeepInterval = null; }
}

// ---------- path-guard ----------
// Tracks every directory the user has explicitly opened or configured as a scrape
// root. File IPC (note:read, note:write) is restricted to these roots so the
// renderer cannot request arbitrary absolute paths on the machine.
const allowedRoots = new Set();
if (ENV_VAULT_ROOT) allowedRoots.add(path.normalize(ENV_VAULT_ROOT));

function registerRoot(p) {
  if (p) allowedRoots.add(path.normalize(p));
}

// Returns true when p sits inside at least one allowed root.
function isUnderAllowedRoot(p) {
  const norm = path.normalize(p);
  for (const root of allowedRoots) {
    if (norm === root || norm.startsWith(root + path.sep)) return true;
  }
  return false;
}

// Throws if the path is not inside a known root; call before any fs read/write.
function pathGuard(p) {
  if (!p || typeof p !== 'string') throw new Error('Invalid path argument');
  if (!isUnderAllowedRoot(p)) throw new Error(`Access denied: path is outside all allowed roots — ${p}`);
}

// ---------- config ----------
// Persisted to: <app.getPath('userData')>/lore-config.json
// (Typically %APPDATA%\lore-desktop\lore-config.json on Windows.)
// configPath() is a function — not a top-level constant — because
// app.getPath('userData') is only valid after app is ready.
function configPath() {
  return path.join(app.getPath('userData'), 'lore-config.json');
}

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); }
  catch { return null; }
}

function saveConfig(cfg) {
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
  // Register any scrape roots so the path-guard accepts them.
  if (Array.isArray(cfg.roots)) cfg.roots.forEach(registerRoot);
}

// ---------- backend lifecycle ----------
async function isBackendUp() {
  try { const r = await fetch(`${BACKEND_URL}/presets`); return r.ok; } catch { return false; }
}

async function ensureBackend() {
  if (await isBackendUp()) return 'already-running';
  if (!fs.existsSync(CORE_DIR)) return 'no-core'; // packaged build without a bundled sidecar (M2)
  const py = process.platform === 'win32' ? 'python' : 'python3';
  backendProc = spawn(py, ['-m', 'uvicorn', 'lore.api:app', '--port', String(BACKEND_PORT)], {
    cwd: CORE_DIR,
    env: { ...process.env },
    stdio: 'ignore',
    windowsHide: true,
  });
  backendProc.on('error', (e) => console.error('backend spawn error', e));
  // poll for readiness (models load on first boot — allow ~40s)
  for (let i = 0; i < 80; i++) {
    if (await isBackendUp()) return 'spawned';
    await new Promise((r) => setTimeout(r, 500));
  }
  return 'timeout';
}

// ---------- file tree ----------
function scopeOf(filePath) {
  try {
    const head = fs.readFileSync(filePath, 'utf8').slice(0, 600);
    const fm = head.match(/^---\s*[\r\n]([\s\S]*?)[\r\n]---/);
    if (fm) {
      const m = fm[1].match(/^scope:\s*(.+)$/m);
      if (m) return String(m[1]).trim().replace(/^['"]|['"]$/g, '') || null;
    }
  } catch { /* ignore */ }
  return null;
}

function buildTree(root, depth = 0) {
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  const folders = [], notes = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      const children = buildTree(full, depth + 1);
      if (children.length) folders.push({ id: full, kind: 'folder', name: e.name, depth, open: depth === 0, children });
    } else if (e.name.toLowerCase().endsWith('.md')) {
      notes.push({ id: full, kind: 'note', name: e.name.replace(/\.md$/i, ''), depth, scope: scopeOf(full), indexed: true });
    }
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  notes.sort((a, b) => a.name.localeCompare(b.name));
  return [...folders, ...notes];
}

function countNotes(tree) {
  return tree.reduce((n, x) => n + (x.kind === 'note' ? 1 : countNotes(x.children || [])), 0);
}

function startWatch(root) {
  if (watcher) { watcher.close(); watcher = null; }
  // Defensive: refuse to watch a bare drive root (C:\ etc.) — chokidar would
  // attempt to watch the entire drive and peg the machine.  Full-mode scrapes
  // set sync:false in config; this check is a second line of defence.
  const _norm = path.normalize(root);
  const _parsed = path.parse(_norm);
  if (_parsed.root === _norm || !_parsed.base) {
    console.warn('[main] startWatch: refused to watch drive root', root);
    return;
  }
  try {
    const chokidar = require('chokidar');
    // Watch only the chosen vault root — never the whole drive.
    watcher = chokidar.watch(root, { ignoreInitial: true, depth: 8, ignored: /(^|[\/\\])\../ });
    const notify = (event, p) => { if (win && p && p.toLowerCase().endsWith('.md')) win.webContents.send('vault:changed', { event, path: p }); };
    watcher.on('add', (p) => notify('add', p)).on('change', (p) => notify('change', p)).on('unlink', (p) => notify('unlink', p));
  } catch (e) { console.error('watch error', e); }
}

// ---------- IPC: vault + notes ----------
ipcMain.handle('vault:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Open a Lore vault', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths.length) return null;
  const root = r.filePaths[0];
  registerRoot(root);   // path-guard: allow reads/writes inside this vault
  startWatch(root);
  const tree = buildTree(root);
  return { root, name: path.basename(root), tree, indexed: countNotes(tree) };
});

ipcMain.handle('vault:tree', (_e, root) => {
  if (!root || !fs.existsSync(root)) return null;
  registerRoot(root);   // path-guard: allow reads/writes inside this vault
  startWatch(root);
  const tree = buildTree(root);
  return { root, name: path.basename(root), tree, indexed: countNotes(tree) };
});

ipcMain.handle('note:read', (_e, p) => {
  try {
    pathGuard(p);
    return { path: p, raw: fs.readFileSync(p, 'utf8') };
  } catch (e) {
    return { path: p, raw: '', error: String(e) };
  }
});

ipcMain.handle('note:write', (_e, { path: p, text }) => {
  try {
    pathGuard(p);
    fs.writeFileSync(p, text, 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// ---------- IPC: config ----------
// Config lives in app.getPath('userData')/lore-config.json.
// Handlers are registered here but only invoked after the app is ready.
ipcMain.handle('config:get', () => loadConfig());

ipcMain.handle('config:set', (_e, partial) => {
  const current = loadConfig() || {};
  const merged = { ...current, ...partial };
  saveConfig(merged);
  return merged;
});

// ---------- IPC: scrape ----------
// Returns {started:true} immediately; progress events arrive on 'scrape:progress'.
ipcMain.handle('scrape:start', (_e, scrapeConfig) => {
  const cfg = { ...(loadConfig() || {}), ...(scrapeConfig || {}) };
  const { roots = [], excludes = [], extensions, maxFiles, maxBytes, scope, owner, tenant,
          full = false, promptHistory = false } = cfg;

  runScrape({
    roots, excludes, extensions, maxFiles, maxBytes, scope, owner, tenant,
    full, promptHistory,
    onProgress: (evt) => {
      if (win && !win.isDestroyed()) win.webContents.send('scrape:progress', evt);
    },
  }).then((summary) => {
    if (win && !win.isDestroyed())
      win.webContents.send('scrape:progress', { phase: 'done', done: summary.files, total: summary.files, current: '', errors: summary.errors, summary });
  }).catch((e) => {
    if (win && !win.isDestroyed())
      win.webContents.send('scrape:progress', { phase: 'done', done: 0, total: 0, current: '', errors: 1, error: String(e) });
  });

  return { started: true };
});

// ---------- IPC: import (drop files/folders/zip → nodes) ----------
const IMPORT_TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.js', '.ts', '.py', '.json', '.yaml', '.yml', '.csv', '.html', '.css', '.rst', '.org', '.log']);

function importRoot() {
  const cfg = loadConfig() || {};
  const vault = (Array.isArray(cfg.roots) && cfg.roots[0]) || ENV_VAULT_ROOT;
  if (!vault) return null;
  if (!cfg.scope || !cfg.owner || !cfg.tenant) return { error: 'Configure scope, owner, and tenant before importing.' };
  const dir = path.join(vault, 'Imported');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return { vault, dir, cfg };
}

function importCopyFile(srcPath, destDir, summary) {
  const ext = path.extname(srcPath).toLowerCase();
  if (!IMPORT_TEXT_EXT.has(ext)) { summary.skipped++; return; }
  const base = path.basename(srcPath);
  let dest = path.join(destDir, base), i = 1;
  while (fs.existsSync(dest)) { dest = path.join(destDir, base.replace(/(\.[^.]+)$/, `-${i}$1`)); i++; }
  try { fs.copyFileSync(srcPath, dest); summary.copied++; } catch { summary.errors++; }
}

function importWalkDir(srcDir, destDir, summary) {
  let entries = [];
  try { entries = fs.readdirSync(srcDir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = path.join(srcDir, e.name);
    if (e.isDirectory()) importWalkDir(full, destDir, summary);
    else importCopyFile(full, destDir, summary);
  }
}

async function runImport(paths) {
  const r = importRoot();
  if (!r) return { ok: false, error: 'No vault configured' };
  if (r.error) return { ok: false, error: r.error };
  const os = require('os');
  const { execFileSync } = require('child_process');
  const summary = { copied: 0, skipped: 0, errors: 0 };
  for (const p of (paths || [])) {
    try {
      const st = fs.statSync(p);
      const ext = path.extname(p).toLowerCase();
      if (st.isDirectory()) importWalkDir(p, r.dir, summary);
      else if (ext === '.zip') {
        const tmp = path.join(os.tmpdir(), 'lore-import-' + path.basename(p, '.zip').replace(/[^a-z0-9]/gi, '_'));
        try {
          fs.rmSync(tmp, { recursive: true, force: true });
          execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${p.replace(/'/g, "''")}' -DestinationPath '${tmp.replace(/'/g, "''")}' -Force`], { windowsHide: true });
          importWalkDir(tmp, r.dir, summary);
        } catch { summary.errors++; }
      } else importCopyFile(p, r.dir, summary);
    } catch { summary.errors++; }
  }
  if (summary.copied > 0) {
    registerRoot(r.dir);
    try {
      await runScrape({
        roots: [r.dir], excludes: [], extensions: undefined, maxFiles: 5000, maxBytes: 4 * 1024 * 1024,
        scope: r.cfg.scope, owner: r.cfg.owner, tenant: r.cfg.tenant,
        full: false, promptHistory: false,
        onProgress: (evt) => { if (win && !win.isDestroyed()) win.webContents.send('scrape:progress', evt); },
      });
    } catch { summary.errors++; }
    if (win && !win.isDestroyed()) win.webContents.send('scrape:progress', { phase: 'done', done: summary.copied, total: summary.copied, current: 'import complete', errors: summary.errors, summary });
  }
  return { ok: true, ...summary };
}

ipcMain.handle('import:files', (_e, paths) => runImport(paths));
ipcMain.handle('import:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Import into Lore', properties: ['openFile', 'openDirectory', 'multiSelections'] });
  if (r.canceled || !r.filePaths.length) return { ok: true, copied: 0, skipped: 0, errors: 0 };
  return runImport(r.filePaths);
});

// ---------- IPC: wizards (installable knowledge bases / "app store") ----------
function vaultRoot() {
  const cfg = loadConfig() || {};
  return (Array.isArray(cfg.roots) && cfg.roots[0]) || ENV_VAULT_ROOT;
}
function loadCatalog() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'wizards-catalog.json'), 'utf8')); }
  catch { return { wizards: [] }; }
}
function safeName(s) { return String(s || '').replace(/[^a-z0-9 _-]/gi, '').trim().slice(0, 60) || 'untitled'; }

ipcMain.handle('wizards:catalog', () => {
  const cat = loadCatalog(), cfg = loadConfig() || {};
  const installed = cfg.installedWizards || {}, ratings = cfg.wizardRatings || {};
  return (cat.wizards || []).map((w) => ({
    id: w.id, name: w.name, desc: w.desc, author: w.author, rating: w.rating, installs: w.installs,
    scope: w.scope, kind: w.kind || 'wizard', topics: w.topics || [], sources: w.sources || [],
    noteCount: (w.notes || []).length, installed: !!installed[w.id], myRating: ratings[w.id] || 0,
  }));
});

ipcMain.handle('wizards:install', async (_e, id) => {
  const w = (loadCatalog().wizards || []).find((x) => x.id === id);
  if (!w) return { ok: false, error: 'Wizard not found' };
  const root = vaultRoot();
  if (!root) return { ok: false, error: 'No vault configured' };
  const cfg = loadConfig() || {};
  if (!w.scope || !cfg.owner || !cfg.tenant) return { ok: false, error: 'Configure wizard scope, owner, and tenant before installing.' };
  const dir = path.join(root, 'Wizards', safeName(w.name));
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  for (const n of (w.notes || [])) {
    const fm = `---\nscope: ${w.scope}\ntags: [${(w.topics || []).join(', ')}]\nwizard: ${w.name}\n---\n\n`;
    try { fs.writeFileSync(path.join(dir, safeName(n.title) + '.md'), fm + (n.body || ''), 'utf8'); } catch { /* ignore */ }
  }
  registerRoot(dir);
  try {
    await runScrape({
      roots: [dir], excludes: [], extensions: undefined, maxFiles: 500, maxBytes: 2 * 1024 * 1024,
      scope: w.scope, owner: cfg.owner, tenant: cfg.tenant, full: false, promptHistory: false,
      onProgress: (evt) => { if (win && !win.isDestroyed()) win.webContents.send('scrape:progress', evt); },
    });
  } catch { /* ignore */ }
  saveConfig({ ...cfg, installedWizards: { ...(cfg.installedWizards || {}), [id]: { name: w.name } } });
  if (win && !win.isDestroyed()) win.webContents.send('scrape:progress', { phase: 'done', done: (w.notes || []).length, total: (w.notes || []).length, current: `installed ${w.name}`, errors: 0 });
  return { ok: true, installed: (w.notes || []).length };
});

ipcMain.handle('wizards:uninstall', (_e, id) => {
  const w = (loadCatalog().wizards || []).find((x) => x.id === id);
  const root = vaultRoot();
  if (w && root) { try { fs.rmSync(path.join(root, 'Wizards', safeName(w.name)), { recursive: true, force: true }); } catch { /* ignore */ } }
  const cfg = loadConfig() || {}; const iw = { ...(cfg.installedWizards || {}) }; delete iw[id];
  saveConfig({ ...cfg, installedWizards: iw });
  return { ok: true };
});

ipcMain.handle('wizards:rate', (_e, { id, stars }) => {
  const cfg = loadConfig() || {};
  saveConfig({ ...cfg, wizardRatings: { ...(cfg.wizardRatings || {}), [id]: stars } });
  return { ok: true };
});

// ---------- IPC: hooks ----------
// Delegates to hooks-installer.js; pushes hooks:update after mutations.

ipcMain.handle('hooks:detect', () => installer.detectTools());

ipcMain.handle('hooks:install', (_e, opts) => {
  const { tool, ...rest } = opts || {};
  let result;
  if (!tool) result = { ok: false, reason: 'Tool is required' };
  else if (tool === 'claude')  result = installer.installClaude(rest);
  else if (tool === 'codex')   result = installer.installCodex();
  else if (tool === 'copilot') result = installer.installCopilot();
  else result = { ok: false, reason: `Unknown tool: ${tool}` };

  // Notify renderer of updated installation state after any mutation.
  if (win && !win.isDestroyed()) win.webContents.send('hooks:update', installer.detectTools());
  return result;
});

ipcMain.handle('hooks:uninstall', (_e, tool) => {
  let result;
  if (!tool) result = { ok: false, reason: 'Tool is required' };
  else if (tool === 'claude') result = installer.uninstallClaude();
  else result = { ok: false, reason: `Uninstall not supported for: ${tool}` };

  if (win && !win.isDestroyed()) win.webContents.send('hooks:update', installer.detectTools());
  return result;
});

// Returns the per-tool status ARRAY the renderer expects: [{id, name, detected, installed}].
// (The renderer maps over this; returning a single object would crash it.)
ipcMain.handle('hooks:status', () => {
  try { return installer.detectTools(); }
  catch { return []; }
});

// Per-session capture status (object) — used to confirm a session was indexed.
ipcMain.handle('hooks:capture-status', async (_e, sessionId) => {
  try { return await installer.captureStatus(sessionId); }
  catch (e) { return { ok: false, error: String(e) }; }
});

// ---------- IPC: MCP ----------
// Delegates to mcp-installer.js; manages ~/.claude/.mcp.json.

ipcMain.handle('mcp:detect',    () => mcpInstaller.detectMcp());
ipcMain.handle('mcp:install',   () => mcpInstaller.installMcp());
ipcMain.handle('mcp:uninstall', () => mcpInstaller.uninstallMcp());

// ---------- IPC: notes + search (backend proxies) ----------
// Proxied in main-process so the renderer never needs to lift CORS headers.

ipcMain.handle('notes:get', async (_e, id) => {
  try {
    const cfg = loadConfig() || {};
    if (!cfg.tenant) return { error: 'tenant is not configured' };
    const qs = `?tenant=${encodeURIComponent(cfg.tenant)}`;
    const r = await fetch(`${BACKEND_URL}/notes/${encodeURIComponent(id)}${qs}`);
    return r.json();
  } catch (e) {
    return { error: String(e) };
  }
});

// 'search' receives a single object argument {query, scopes, k} so both
// caller and handler share the same structured shape.
ipcMain.handle('search', async (_e, { query, scopes, k }) => {
  try {
    const cfg = loadConfig() || {};
    if (!cfg.tenant) return { error: 'tenant is not configured' };
    const r = await fetch(`${BACKEND_URL}/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, scopes, k, tenant_id: cfg.tenant }),
    });
    return r.json();
  } catch (e) {
    return { error: String(e) };
  }
});

// ---------- IPC: upkeep ----------

ipcMain.handle('upkeep:run', async (_e, opts) => {
  const { tenant, scope } = opts || {};
  if (!tenant) return { error: 'tenant is required' };
  try {
    const r = await fetch(`${BACKEND_URL}/upkeep/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, scope }),
    });
    const result = await r.json();
    // Notify the renderer so it can refresh the graph / status panel.
    if (win && !win.isDestroyed())
      win.webContents.send('scrape:progress', { phase: 'done', done: 0, total: 0, current: 'upkeep complete', errors: 0, summary: result });
    return result;
  } catch (e) {
    return { error: String(e) };
  }
});

ipcMain.handle('upkeep:status', async () => {
  try {
    const r = await fetch(`${BACKEND_URL}/upkeep/status`);
    return r.json();
  } catch (e) {
    return { error: String(e) };
  }
});

// Persists config.upkeepAuto and starts/stops the 30-min background scheduler.
ipcMain.handle('upkeep:set-auto', (_e, on) => {
  const cfg = loadConfig() || {};
  cfg.upkeepAuto = !!on;
  saveConfig(cfg);
  if (on) startUpkeepInterval(cfg.tenant);
  else     stopUpkeepInterval();
  return { ok: true, upkeepAuto: cfg.upkeepAuto };
});

// ---------- IPC: graph ----------
// Fetches /graph from the backend in main-process (avoids CORS from renderer).
ipcMain.handle('graph:get', async (_e, opts) => {
  const cfg = loadConfig() || {};
  const scopes = Array.isArray(opts) ? opts.join(',') : (opts && opts.scopes ? opts.scopes : '');
  const tenant = (opts && opts.tenant) || cfg.tenant || '';
  const params = new URLSearchParams();
  if (tenant) params.set('tenant', tenant);
  if (scopes) params.set('scopes', Array.isArray(scopes) ? scopes.join(',') : scopes);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const r = await fetch(`${BACKEND_URL}/graph${qs}`);
  if (!r.ok) throw new Error(`backend /graph returned ${r.status}`);
  return r.json();
});

// ---------- window ----------
async function createWindow() {
  const windowOptions = {
    width: 1440, height: 900, minWidth: 1040, minHeight: 640,
    backgroundColor: '#101116', show: false,
    title: 'Lore',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
  if (process.platform === 'darwin') {
    windowOptions.titleBarStyle = 'hiddenInset';
    windowOptions.trafficLightPosition = { x: 16, y: 16 };
  }
  win = new BrowserWindow(windowOptions);
  win.removeMenu();
  // Diagnostic: capture renderer console warnings/errors + crashes to a log file.
  const rlog = path.join(app.getPath('userData'), 'lore-renderer.log');
  try { fs.writeFileSync(rlog, ''); } catch { /* ignore */ }
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) { try { fs.appendFileSync(rlog, `[lvl${level}] ${message}  (${sourceId}:${line})\n`); } catch { /* ignore */ } }
  });
  win.webContents.on('render-process-gone', (_e, d) => { try { fs.appendFileSync(rlog, `RENDER-GONE ${JSON.stringify(d)}\n`); } catch { /* ignore */ } });
  await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.show();
}

app.whenReady().then(async () => {
  const cfg = loadConfig();
  if (cfg && cfg.upkeepAuto === true && cfg.tenant) startUpkeepInterval(cfg.tenant);

  await ensureBackend(); // best-effort; renderer shows a banner if it's not reachable
  await createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  if (backendProc) try { backendProc.kill(); } catch {}
  if (watcher) try { watcher.close(); } catch {}
  stopUpkeepInterval();
});
