// Lore desktop — Electron main process.
// Owns the OS: file explorer (fs), spawns the Python `lore` retrieval backend,
// and serves IPC for the renderer's window.lore bridge.
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { runScrape } = require('./scraper');
const installer    = require('./hooks-installer');
const mcpInstaller = require('./mcp-installer');
const googleOauth  = require('./lib/google-oauth');

const BACKEND_PORT = 8099;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const CORE_DIR = path.join(__dirname, '..', 'core');
const ENV_VAULT_ROOT = process.env.LORE_VAULT || null;

let win = null;
let backendProc = null;
let watcher = null;
let upkeepInterval = null;
let embeddedPgStop = null; // set when config.serverMode === true

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

  // Explicit child env so the packaged build can steer the frozen backend at
  // embedded Qdrant / Postgres. Cloning process.env also carries DATABASE_URL,
  // which the embedded-Postgres block in app.whenReady set before we ran (item 4).
  const childEnv = { ...process.env };

  // Local Obsidian-light default: SQLite truth + embedded Qdrant, no servers.
  // Applies to BOTH the packaged and dev spawn paths below unless the user has
  // explicitly opted into server mode (cfg.serverMode === true), in which case
  // the existing Postgres/QDRANT_URL server env (set in app.whenReady) is left alone.
  const cfg = loadConfig();
  if (!(cfg && cfg.serverMode === true)) {
    const userData = app.getPath('userData');
    childEnv.DATABASE_URL = `sqlite:///${path.join(userData, 'lore.db')}`;
    childEnv.QDRANT_PATH = path.join(userData, 'lore-qdrant');
    delete childEnv.QDRANT_URL; // ensure embedded mode, not a server client
  }

  if (app.isPackaged) {
    // Packaged: launch the PyInstaller-frozen backend directly — no Python, no CORE_DIR.
    // (Reached BEFORE the no-core guard, which only applies to the dev/python path.)
    const exe = path.join(process.resourcesPath, 'lore-backend', 'lore-backend.exe');
    // Embedded Qdrant: QDRANT_PATH switches QdrantClient into local on-disk path mode.
    const qdrantPath = path.join(app.getPath('userData'), 'lore-qdrant');
    try { fs.mkdirSync(qdrantPath, { recursive: true }); } catch { /* ignore */ }
    childEnv.QDRANT_PATH = qdrantPath;
    childEnv.LORE_PORT = String(BACKEND_PORT); // frozen exe binds this port
    backendProc = spawn(exe, [], {
      env: childEnv,
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    // Dev: system Python + uvicorn from the source CORE_DIR (Docker PG / Qdrant).
    if (!fs.existsSync(CORE_DIR)) return 'no-core'; // dev source tree missing
    const py = process.platform === 'win32' ? 'python' : 'python3';
    backendProc = spawn(py, ['-m', 'uvicorn', 'lore.api:app', '--port', String(BACKEND_PORT)], {
      cwd: CORE_DIR,
      env: childEnv,
      stdio: 'ignore',
      windowsHide: true,
    });
  }
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
function safeVaultName(name, fallback = 'Lore Library') {
  return String(name || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || fallback;
}

function defaultVaultParent() {
  return path.join(app.getPath('documents'), 'Lore Libraries');
}

function uniqueVaultRoot(parent, baseName) {
  let root = path.join(parent, baseName);
  if (!fs.existsSync(root)) return root;
  for (let i = 2; i < 1000; i++) {
    root = path.join(parent, `${baseName} ${i}`);
    if (!fs.existsSync(root)) return root;
  }
  return path.join(parent, `${baseName} ${Date.now()}`);
}

function finishVaultCreate(root, parent) {
  try {
    const stat = fs.existsSync(root) ? fs.statSync(root) : null;
    if (stat && !stat.isDirectory()) return { ok: false, error: 'A file already exists at that path.' };
    fs.mkdirSync(root, { recursive: true });
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
  registerRoot(root);
  startWatch(root);

  // Generate a fresh tenant id scoped to this new library so its graph starts empty.
  const libName = path.basename(root);
  const slug = libName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'lib';
  const suffix = require('crypto').randomBytes(3).toString('hex'); // 6 lowercase hex chars
  const tenant = `lib-${slug}-${suffix}`;

  // Seed a Home note so the library opens with useful content rather than an empty sidebar.
  const homePath = path.join(root, 'Home.md');
  const homeContent = `---
scope: private
---

# Welcome to Lore

Lore is your personal knowledge OS — a local-first place to capture, connect, and query everything you know.

## Libraries

A **Library** is a folder on your machine. Every note inside it lives as a plain Markdown file, owned by you. You are in **${libName}** right now. Create more libraries for different contexts (work, personal, research).

## Sagas

**Sagas** are projects — long-running threads of work with their own notes, timelines, and goals. Open the Projects panel from the left rail to create and track them.

## Wizards

**Wizards** are installable knowledge bases — curated note packs on topics like productivity, coding, health, and more. Browse the Wizards catalog (the star icon) to install one with a single click.

## Ask

Press **Ctrl+Enter** (or **Cmd+Enter** on Mac) to open the Ask panel. Type a question and Lore searches your indexed notes, then synthesises an answer grounded in your own writing. The more you capture, the better the answers.

## Knowledge Graph

The **Graph** view (the node icon on the left rail) shows how your notes connect — shared topics, tags, and references surface as edges. Click any node to jump to the note.

## Capture Hooks

Install **Lore Hooks** from Settings → Hooks to auto-capture Claude Code sessions, Codex runs, and Copilot sessions into this library — one click, no copy-paste.

---

Start by renaming this note or creating a new one with the **New note** button.
`;
  try { fs.writeFileSync(homePath, homeContent, 'utf8'); } catch { /* non-fatal: library still opens */ }

  const tree = buildTree(root);
  return { ok: true, root, name: libName, parent, tree, indexed: countNotes(tree), tenant };
}

ipcMain.handle('vault:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Open a Lore library', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths.length) return null;
  const root = r.filePaths[0];
  registerRoot(root);   // path-guard: allow reads/writes inside this vault
  startWatch(root);
  const tree = buildTree(root);
  return { root, name: path.basename(root), tree, indexed: countNotes(tree) };
});

ipcMain.handle('vault:create', async (_e, opts) => {
  const name = safeVaultName(opts && opts.name);
  if (opts && opts.autoPlace) {
    const parent = defaultVaultParent();
    const root = uniqueVaultRoot(parent, name);
    return finishVaultCreate(root, parent);
  }
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose where to create your Lore library',
    buttonLabel: 'Create library here',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return null;
  const parent = r.filePaths[0];
  const root = path.join(parent, name);
  return finishVaultCreate(root, parent);
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
    fs.mkdirSync(path.dirname(p), { recursive: true });  // create parent dirs (e.g. new saga/group folder)
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
  if (!r) return { ok: false, error: 'No library configured' };
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

// ---------- IPC: Google OAuth (desktop loopback) + Lore session ----------
// The Google client config (gitignored) lives at <repo>/secrets/google_oauth_client.json.
function loadGoogleClient() {
  const p = process.env.GOOGLE_OAUTH_CLIENT_FILE
    || path.join(__dirname, '..', 'secrets', 'google_oauth_client.json');
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  return data.installed || data.web || data;
}

// Lore session JWT is stored encrypted (Electron safeStorage) in userData.
function authStorePath() { return path.join(app.getPath('userData'), 'lore-auth.bin'); }
function saveSession(obj) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const enc = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json.toString('utf8')) : json;
  fs.writeFileSync(authStorePath(), enc);
}
function loadSession() {
  try {
    const raw = fs.readFileSync(authStorePath());
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
    return JSON.parse(json);
  } catch { return null; }
}
function clearSession() { try { fs.unlinkSync(authStorePath()); } catch { /* ignore */ } }

// Sign in: run the loopback flow → get Google id_token → exchange at the Lore
// server for a session JWT → store it. Returns { ok, user_id, email, scopes } or { ok:false, reason }.
ipcMain.handle('auth:login', async () => {
  try {
    const clientCfg = loadGoogleClient();
    const tokens = await googleOauth.runLoopbackFlow(clientCfg, (url) => shell.openExternal(url));
    if (!tokens.id_token) return { ok: false, reason: 'no id_token from Google' };
    const r = await fetch(`${BACKEND_URL}/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id_token: tokens.id_token }),
    });
    const body = await r.json();
    if (!r.ok) return { ok: false, reason: body.detail || `server ${r.status}` };
    saveSession({ token: body.token, user_id: body.user_id, email: body.email, scopes: body.scopes });
    return { ok: true, user_id: body.user_id, email: body.email, scopes: body.scopes };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

// Current session: validates the stored JWT against the server. Returns the user or null.
ipcMain.handle('auth:status', async () => {
  const sess = loadSession();
  if (!sess || !sess.token) return null;
  try {
    const r = await fetch(`${BACKEND_URL}/auth/me`, { headers: { Authorization: `Bearer ${sess.token}` } });
    if (!r.ok) return null;
    const me = await r.json();
    return { user_id: me.user_id, email: sess.email, scopes: me.scopes };
  } catch { return null; }
});

ipcMain.handle('auth:logout', () => { clearSession(); return { ok: true }; });

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
  if (!root) return { ok: false, error: 'No library configured' };
  const cfg = loadConfig() || {};
  if (!w.scope || !cfg.owner || !cfg.tenant) return { ok: false, error: 'Configure wizard scope, owner, and tenant before installing.' };
  const dir = path.join(root, 'Wizards', safeName(w.name));
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }

  // --- Pre-baked notes (baseline/fallback) ---
  const linkedTitles = [];
  for (const n of (w.notes || [])) {
    const fm = `---\nscope: ${w.scope}\ntags: [${(w.topics || []).join(', ')}]\nwizard: ${w.name}\n---\n\n`;
    try { fs.writeFileSync(path.join(dir, safeName(n.title) + '.md'), fm + (n.body || ''), 'utf8'); linkedTitles.push(n.title); } catch { /* ignore */ }
  }

  // --- GitHub-aware: one note per file for any github.com source ---
  const TEXT_EXTS = /\.(md|txt|json|js|ts|jsx|tsx|py|yml|yaml|toml|rs|go|java|rb|sh|conf|ini|cfg|xml|html|css|scss|sql|tf|hcl)$/i;
  const SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|build|\.next|__pycache__|\.venv|venv)\//;  // skip nested too
  const GH_MAX_BYTES = 256 * 1024;   // skip oversized files (tree gives blob size)
  const ghFetch = (url) => {           // bounded fetch: 12s timeout, never hangs the main process
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 12000);
    return fetch(url, { headers: { 'User-Agent': 'lore-desktop/1' }, signal: ac.signal })
      .finally(() => clearTimeout(t));
  };
  for (const src of (w.sources || [])) {
    const ghm = src.match(/^https?:\/\/github\.com\/([^/]+)\/([^/?# ]+)/i);
    if (!ghm) continue;
    const [, ghOwner, repoRaw] = ghm;
    const ghRepo = repoRaw.replace(/\.git$/, '');
    try {
      if (win && !win.isDestroyed()) win.webContents.send('scrape:progress', { phase: 'fetch', current: `Fetching ${ghOwner}/${ghRepo}…`, done: 0, total: 1, errors: 0 });
      const repoRes = await ghFetch(`https://api.github.com/repos/${ghOwner}/${ghRepo}`);
      if (!repoRes.ok) continue;
      const repoInfo = await repoRes.json();
      const branch = repoInfo.default_branch || 'main';
      const treeRes = await ghFetch(`https://api.github.com/repos/${ghOwner}/${ghRepo}/git/trees/${branch}?recursive=1`);
      if (!treeRes.ok) continue;
      const treeData = await treeRes.json();
      const files = (treeData.tree || []).filter((f) =>
        f.type === 'blob' && TEXT_EXTS.test(f.path) && !SKIP_DIRS.test(f.path)
        && (f.size == null || f.size <= GH_MAX_BYTES)).slice(0, 40);
      if (win && !win.isDestroyed()) win.webContents.send('scrape:progress', { phase: 'fetch', current: `Fetching ${files.length} files from ${ghOwner}/${ghRepo}…`, done: 0, total: files.length, errors: 0 });
      let done = 0;
      for (const file of files) {
        try {
          const rawRes = await ghFetch(`https://raw.githubusercontent.com/${ghOwner}/${ghRepo}/${branch}/${file.path}`);
          if (!rawRes.ok) { done++; continue; }
          let content = await rawRes.text();
          if (content.length > GH_MAX_BYTES) content = content.slice(0, GH_MAX_BYTES) + '\n… (truncated)';
          const isMd = /\.md$/i.test(file.path);
          const fm = `---\nscope: ${w.scope}\ntags: [${(w.topics || []).join(', ')}]\nwizard: ${w.name}\nsource: ${src}\n---\n\n`;
          // heading makes the title predictable for wikilink resolution
          const body = `# ${file.path}\n\n` + (isMd ? content : ('```\n' + content + '\n```'));
          // hash suffix so distinct repo paths never collide after safeName truncation
          const hash = require('crypto').createHash('sha1').update(file.path).digest('hex').slice(0, 6);
          const fname = safeName(file.path.replace(/\//g, '_')) + '-' + hash + '.md';
          fs.writeFileSync(path.join(dir, fname), fm + body, 'utf8');
          linkedTitles.push(file.path);
          done++;
        } catch { done++; /* individual file failure: skip silently */ }
        if (win && !win.isDestroyed()) win.webContents.send('scrape:progress', { phase: 'fetch', current: file.path, done, total: files.length, errors: 0 });
      }
    } catch { /* network down / private repo / rate-limited → fall back to pre-baked notes only */ }
  }

  // --- Hub note: _Home.md wikilinks every note → connected subgraph ---
  const topics = w.topics || [];
  const tagLine = topics.map((t) => `#${t}`).join('  ');
  const noteLinks = linkedTitles.map((t) => `- [[${t}]]`).join('\n');
  const homeFm = `---\nscope: ${w.scope}\ntags: [${topics.join(', ')}]\nwizard: ${w.name}\n---\n\n`;
  const homeBody = `# ${w.name}\n\n${w.desc || ''}${tagLine ? '\n\n' + tagLine : ''}\n\n## Notes\n\n${noteLinks}\n`;
  try { fs.writeFileSync(path.join(dir, '_Home.md'), homeFm + homeBody, 'utf8'); } catch { /* ignore */ }

  registerRoot(dir);
  try {
    await runScrape({
      roots: [dir], excludes: [], extensions: undefined, maxFiles: 500, maxBytes: 2 * 1024 * 1024,
      scope: w.scope, owner: cfg.owner, tenant: cfg.tenant, full: false, promptHistory: false,
      onProgress: (evt) => { if (win && !win.isDestroyed()) win.webContents.send('scrape:progress', evt); },
    });
  } catch { /* ignore */ }
  saveConfig({ ...cfg, installedWizards: { ...(cfg.installedWizards || {}), [id]: { name: w.name } } });
  const total = linkedTitles.length + 1; // +1 for _Home.md hub node
  if (win && !win.isDestroyed()) win.webContents.send('scrape:progress', { phase: 'done', done: total, total, current: `installed ${w.name}`, errors: 0 });
  return { ok: true, installed: total };
});

ipcMain.handle('wizards:uninstall', async (_e, id) => {
  const w = (loadCatalog().wizards || []).find((x) => x.id === id);
  const root = vaultRoot();
  const cfg = loadConfig() || {};
  // De-index from the knowledge graph BEFORE removing files.
  // If the backend is REACHABLE but errors (4xx/5xx), abort and keep the wizard installed so the
  // user can retry cleanly (Codex review). If the backend is unreachable, proceed best-effort.
  if (w && root && cfg.tenant) {
    const dirFwd = path.join(root, 'Wizards', safeName(w.name)).replace(/\\/g, '/');
    try {
      const fr = await fetch(`${BACKEND_URL}/forget`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant: cfg.tenant, path_prefix: dirFwd }),
      });
      if (!fr.ok) return { ok: false, error: `Could not de-index (backend ${fr.status}); try again.` };
    } catch { /* backend unreachable — file removal proceeds best-effort */ }
  }
  if (w && root) { try { fs.rmSync(path.join(root, 'Wizards', safeName(w.name)), { recursive: true, force: true }); } catch { /* ignore */ } }
  const iw = { ...(cfg.installedWizards || {}) }; delete iw[id];
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

// ---------- IPC: enrichment LLM providers (codex sub / claude sub / byok) ----------
ipcMain.handle('enrich:providers', async () => {
  try {
    const r = await fetch(`${BACKEND_URL}/enrich/providers`);
    return await r.json();   // { codex, claude, byok }
  } catch (e) { return { codex: false, claude: false, byok: false, error: String(e) }; }
});

ipcMain.handle('enrich:run', async (_e, opts) => {
  const { tenant, limit, provider } = opts || {};
  if (!tenant) return { error: 'tenant is required' };
  try {
    const r = await fetch(`${BACKEND_URL}/enrich`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, limit: limit || 8, provider }),
    });
    const result = await r.json();
    if (win && !win.isDestroyed())
      win.webContents.send('scrape:progress', { phase: 'done', done: 0, total: 0, current: 'enrichment complete', errors: 0, summary: result });
    return result;
  } catch (e) { return { error: String(e) }; }
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

  // ---------- embedded Postgres ----------
  // Embedded Postgres is ONLY for an explicit server-mode build/config — the
  // light local default (SQLite + embedded Qdrant, set in ensureBackend) never
  // spawns Postgres. When serverMode is true, a local Postgres cluster is
  // started from bundled binaries (no Docker required) and DATABASE_URL is
  // pointed at it before the backend is spawned.
  if (cfg && cfg.serverMode === true) {
    const embPg = require('./lib/embedded-postgres');
    const pgDataDir = path.join(app.getPath('userData'), 'lore-pg-data');
    // TODO: free-port pick to avoid Docker PG clash
    const result = await embPg.start({ dataDir: pgDataDir, port: 5433 });
    if (result.ok) {
      process.env.DATABASE_URL = result.url;
      embeddedPgStop = result.stop;
    } else {
      console.error('[embedded-pg] failed to start:', result.reason);
      // Non-fatal: fall through; backend will fail to connect and surface its own error.
    }
  }

  // Best-effort, non-blocking: the renderer works locally and shows a banner if backend
  // search is unavailable, so startup never blocks the window (origin/master behavior).
  ensureBackend().catch((e) => console.error('backend startup error', e));
  await createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  // Stop embedded Postgres if it was started (fire-and-forget on quit).
  if (embeddedPgStop) try { embeddedPgStop(); } catch {}
  if (backendProc) try { backendProc.kill(); } catch {}
  if (watcher) try { watcher.close(); } catch {}
  stopUpkeepInterval();
});
