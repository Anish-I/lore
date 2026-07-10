// Lore desktop — Electron main process.
// Owns the OS: file explorer (fs), spawns the Python `lore` retrieval backend,
// and serves IPC for the renderer's window.lore bridge.
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Menu, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { runScrape } = require('./scraper');
const installer    = require('./hooks-installer');
const mcpInstaller = require('./mcp-installer');
const cliInstaller = require('./cli-installer');
const googleOauth  = require('./lib/google-oauth');
const runtime      = require('./lib/runtime');
const loreManifest = require('./lib/lore-manifest');
const backupMirror = require('./lib/backup-mirror');

// Backend URL/port are wiring values, not constants: resolved lazily (env var > cfg
// field > default) via desktop/lib/runtime.js so a config edit or LORE_PORT/
// LORE_BACKEND_URL override takes effect without a source change. Functions rather
// than top-level consts because loadConfig() needs app.getPath('userData'), which is
// only valid after app is ready (see configPath() below).
function BACKEND_PORT() { return runtime.backendPort(loadConfig); }
function BACKEND_URL() { return runtime.backendUrl(loadConfig); }
const CORE_DIR = path.join(__dirname, '..', 'core');
const ENV_VAULT_ROOT = process.env.LORE_VAULT || null;

// App identity: in dev (`electron .`) Electron shows its own name/icon ("Electron")
// in the dock/taskbar and window title until we say otherwise. app.setName() must run
// before whenReady (and before anything reads app.getPath('userData'), since the
// default userData path is derived from the app name) — packaged builds get this for
// free from electron-builder's productName, but dev needs it set explicitly.
app.setName('Lore');

// Electron derives the DEFAULT userData path from the app name — so the setName()
// above would silently fork every existing user's data into a brand-new
// "~/Library/Application Support/Lore" folder (capital L), leaving their real
// library/config/index behind in the historical "lore-desktop" folder (this
// package's name before productName existed). Pin userData explicitly to that
// historical path so the display-name change never migrates anyone's data.
app.setPath('userData', path.join(app.getPath('appData'), 'lore-desktop'));

// Multi-instance testing override: point userData at a caller-chosen directory
// instead of the pinned default above. Must run before ANYTHING reads
// app.getPath('userData') — configPath(), the embedded-Postgres data dir, and the
// renderer log all derive from it.
if (process.env.LORE_USER_DATA) app.setPath('userData', process.env.LORE_USER_DATA);

let win = null;
let backendProc = null;
let watcher = null;
let upkeepInterval = null;
let embeddedPgStop = null; // set when config.serverMode === true

// ---------- upkeep auto-scheduler ----------
// Fires a background /upkeep/run every cfg.upkeepIntervalMinutes (default 30) when
// auto-mode is on. Interval length is read at schedule time (not a fixed constant) so
// a config change takes effect the next time the interval is (re)started.
function startUpkeepInterval(tenant) {
  if (!tenant) return;
  if (upkeepInterval) { clearInterval(upkeepInterval); upkeepInterval = null; }
  const cfg = loadConfig() || {};
  const intervalMs = (cfg.upkeepIntervalMinutes || 30) * 60_000;
  upkeepInterval = setInterval(async () => {
    try {
      // auto_classify only tags notes + records Section PROPOSALS server-side.
      // No files ever move from this background run — apply is a user click —
      // EXCEPT under the explicit opt-in autoFileObvious toggle, whose recorded
      // move plan is executed by executeAutoFileMoves (pathGuard + worklog).
      const c = loadConfig() || {};
      const r = await fetch(`${BACKEND_URL()}/upkeep/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          tenant,
          auto_classify: c.autoClassify === true,
          section_threshold: c.sectionThreshold || 5,
          auto_file: c.autoFileObvious === true,
          auto_journal: c.autoJournal === true,
        }),
      });
      if (r.ok) { try { await executeAutoFileMoves(await r.json()); } catch { /* moves retry next run */ } }
      refreshManifests('upkeep-auto', 'background upkeep run');
      if (win && !win.isDestroyed())
        win.webContents.send('scrape:progress', { phase: 'done', done: 0, total: 0, current: 'tidy-up complete', errors: 0 });
    } catch { /* backend may not be up; silently skip */ }
  }, intervalMs);
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

// ---------- local API token ----------
// A per-install secret that locks the on-device backend port so only Lore's own
// components (this app, the installed hooks, the MCP server) can read/write the
// knowledge base. Generated once, stored in config, read by hooks/MCP, and
// passed to the spawned backend via env so its middleware can enforce it.
function localToken() {
  let cfg = loadConfig() || {};
  if (!cfg.localToken) {
    cfg.localToken = require('crypto').randomBytes(24).toString('hex');
    saveConfig(cfg);
  }
  return cfg.localToken;
}
function authHeaders() {
  const t = (loadConfig() || {}).localToken;
  return t ? { 'X-Lore-Token': t } : {};
}

// ---------- .lore manifests (per-folder discovery/breadcrumb cache) ----------
// After every scrape / reconcile / upkeep / import / section change, each library
// root gets its `.lore` manifest refreshed + a worklog entry appended, so a fresh
// startup can rediscover where Lore has worked (see discoverLibraries below).
function postJSON(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
}

async function refreshManifests(action, summaryText) {
  try {
    const cfg = loadConfig() || {};
    const roots = Array.isArray(cfg.roots) ? cfg.roots : [];
    if (!roots.length) return;
    let topics = [], tags = [];
    if (cfg.tenant) {
      try {
        const r = await fetch(`${BACKEND_URL()}/tags?tenant=${encodeURIComponent(cfg.tenant)}`, { headers: authHeaders() });
        if (r.ok) { const b = await r.json(); topics = b.topics || []; tags = b.tags || []; }
      } catch { /* backend down — still write counts + worklog */ }
    }
    for (const root of roots) {
      try {
        if (!fs.existsSync(root)) continue;
        loreManifest.write(root, {
          tenant: cfg.tenant || null,
          scope: cfg.scope || null,
          indexed: { count: countNotes(buildTree(root)), updatedAt: new Date().toISOString() },
          topics, tags,
        });
        if (action) loreManifest.appendWorklog(root, { action, summary: summaryText || action });
      } catch { /* a breadcrumb writer must never break the app */ }
    }
  } catch { /* never throw */ }
}

// Scan the configured roots (and their immediate subfolders, plus the default
// library parent) for `.lore` files — lightweight: reads manifests only, never
// re-walks note trees. Powers the renderer's "reopen a known library" surface.
function discoverLibraries() {
  const found = new Map();
  const cfg = loadConfig() || {};
  const parents = new Set(Array.isArray(cfg.roots) ? cfg.roots : []);
  if (ENV_VAULT_ROOT) parents.add(ENV_VAULT_ROOT);
  try { parents.add(defaultVaultParent()); } catch { /* app not ready yet */ }
  for (const parent of parents) {
    const candidates = [parent];
    try {
      for (const e of fs.readdirSync(parent, { withFileTypes: true })) {
        if (e.isDirectory() && !e.name.startsWith('.')) candidates.push(path.join(parent, e.name));
      }
    } catch { /* parent missing — skip */ }
    for (const dir of candidates) {
      const key = path.normalize(dir);
      if (found.has(key)) continue;
      const m = loreManifest.read(dir);
      if (!m) continue;
      found.set(key, {
        root: dir,
        name: path.basename(dir),
        tenant: m.tenant || null,
        scope: m.scope || null,
        indexed: m.indexed || null,
        topics: Array.isArray(m.topics) ? m.topics : [],
        tags: Array.isArray(m.tags) ? m.tags : [],
        lastWork: Array.isArray(m.worklog) && m.worklog.length ? m.worklog[m.worklog.length - 1] : null,
      });
    }
  }
  return [...found.values()];
}

ipcMain.handle('libraries:discovered', () => {
  try { return discoverLibraries(); } catch { return []; }
});

// ---------- backend lifecycle ----------
async function isBackendUp() {
  try { const r = await fetch(`${BACKEND_URL()}/presets`); return r.ok; } catch { return false; }
}

async function ensureBackend() {
  if (await isBackendUp()) return 'already-running';

  // Explicit child env so the packaged build can steer the frozen backend at
  // embedded Qdrant / Postgres. Cloning process.env also carries DATABASE_URL,
  // which the embedded-Postgres block in app.whenReady set before we ran (item 4).
  const childEnv = { ...process.env };
  childEnv.LORE_LOCAL_TOKEN = localToken();  // lock the on-device backend port

  // Local embedding model cache — fastembed defaults to %TEMP%/fastembed_cache,
  // which Windows temp cleanup can half-delete (snapshot dir survives, .onnx
  // gone) leaving every /reindex a 500 while the model "exists". Pin it to
  // userData so the cache survives.
  if (!childEnv.FASTEMBED_CACHE_PATH) {
    const febCache = path.join(app.getPath('userData'), 'fastembed-cache');
    try { fs.mkdirSync(febCache, { recursive: true }); } catch { /* non-fatal */ }
    childEnv.FASTEMBED_CACHE_PATH = febCache;
  }

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

  // Path-traversal containment for POST /reindex: tell the backend which dirs it
  // may read files from. Without this the backend would index (and thus expose via
  // /search) any absolute path a local client names. Mirrors the allowedRoots set.
  {
    const roots = new Set(allowedRoots);
    if (Array.isArray(cfg && cfg.roots)) cfg.roots.forEach((r) => r && roots.add(path.normalize(r)));
    if (roots.size) childEnv.VAULT_ROOTS = Array.from(roots).join(path.delimiter);
  }

  if (app.isPackaged) {
    // Packaged: launch the PyInstaller-frozen backend directly — no Python, no CORE_DIR.
    // (Reached BEFORE the no-core guard, which only applies to the dev/python path.)
    // Frozen binary name is platform-specific: lore-backend.exe on Windows,
    // extensionless mach-o/ELF on macOS/Linux (built by core/build_backend_mac.sh).
    const exeName = process.platform === 'win32' ? 'lore-backend.exe' : 'lore-backend';
    const exe = path.join(process.resourcesPath, 'lore-backend', exeName);
    // Embedded Qdrant: QDRANT_PATH switches QdrantClient into local on-disk path mode.
    const qdrantPath = path.join(app.getPath('userData'), 'lore-qdrant');
    try { fs.mkdirSync(qdrantPath, { recursive: true }); } catch { /* ignore */ }
    childEnv.QDRANT_PATH = qdrantPath;
    childEnv.LORE_PORT = String(BACKEND_PORT()); // frozen exe binds this port
    backendProc = spawn(exe, [], {
      env: childEnv,
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    // Dev: this repo's own .venv (never the system/PATH python3 — it has none of
    // core's dependencies installed, and would silently die post-spawn since
    // stdio is 'ignore'). Falls back to PATH python3 only if the venv is missing
    // (e.g. a contributor who hasn't run the setup script yet).
    if (!fs.existsSync(CORE_DIR)) return 'no-core'; // dev source tree missing
    const venvPy = path.join(CORE_DIR, '..', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const py = fs.existsSync(venvPy) ? venvPy : (process.platform === 'win32' ? 'python' : 'python3');
    backendProc = spawn(py, ['-m', 'uvicorn', 'lore.api:app', '--port', String(BACKEND_PORT())], {
      cwd: CORE_DIR,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    // Dev-only crash visibility — stdio was fully 'ignore'd before, so a spawn
    // that launched but immediately crashed (e.g. missing deps) was completely
    // silent. Surface it to a log file instead of losing it.
    try {
      const logPath = path.join(app.getPath('userData'), 'lore-backend.log');
      const stream = fs.createWriteStream(logPath, { flags: 'a' });
      backendProc.stdout.pipe(stream);
      backendProc.stderr.pipe(stream);
    } catch { /* non-fatal */ }
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
// Reads the frontmatter head once and returns both scope and the wizard-install flag —
// avoids a second fs read per note just to detect `wizard:` in frontmatter.
function scopeOf(filePath) {
  try {
    const head = fs.readFileSync(filePath, 'utf8').slice(0, 600);
    const fm = head.match(/^---\s*[\r\n]([\s\S]*?)[\r\n]---/);
    if (fm) {
      const m = fm[1].match(/^scope:\s*(.+)$/m);
      const scope = m ? (String(m[1]).trim().replace(/^['"]|['"]$/g, '') || null) : null;
      const wizard = /^wizard:/m.test(fm[1]);
      return { scope, wizard };
    }
  } catch { /* ignore */ }
  return { scope: null, wizard: false };
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
      const meta = scopeOf(full);
      let mtimeMs = null;
      try { mtimeMs = fs.statSync(full).mtimeMs; } catch { /* card falls back to no label */ }
      notes.push({ id: full, kind: 'note', name: e.name.replace(/\.md$/i, ''), depth, scope: meta.scope, wizard: meta.wizard, mtimeMs });
    }
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  notes.sort((a, b) => a.name.localeCompare(b.name));
  return [...folders, ...notes];
}

function countNotes(tree) {
  return tree.reduce((n, x) => n + (x.kind === 'note' ? 1 : countNotes(x.children || [])), 0);
}

// ---------- auto-index on save ----------
// When cfg.autoIndexOnSave !== false (default ON), a watched .md add/change triggers a
// single-file /reindex so the index tracks edits without a manual re-scan. An explicit
// false (Settings toggle) keeps the watcher UI-only (tree refresh) — the user re-indexes
// manually (right-click → Re-index Note, or a full scan).
const autoIndexLast = new Map(); // path -> last trigger ms (debounces editor save bursts)

// ---------- backup mirror (SharePoint/OneDrive assurance) ----------
// Debounced: any watched change schedules a mirror ~60s later (coalesced).
// Result + timestamp persisted to config so the UI can show "Last backed up …".
let backupTimer = null;
function runBackup(reason) {
  const cfg = loadConfig() || {};
  if (!cfg.backupEnabled || !cfg.backupDir) return;
  const root = (Array.isArray(cfg.roots) && cfg.roots[0]) || (watcher && watcher._loreRoot);
  if (!root) return;
  const r = backupMirror.mirror(root, cfg.backupDir);
  const next = loadConfig() || {};
  next.backupLastRun = new Date().toISOString();
  next.backupLastOk = !!r.ok;
  next.backupLastCount = r.count || next.backupLastCount || 0;
  next.backupLastError = r.ok ? '' : (r.error || 'backup failed');
  saveConfig(next);
  if (win && !win.isDestroyed()) win.webContents.send('backup:changed', { reason, ...r });
}
function scheduleBackup() {
  const cfg = loadConfig() || {};
  if (!cfg.backupEnabled || !cfg.backupDir) return;
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(() => { backupTimer = null; runBackup('change'); }, 60_000);
}

// ---------- vault git history (M1-A) ----------
// Debounced autocommit of .md changes into a Lore-managed repo at the library
// root. If the root already has a user-owned .git, autocommit is OPT-IN
// (cfg.vaultGitEnabled) — never commit into someone's repo uninvited; when
// Lore creates the repo itself, it defaults ON.
const vaultGit = require('./lib/vault-git');
let vaultGitTimer = null;

function vaultGitActive(cfg) {
  const c = cfg || loadConfig() || {};
  if (c.vaultGitEnabled === false) return false;           // explicit off
  const root = (Array.isArray(c.roots) && c.roots[0]) || null;
  if (!root) return false;
  if (vaultGit.hasRepo(root)) {
    // Lore-created repos are marked in config; foreign repos need the opt-in.
    return c.vaultGitEnabled === true || c.vaultGitOwned === true;
  }
  return true; // no repo yet — Lore will create one (default ON)
}

async function ensureVaultRepo(root) {
  const cfg = loadConfig() || {};
  if (cfg.vaultGitEnabled === false) return;
  try {
    if (!vaultGit.hasRepo(root)) {
      await vaultGit.ensureRepo(root);
      const next = loadConfig() || {};
      next.vaultGitOwned = true;
      saveConfig(next);
      console.log('[vault-git] initialized history repo at', root);
    }
  } catch (e) { console.warn('[vault-git] init failed (non-fatal):', e.message); }
}

function scheduleAutocommit() {
  const cfg = loadConfig() || {};
  if (!vaultGitActive(cfg)) return;
  if (vaultGitTimer) clearTimeout(vaultGitTimer);
  vaultGitTimer = setTimeout(async () => {
    vaultGitTimer = null;
    const c = loadConfig() || {};
    const root = (Array.isArray(c.roots) && c.roots[0]) || null;
    if (!root || !vaultGitActive(c)) return;
    try {
      const r = await vaultGit.autocommit(root, 'lore: snapshot');
      if (r.committed && win && !win.isDestroyed()) {
        win.webContents.send('vault:git-committed', { sha: r.sha, files: r.files });
      }
    } catch (e) { console.warn('[vault-git] autocommit failed (non-fatal):', e.message); }
  }, 60_000);
}

function maybeAutoIndex(event, p) {
  if (event === 'unlink') { maybeDeindex(p); return; }
  if (event !== 'add' && event !== 'change') return;
  scheduleBackup();  // any file change also refreshes the backup (debounced)
  scheduleAutocommit(); // and a vault-git snapshot (debounced, .md only)
  const cfg = loadConfig() || {};
  if (cfg.autoIndexOnSave === false) return;
  if (!cfg.owner || !cfg.scope || !cfg.tenant) return; // identity not configured yet
  const now = Date.now();
  if (now - (autoIndexLast.get(p) || 0) < 2000) return;
  autoIndexLast.set(p, now);
  fetch(`${BACKEND_URL()}/reindex`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ path: p, owner_id: cfg.owner, scope_id: cfg.scope, tenant_id: cfg.tenant }),
  }).catch(() => { /* fail soft — backend may be down */ });
}

// A file deleted (or renamed — chokidar reports rename as unlink+add) from a
// watched vault stays orphaned in Postgres/Qdrant forever unless de-indexed:
// the note keeps surfacing in search/Ask results for content that no longer
// exists on disk. /forget already implements exactly this delete+cascade
// (same pattern /capture's privacy purge uses) — this just wires it to unlink.
function maybeDeindex(p) {
  const cfg = loadConfig() || {};
  if (cfg.autoIndexOnSave === false) return; // same automation gate as indexing
  if (!cfg.tenant) return; // identity not configured yet
  fetch(`${BACKEND_URL()}/forget`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ tenant: cfg.tenant, path_prefix: p }),
  }).catch(() => { /* fail soft — backend may be down */ });
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
    const notify = (event, p) => {
      if (!p || !p.toLowerCase().endsWith('.md')) return;
      if (win) win.webContents.send('vault:changed', { event, path: p });
      maybeAutoIndex(event, p);
      if (event === 'unlink') scheduleAutocommit(); // deletions snapshot too
    };
    ensureVaultRepo(root);
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

// A fresh tenant id scoped to a library, so each library's graph starts empty.
function mintTenant(root) {
  const slug = path.basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'lib';
  const suffix = require('crypto').randomBytes(3).toString('hex'); // 6 lowercase hex chars
  return `lib-${slug}-${suffix}`;
}

// Writes a Home.md welcome note into `root` so a new/empty library opens with
// useful content rather than an empty sidebar. Non-fatal on failure.
function seedWelcomeNote(root, libName) {
  const homePath = path.join(root, 'Home.md');
  const homeContent = `---
scope: private
---

# Welcome to Lore

Lore is your personal knowledge OS — a local-first place to capture, connect, and query everything you know.

## Libraries

A **Library** is a folder on your machine. Every note inside it lives as a plain Markdown file, owned by you. You are in **${libName}** right now. Create more libraries for different contexts (work, personal, research).

## Teams

Sign in and create or join a **Team** to share Wizards with others. Open the Teams panel from the left rail to invite people and browse what your team has shared.

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

  const libName = path.basename(root);
  const tenant = mintTenant(root);
  seedWelcomeNote(root, libName);

  const tree = buildTree(root);
  return { ok: true, root, name: libName, parent, tree, indexed: countNotes(tree), tenant };
}

ipcMain.handle('vault:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Open a Lore library', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths.length) return null;
  const root = r.filePaths[0];
  registerRoot(root);   // path-guard: allow reads/writes inside this vault
  startWatch(root);

  // Empty existing folder: seed a welcome note + mint a tenant so it behaves like a
  // fresh library. Only when there's no config tenant yet — never rotate an existing one.
  let tenant;
  let tree = buildTree(root);
  if (countNotes(tree) === 0) {
    const cfg = loadConfig();
    if (!(cfg && cfg.tenant)) {
      seedWelcomeNote(root, path.basename(root));
      tenant = mintTenant(root);
      tree = buildTree(root);
    }
  }
  return { root, name: path.basename(root), tree, indexed: countNotes(tree), tenant };
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
  // Path-guard: NEVER register an arbitrary renderer-supplied path here — that would
  // let a compromised renderer whitelist any directory (e.g. C:\Users\me) and then
  // read/write anything under it via note:read / note:write. A root becomes allowed
  // only through a native picker (vault:pick / vault:create) or persisted config
  // (blessed at boot). Reading the tree of an unblessed path is refused.
  if (!isUnderAllowedRoot(root)) {
    return { root, name: path.basename(root), tree: null, error: 'Access denied: open this folder via "Open library" first.' };
  }
  startWatch(root);
  const tree = buildTree(root);
  return { root, name: path.basename(root), tree, indexed: countNotes(tree) };
});

ipcMain.handle('note:read', (_e, p) => {
  try {
    pathGuard(p);
    // mtime feeds the editor's quiet "updated Xd ago" doc-header line.
    let mtime = null;
    try { mtime = fs.statSync(p).mtimeMs; } catch { /* header falls back */ }
    return { path: p, raw: fs.readFileSync(p, 'utf8'), mtime };
  } catch (e) {
    return { path: p, raw: '', error: String(e) };
  }
});

ipcMain.handle('note:write', (_e, { path: p, text }) => {
  try {
    pathGuard(p);
    fs.mkdirSync(path.dirname(p), { recursive: true });  // create parent dirs (e.g. new group folder)
    fs.writeFileSync(p, text, 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// ---------- IPC: inline images for the WYSIWYG editor ----------
// Images live as REAL files under <vault>/assets/ and notes reference them as
// `assets/<name>` (clean, portable markdown). The renderer's strict CSP blocks
// file:// images, so display goes through a data: URL (assetDataUrl) rather than
// a custom protocol — same on-disk result, no scheme/CSP surgery.
const IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif' };
function assetDataUrl(abs) {
  try {
    const buf = fs.readFileSync(abs);
    const ext = path.extname(abs).slice(1).toLowerCase();
    return `data:${IMG_MIME[ext] || 'application/octet-stream'};base64,${buf.toString('base64')}`;
  } catch { return null; }
}
// Copy a picked image into <vault>/assets/ and return its vault-relative path.
ipcMain.handle('note:add-image', async () => {
  const root = vaultRoot();
  if (!root) return { ok: false, error: 'Open a library first.' };
  const r = await dialog.showOpenDialog(win, {
    title: 'Insert image', properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'] }],
  });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
  try {
    const src = r.filePaths[0];
    const assetsDir = path.join(root, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    const ext = path.extname(src) || '.png';
    const base = path.basename(src, ext).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 40) || 'image';
    let name = `${base}${ext}`, i = 1;
    while (fs.existsSync(path.join(assetsDir, name))) name = `${base}-${i++}${ext}`;
    const dest = path.join(assetsDir, name);
    fs.copyFileSync(src, dest);
    return { ok: true, rel: `assets/${name}`, dataUrl: assetDataUrl(dest) };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
// Resolve a vault-relative (or contained absolute) asset path to a data: URL for
// display. Path-guarded to the vault root.
ipcMain.handle('asset:dataurl', (_e, rel) => {
  const root = vaultRoot();
  if (!root || !rel) return null;
  const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
  const normRoot = path.resolve(root);
  if (!path.resolve(abs).startsWith(normRoot + path.sep) && path.resolve(abs) !== normRoot) return null;
  return assetDataUrl(abs);
});

// ---------- IPC: backup mirror ----------
ipcMain.handle('backup:pick-dir', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose a backup folder (tip: your OneDrive or SharePoint-synced folder)',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  return { ok: true, dir: r.filePaths[0] };
});
ipcMain.handle('backup:run', async () => {
  runBackup('manual');
  const cfg = loadConfig() || {};
  return { ok: cfg.backupLastOk !== false, lastRun: cfg.backupLastRun, count: cfg.backupLastCount, error: cfg.backupLastError || '' };
});
ipcMain.handle('backup:status', () => {
  const cfg = loadConfig() || {};
  return {
    enabled: !!cfg.backupEnabled, dir: cfg.backupDir || null,
    lastRun: cfg.backupLastRun || null, ok: cfg.backupLastOk !== false,
    count: cfg.backupLastCount || 0, error: cfg.backupLastError || '',
  };
});

// ---------- IPC: change a note's scope (the confidentiality control) ----------
// The ONE operation that changes a note's confidentiality: rewrite its
// frontmatter `scope:` on disk, then re-index under the new scope_id so
// retrieval ACL follows immediately. Broadening (private -> team/company) runs
// the secret scrubber first and REFUSES if it finds keys/tokens unless force:
// true — you can't accidentally share a note that has a credential in it.
const SCOPE_BREADTH = { private: 0, engineering: 0, team: 1, company: 2, enterprise: 2 };

// The shared implementation behind BOTH the editor's visibility control (IPC below)
// and the sidebar context menu's "Push to Team" / "Make Private" — one redaction
// gate, one frontmatter rewrite, one re-index.
async function setNoteScope(p, scope, force) {
  try {
    pathGuard(p);
    const cfg = loadConfig() || {};
    let raw = fs.readFileSync(p, 'utf8');

    const fm = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
    const curScope = fm && (fm[1].match(/^scope:\s*(.+)$/m) || [])[1];
    const cur = String(curScope || cfg.scope || 'private').trim().replace(/^['"]|['"]$/g, '');
    const broadening = (SCOPE_BREADTH[scope] || 0) > (SCOPE_BREADTH[cur] || 0);

    if (broadening && !force) {
      try {
        const { redactSecrets } = require('./lib/redact');
        const [, hadSecret] = redactSecrets(raw);
        if (hadSecret) {
          return { ok: false, reason: 'secret', detail: 'This note looks like it contains an API key or token. Remove it before sharing, or confirm to share anyway.' };
        }
      } catch { /* redact unavailable — proceed */ }
    }

    if (fm) {
      const body = fm[1];
      const newBody = /^scope:\s*.+$/m.test(body)
        ? body.replace(/^scope:\s*.+$/m, `scope: ${scope}`)
        : `scope: ${scope}\n${body}`;
      raw = raw.replace(fm[0], `---\n${newBody}\n---`);
    } else {
      raw = `---\nscope: ${scope}\n---\n\n${raw}`;
    }
    fs.writeFileSync(p, raw, 'utf8');

    try {
      await postJSON(`${BACKEND_URL()}/reindex`, { path: p, owner_id: cfg.owner, scope_id: scope, tenant_id: cfg.tenant });
    } catch { /* reconcile catches up */ }
    return { ok: true, scope, broadened: broadening };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

ipcMain.handle('note:set-scope', (_e, { path: p, scope, force }) => setNoteScope(p, scope, force));

// Delete button in the page view — same flow as the tree's "Move to Trash"
// (pathGuard + OS trash + 'trashed' tree action, so tabs/tree/index reconcile).
ipcMain.handle('note:trash', (_e, p) => { ctxTrash(p, 'note'); return { ok: true }; });

// Context-menu variant of the push: same redaction gate, but the "share anyway?"
// confirm is a native dialog (there is no renderer surface mid-menu). Notifies the
// renderer via tree:action so the tree/graph refresh and a scope glyph appears.
async function ctxSetScope(notePath, scope) {
  let r = await setNoteScope(notePath, scope, false);
  if (r && r.reason === 'secret') {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Cancel', 'Share anyway'],
      defaultId: 0,
      cancelId: 0,
      message: 'This note may contain a secret',
      detail: r.detail || 'It looks like this note contains an API key or token.',
    });
    if (response !== 1) return;
    r = await setNoteScope(notePath, scope, true);
  }
  if (r && r.ok) sendTreeAction({ action: 'scope-changed', id: notePath, kind: 'note', scope });
  else if (r && r.error) sendTreeAction({ action: 'scope-change-failed', id: notePath, kind: 'note', reason: r.error });
}

// ---------- IPC: tree context menu (VS Code-style right-click on sidebar) ----------
// Pure-fs actions (create/duplicate/copy/trash) run here; actions needing renderer
// state (open a tab, start an inline rename) go out over 'tree:action'.
function sendTreeAction(payload) {
  if (win && !win.isDestroyed()) win.webContents.send('tree:action', payload);
}

function sanitizeFileName(name) {
  return String(name || '').replace(/[\/\\:\x00-\x1F]/g, '').trim();
}

// Returns a non-colliding "<dir>/<base>[ N]<ext>" path, e.g. Untitled.md, Untitled 2.md, …
function uniqueSiblingPath(dir, base, ext) {
  let candidate = path.join(dir, base + ext);
  if (!fs.existsSync(candidate)) return candidate;
  for (let i = 2; i < 1000; i++) {
    candidate = path.join(dir, `${base} ${i}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${base} ${Date.now()}${ext}`);
}

function ctxNewNote(dir) {
  try {
    pathGuard(dir);
    const cfg = loadConfig() || {};
    const p = uniqueSiblingPath(dir, 'Untitled', '.md');
    fs.writeFileSync(p, `---\nscope: ${cfg.scope || ''}\n---\n`, 'utf8');
    sendTreeAction({ action: 'rename-start', id: p, kind: 'note' });
  } catch { /* fail soft */ }
}

function ctxNewFolder(dir) {
  try {
    pathGuard(dir);
    const p = uniqueSiblingPath(dir, 'Untitled', '');
    fs.mkdirSync(p);
    sendTreeAction({ action: 'rename-start', id: p, kind: 'folder' });
  } catch { /* fail soft */ }
}

function ctxDuplicateNote(notePath) {
  try {
    pathGuard(notePath);
    const dir = path.dirname(notePath);
    const base = path.basename(notePath, '.md');
    const p = uniqueSiblingPath(dir, `${base} copy`, '.md');
    fs.copyFileSync(notePath, p);
    sendTreeAction({ action: 'rename-start', id: p, kind: 'note' });
  } catch { /* fail soft */ }
}

function ctxTrash(p, kind) {
  try { pathGuard(p); } catch (e) { sendTreeAction({ action: 'trash-failed', id: p, kind, reason: String((e && e.message) || e) }); return; }
  shell.trashItem(p)
    .then(() => sendTreeAction({ action: 'trashed', id: p, kind }))
    .catch((e) => sendTreeAction({ action: 'trash-failed', id: p, kind, reason: String((e && e.message) || e) }));
}

function ctxReindex(notePath) {
  try { pathGuard(notePath); } catch { return; }
  const cfg = loadConfig() || {};
  fetch(`${BACKEND_URL()}/reindex`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ path: notePath, owner_id: cfg.owner, scope_id: cfg.scope, tenant_id: cfg.tenant }),
  }).catch(() => { /* fail soft — backend may be down */ });
}

ipcMain.handle('tree:context-menu', (_e, args) => {
  try {
    const { id, kind, root } = args || {};
    if (!id || (kind !== 'note' && kind !== 'folder')) return { ok: false, reason: 'Missing id/kind' };
    try { pathGuard(id); } catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
    const isNote = kind === 'note';
    const dir = isNote ? path.dirname(id) : id;
    const relRoot = root || '';
    const relPath = relRoot ? path.relative(relRoot, id) : id;
    const noteName = isNote ? path.basename(id, '.md') : path.basename(id);
    const template = isNote ? [
      { label: 'Open', click: () => sendTreeAction({ action: 'open', id }) },
      { label: 'Reveal in Finder', click: () => shell.showItemInFolder(id) },
      { type: 'separator' },
      { label: 'New Note', click: () => ctxNewNote(dir) },
      { label: 'Duplicate', click: () => ctxDuplicateNote(id) },
      { label: 'Rename…', click: () => sendTreeAction({ action: 'rename-start', id, kind: 'note' }) },
      { type: 'separator' },
      { label: 'Copy Path', click: () => clipboard.writeText(id) },
      { label: 'Copy Relative Path', click: () => clipboard.writeText(relPath) },
      { label: 'Copy Wiki Link', click: () => clipboard.writeText(`[[${noteName}]]`) },
      { type: 'separator' },
      // The pushing system: move a note between confidentiality levels right from
      // the tree. Routes through setNoteScope (redaction gate included).
      { label: 'Push to Team', click: () => { ctxSetScope(id, 'team'); } },
      { label: 'Push to Company', click: () => { ctxSetScope(id, 'company'); } },
      { label: 'Make Private', click: () => { ctxSetScope(id, 'private'); } },
      { type: 'separator' },
      { label: 'Refresh', click: () => ctxReindex(id) },
      { type: 'separator' },
      { label: 'Move to Trash', click: () => ctxTrash(id, 'note') },
    ] : [
      { label: 'New Note', click: () => ctxNewNote(dir) },
      { label: 'New Folder', click: () => ctxNewFolder(dir) },
      { type: 'separator' },
      { label: 'Reveal in Finder', click: () => shell.showItemInFolder(id) },
      { type: 'separator' },
      { label: 'Copy Path', click: () => clipboard.writeText(id) },
      { label: 'Copy Relative Path', click: () => clipboard.writeText(relPath) },
      { label: 'Rename…', click: () => sendTreeAction({ action: 'rename-start', id, kind: 'folder' }) },
      { type: 'separator' },
      { label: 'Move to Trash', click: () => ctxTrash(id, 'folder') },
    ];
    Menu.buildFromTemplate(template).popup({ window: win });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) };
  }
});

// Commits an inline rename started via 'rename-start'. newName is the bare display
// name (no directory, and for notes, no .md suffix — it is added back here).
ipcMain.handle('tree:rename', (_e, { oldPath, newName, kind }) => {
  try {
    pathGuard(oldPath);
    const clean = sanitizeFileName(newName);
    if (!clean) return { ok: false, reason: 'Name cannot be empty' };
    const dir = path.dirname(oldPath);
    const newPath = kind === 'note' ? path.join(dir, clean.replace(/\.md$/i, '') + '.md') : path.join(dir, clean);
    if (newPath !== oldPath) {
      if (fs.existsSync(newPath)) return { ok: false, reason: 'A file or folder with that name already exists' };
      fs.renameSync(oldPath, newPath);
    }
    return { ok: true, newPath };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) };
  }
});

// ---------- IPC: config ----------
// Config lives in app.getPath('userData')/lore-config.json.
// Handlers are registered here but only invoked after the app is ready.
// Synchronous so preload can read the local API token at module-load time and
// attach it to its direct backend fetches (presets/ask/reindex).
ipcMain.on('local-token', (e) => { e.returnValue = localToken(); });

ipcMain.handle('config:get', () => loadConfig());

ipcMain.handle('config:set', (_e, partial) => {
  const current = loadConfig() || {};
  const merged = { ...current, ...partial };
  saveConfig(merged);
  return merged;
});

// ---------- IPC: config import (retrieval/upkeep settings from a JSON file) ----------
// Lets a user apply settings exported from another Lore install (or a shared team
// config). Only whitelisted keys with valid values are accepted — never a blind merge.
const IMPORTABLE_CONFIG_KEYS = {
  autoIndexOnSave:       (v) => typeof v === 'boolean',
  upkeepAuto:            (v) => typeof v === 'boolean',
  upkeepIntervalMinutes: (v) => Number.isFinite(v) && v >= 5 && v <= 24 * 60,
  llmProvider:           (v) => ['codex', 'claude', 'byok'].includes(v),
};

ipcMain.handle('config:import-retrieval', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Import Lore settings',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, reason: 'canceled' };
  let data;
  try { data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); }
  catch (e) { return { ok: false, reason: `Not valid JSON: ${String((e && e.message) || e)}` }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, reason: 'Expected a JSON object of settings.' };
  }
  const applied = {}, ignored = [];
  for (const [k, v] of Object.entries(data)) {
    const validate = IMPORTABLE_CONFIG_KEYS[k];
    if (!validate) { ignored.push(k); continue; }
    if (!validate(v)) return { ok: false, reason: `Invalid value for "${k}".` };
    applied[k] = v;
  }
  if (!Object.keys(applied).length) {
    return { ok: false, reason: `No recognized settings in that file (expected: ${Object.keys(IMPORTABLE_CONFIG_KEYS).join(', ')}).` };
  }
  const merged = { ...(loadConfig() || {}), ...applied };
  saveConfig(merged);
  // An imported upkeepAuto takes effect immediately (same behavior as the Settings toggle).
  if ('upkeepAuto' in applied) {
    if (applied.upkeepAuto === false) stopUpkeepInterval();
    else if (merged.tenant) startUpkeepInterval(merged.tenant);
  }
  return { ok: true, applied, ignored };
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
    headers: authHeaders(),
    onProgress: (evt) => {
      if (win && !win.isDestroyed()) win.webContents.send('scrape:progress', evt);
    },
  }).then((summary) => {
    refreshManifests('scrape', `indexed ${summary.files} file(s), ${summary.errors} error(s)`);
    if (win && !win.isDestroyed())
      win.webContents.send('scrape:progress', { phase: 'done', done: summary.files, total: summary.files, current: '', errors: summary.errors, summary });
  }).catch((e) => {
    if (win && !win.isDestroyed())
      win.webContents.send('scrape:progress', { phase: 'done', done: 0, total: 0, current: '', errors: 1, error: String(e) });
  });

  return { started: true };
});

// ---------- IPC: import (drop files/folders/zip → nodes) ----------
const IMPORT_TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.js', '.ts', '.py', '.json', '.yaml', '.yml', '.csv', '.html', '.css', '.rst', '.org', '.log', '.pdf', '.docx']);
const IMPORT_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif']);

function importRoot() {
  const cfg = loadConfig() || {};
  const vault = (Array.isArray(cfg.roots) && cfg.roots[0]) || ENV_VAULT_ROOT;
  if (!vault) return null;
  if (!cfg.scope || !cfg.owner || !cfg.tenant) return { error: 'Configure scope, owner, and tenant before importing.' };
  const dir = path.join(vault, 'Imported');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return { vault, dir, cfg };
}

// Import a dropped photo: copy the image into <vault>/assets/ and create a small
// viewable note that embeds it, so the picture actually lands in the library as a
// page (and its filename is searchable) rather than being silently skipped.
function importImageFile(srcPath, destDir, vault, summary) {
  try {
    const assetsDir = path.join(vault, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    const ext = path.extname(srcPath);
    const raw = path.basename(srcPath, ext).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 60) || 'image';
    let name = `${raw}${ext}`, i = 1;
    while (fs.existsSync(path.join(assetsDir, name))) name = `${raw}-${i++}${ext}`;
    fs.copyFileSync(srcPath, path.join(assetsDir, name));
    const title = path.basename(srcPath, ext);
    let note = path.join(destDir, `${raw}.md`), j = 1;
    while (fs.existsSync(note)) note = path.join(destDir, `${raw}-${j++}.md`);
    fs.writeFileSync(note, `# ${title}\n\n![${title}](assets/${name})\n`, 'utf8');
    summary.copied++;
  } catch { summary.errors++; }
}

function importCopyFile(srcPath, destDir, vault, summary) {
  const ext = path.extname(srcPath).toLowerCase();
  if (IMPORT_IMAGE_EXT.has(ext)) { importImageFile(srcPath, destDir, vault, summary); return; }
  if (!IMPORT_TEXT_EXT.has(ext)) { summary.skipped++; return; }
  const base = path.basename(srcPath);
  let dest = path.join(destDir, base), i = 1;
  while (fs.existsSync(dest)) { dest = path.join(destDir, base.replace(/(\.[^.]+)$/, `-${i}$1`)); i++; }
  try { fs.copyFileSync(srcPath, dest); summary.copied++; } catch { summary.errors++; }
}

function importWalkDir(srcDir, destDir, vault, summary) {
  let entries = [];
  try { entries = fs.readdirSync(srcDir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = path.join(srcDir, e.name);
    if (e.isDirectory()) importWalkDir(full, destDir, vault, summary);
    else importCopyFile(full, destDir, vault, summary);
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
      if (st.isDirectory()) importWalkDir(p, r.dir, r.vault, summary);
      else if (ext === '.zip') {
        const tmp = path.join(os.tmpdir(), 'lore-import-' + path.basename(p, '.zip').replace(/[^a-z0-9]/gi, '_'));
        try {
          fs.rmSync(tmp, { recursive: true, force: true });
          execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${p.replace(/'/g, "''")}' -DestinationPath '${tmp.replace(/'/g, "''")}' -Force`], { windowsHide: true });
          importWalkDir(tmp, r.dir, r.vault, summary);
        } catch { summary.errors++; }
      } else importCopyFile(p, r.dir, r.vault, summary);
    } catch { summary.errors++; }
  }
  if (summary.copied > 0) {
    registerRoot(r.dir);
    try {
      await runScrape({
        roots: [r.dir], excludes: [], extensions: undefined, maxFiles: 5000, maxBytes: 4 * 1024 * 1024,
        scope: r.cfg.scope, owner: r.cfg.owner, tenant: r.cfg.tenant,
        full: false, promptHistory: false,
        headers: authHeaders(),
        onProgress: (evt) => { if (win && !win.isDestroyed()) win.webContents.send('scrape:progress', evt); },
      });
    } catch { summary.errors++; }
    refreshManifests('import', `imported ${summary.copied} file(s), ${summary.errors} error(s)`);
    if (win && !win.isDestroyed()) win.webContents.send('scrape:progress', { phase: 'done', done: summary.copied, total: summary.copied, current: 'import complete', errors: summary.errors, summary });
  }
  return { ok: true, ...summary };
}

ipcMain.handle('import:files', (_e, paths) => runImport(paths));

// URL → note: backend fetches + extracts readable text (/ingest-url, SSRF-guarded).
ipcMain.handle('import:url', async (_e, url) => {
  const cfg = loadConfig() || {};
  if (!cfg.scope || !cfg.owner || !cfg.tenant) return { error: 'Configure scope, owner, and tenant before importing.' };
  try {
    const r = await fetch(`${BACKEND_URL()}/ingest-url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ url, scope: cfg.scope, owner: cfg.owner, tenant: cfg.tenant }),
    });
    const body = await r.json();
    if (!r.ok) return { error: body.detail || `HTTP ${r.status}` };
    return body;
  } catch (e) { return { error: String(e.message || e) }; }
});
ipcMain.handle('import:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Import into Lore', properties: ['openFile', 'openDirectory', 'multiSelections'] });
  if (r.canceled || !r.filePaths.length) return { ok: true, copied: 0, skipped: 0, errors: 0 };
  return runImport(r.filePaths);
});

// ---------- IPC: Google OAuth (desktop loopback) + Lore session ----------
// The Google client config (gitignored) lives at <repo>/secrets/google_oauth_client.json.
// Returns the parsed client config, or null when the gitignored secrets file
// isn't present (e.g. a dev build without OAuth provisioned) so callers can
// surface a clean "not configured" message instead of a raw ENOENT.
function loadGoogleClient() {
  const p = process.env.GOOGLE_OAUTH_CLIENT_FILE
    || path.join(__dirname, '..', 'secrets', 'google_oauth_client.json');
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const data = JSON.parse(raw);
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

// Decode a JWT payload (no verification — the backend already verified the
// id_token; we only need the display-name/email/avatar claims for the UI).
function decodeJwtClaims(jwt) {
  try {
    const part = String(jwt).split('.')[1];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) || {};
  } catch { return {}; }
}

// Sign in: run the loopback flow → get Google id_token → exchange at the Lore
// server for a session JWT → store it. Also persists the Google display name as
// the library owner so the greeting/avatar update. Returns { ok, user_id, email,
// name, scopes } or { ok:false, reason }.
ipcMain.handle('auth:login', async () => {
  try {
    const clientCfg = loadGoogleClient();
    if (!clientCfg) return { ok: false, reason: 'unavailable', detail: 'Google sign-in isn’t configured in this build.' };
    const tokens = await googleOauth.runLoopbackFlow(clientCfg, (url) => shell.openExternal(url));
    if (!tokens.id_token) return { ok: false, reason: 'no id_token from Google' };
    const claims = decodeJwtClaims(tokens.id_token);
    const r = await fetch(`${BACKEND_URL()}/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ id_token: tokens.id_token }),
    });
    const body = await r.json();
    if (!r.ok) return { ok: false, reason: body.detail || `server ${r.status}` };
    const email = body.email || claims.email || null;
    const name = body.name || claims.name || (email ? email.split('@')[0] : null);
    saveSession({ token: body.token, user_id: body.user_id, email, name, picture: claims.picture || null, scopes: body.scopes });
    // Persist the display name as the owner so the UI shows the real name (this is
    // the "sign-in changed nothing" fix — the name now propagates to config).
    try {
      const c = loadConfig() || {};
      if (name) c.owner = name;
      if (email) c.ownerEmail = email;
      saveConfig(c);
    } catch { /* non-fatal */ }
    return { ok: true, user_id: body.user_id, email, name, scopes: body.scopes };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

// Current session: validates the stored JWT against the server. Returns the user or null.
ipcMain.handle('auth:status', async () => {
  const sess = loadSession();
  if (!sess || !sess.token) return null;
  try {
    const r = await fetch(`${BACKEND_URL()}/auth/me`, { headers: { Authorization: `Bearer ${sess.token}` } });
    if (!r.ok) return null;
    const me = await r.json();
    return { user_id: me.user_id, email: sess.email, name: sess.name || (sess.email ? String(sess.email).split('@')[0] : null), picture: sess.picture || null, scopes: me.scopes };
  } catch { return null; }
});

ipcMain.handle('auth:logout', () => { clearSession(); return { ok: true }; });

// ---------- IPC: teams + invites (share a base with another user) ----------
// Thin authenticated proxies over the backend endpoints; the stored session JWT
// travels server-side only (renderer never sees the token).
async function authedFetch(pathname, opts = {}) {
  const sess = loadSession();
  if (!sess || !sess.token) return { ok: false, status: 401, body: { detail: 'not signed in' } };
  try {
    const r = await fetch(`${BACKEND_URL()}${pathname}`, {
      ...opts,
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${sess.token}`,
        ...(opts.headers || {}),
      },
    });
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: { detail: e.message } };
  }
}

ipcMain.handle('teams:create', async (_e, name) =>
  authedFetch('/teams', { method: 'POST', body: JSON.stringify({ name }) }));

ipcMain.handle('teams:invite', async (_e, teamId, email) =>
  authedFetch(`/teams/${encodeURIComponent(teamId)}/invites`, { method: 'POST', body: JSON.stringify({ email }) }));

ipcMain.handle('invites:list', async () => authedFetch('/invites'));

ipcMain.handle('invites:accept', async (_e, inviteId) =>
  authedFetch(`/invites/${encodeURIComponent(inviteId)}/accept`, { method: 'POST' }));

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
    // Titles only (bodies stay out of the IPC payload) — the detail view's "what's inside".
    noteTitles: (w.notes || []).map((n) => n.title),
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
      headers: authHeaders(),
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
      const fr = await fetch(`${BACKEND_URL()}/forget`, {
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

// ---------- IPC: personal wizards (an APPLIED Section promoted to a scoped RAG chat) ----------
// Pure backend state — no fs writes happen here (no pathGuard needed): the section's
// files already moved (path-guarded) when the user clicked Enable; promote just
// creates the wizard record the backend scopes retrieval + chat history to.

ipcMain.handle('wizards:promote-section', async (_e, sectionId) => {
  const cfg = loadConfig() || {};
  if (!cfg.tenant) return { ok: false, error: 'tenant is not configured' };
  try {
    const r = await postJSON(`${BACKEND_URL()}/sections/${encodeURIComponent(sectionId)}/promote`, { tenant: cfg.tenant });
    const body = await r.json();
    return r.ok ? body : { ok: false, error: body.detail || `backend ${r.status}` };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('wizards:personal-list', async () => {
  const cfg = loadConfig() || {};
  if (!cfg.tenant) return { wizards: [] };
  try {
    const r = await fetch(`${BACKEND_URL()}/wizards/personal?tenant=${encodeURIComponent(cfg.tenant)}`, { headers: authHeaders() });
    return await r.json();
  } catch (e) {
    return { wizards: [], error: String(e) };
  }
});

ipcMain.handle('wizards:personal-ask', async (_e, { id, question }) => {
  const cfg = loadConfig() || {};
  if (!cfg.tenant) return { error: 'tenant is not configured' };
  try {
    const r = await postJSON(`${BACKEND_URL()}/wizards/personal/${encodeURIComponent(id)}/ask`, { question, tenant: cfg.tenant });
    const body = await r.json();
    return r.ok ? body : { error: body.detail || `backend ${r.status}` };
  } catch (e) {
    return { error: String(e) };
  }
});

ipcMain.handle('wizards:personal-chat-history', async (_e, id) => {
  const cfg = loadConfig() || {};
  if (!cfg.tenant) return { messages: [] };
  try {
    const r = await fetch(`${BACKEND_URL()}/wizards/personal/${encodeURIComponent(id)}/chat?tenant=${encodeURIComponent(cfg.tenant)}`, { headers: authHeaders() });
    return await r.json();
  } catch (e) {
    return { messages: [], error: String(e) };
  }
});

// The wizard's member note titles/paths — feeds the detail view's "what's inside".
ipcMain.handle('wizards:personal-notes', async (_e, id) => {
  const cfg = loadConfig() || {};
  if (!cfg.tenant) return { notes: [] };
  try {
    const r = await fetch(`${BACKEND_URL()}/wizards/personal/${encodeURIComponent(id)}/notes?tenant=${encodeURIComponent(cfg.tenant)}`, { headers: authHeaders() });
    return await r.json();
  } catch (e) {
    return { notes: [], error: String(e) };
  }
});

// Chat-driven wizard creation: create an APPLIED section from an explicit note set
// (backend state only — no files move; the notes stay where they are) then promote
// it to a Personal Wizard with the chosen share scope. Two backend calls, one IPC.
ipcMain.handle('wizards:create-from-notes', async (_e, { name, noteIds, shareScope }) => {
  const cfg = loadConfig() || {};
  if (!cfg.tenant) return { ok: false, error: 'tenant is not configured' };
  try {
    const cr = await postJSON(`${BACKEND_URL()}/sections/create`,
      { tenant: cfg.tenant, name, note_ids: noteIds || [] });
    const sec = await cr.json();
    if (!cr.ok) return { ok: false, error: sec.detail || `backend ${cr.status}` };
    const pr = await postJSON(`${BACKEND_URL()}/sections/${encodeURIComponent(sec.id)}/promote`,
      { tenant: cfg.tenant, share_scope: shareScope || 'private' });
    const wiz = await pr.json();
    if (!pr.ok) return { ok: false, error: wiz.detail || `backend ${pr.status}` };
    const root = vaultRoot();
    if (root) { try { loreManifest.appendWorklog(root, { action: 'wizard-create', summary: `created wizard "${wiz.name}" from ${(noteIds || []).length} note(s) (${shareScope || 'private'})` }); } catch { /* ignore */ } }
    return { ok: true, wizard: wiz };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
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
  else if (tool === 'codex')  result = installer.uninstallCodex();
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

ipcMain.handle('mcp:detect',       () => mcpInstaller.detectMcp());              // Claude (legacy shape — renderer depends on it)
ipcMain.handle('mcp:detect-tools', () => mcpInstaller.detectMcpTools());         // per-tool {claude,codex}
ipcMain.handle('mcp:install',   (_e, tool) => (tool === 'codex' ? mcpInstaller.installCodexMcp() : mcpInstaller.installMcp()));
ipcMain.handle('mcp:uninstall', (_e, tool) => (tool === 'codex' ? mcpInstaller.uninstallCodexMcp() : mcpInstaller.uninstallMcp()));

// ---------- IPC: notes + search (backend proxies) ----------
// Proxied in main-process so the renderer never needs to lift CORS headers.

ipcMain.handle('notes:get', async (_e, id) => {
  try {
    const cfg = loadConfig() || {};
    if (!cfg.tenant) return { error: 'tenant is not configured' };
    const qs = `?tenant=${encodeURIComponent(cfg.tenant)}`;
    const r = await fetch(`${BACKEND_URL()}/notes/${encodeURIComponent(id)}${qs}`, { headers: authHeaders() });
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
    const r = await fetch(`${BACKEND_URL()}/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ query, scopes, k, tenant_id: cfg.tenant }),
    });
    return r.json();
  } catch (e) {
    return { error: String(e) };
  }
});

// ---------- IPC: upkeep ----------

// ---------- vault git IPC (M1-A) ----------
// All handlers path-guard the root and delegate to lib/vault-git (which
// re-checks that relPath stays inside the root).
function _vaultRootChecked() {
  const cfg = loadConfig() || {};
  const root = (Array.isArray(cfg.roots) && cfg.roots[0]) || null;
  if (!root) throw new Error('No library root configured');
  pathGuard(root);
  return root;
}

ipcMain.handle('vault:git-status', async () => {
  try {
    const root = _vaultRootChecked();
    const cfg = loadConfig() || {};
    const st = await vaultGit.status(root);
    return { ok: true, enabled: vaultGitActive(cfg), owned: cfg.vaultGitOwned === true, ...st };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('vault:git-history', async (_e, relPath) => {
  try {
    const root = _vaultRootChecked();
    return { ok: true, commits: await vaultGit.history(root, relPath) };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('vault:git-diff', async (_e, { relPath, oid }) => {
  try {
    const root = _vaultRootChecked();
    return { ok: true, diff: await vaultGit.diff(root, relPath, oid) };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('vault:git-restore', async (_e, { relPath, oid }) => {
  try {
    const root = _vaultRootChecked();
    const r = await vaultGit.restore(root, relPath, oid);
    // The watcher sees the restored write and auto-reindexes it.
    return { ok: true, ...r };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('vault:git-set-enabled', async (_e, enabled) => {
  const cfg = loadConfig() || {};
  cfg.vaultGitEnabled = enabled === true;
  saveConfig(cfg);
  if (enabled) { try { await ensureVaultRepo((cfg.roots || [])[0]); } catch { /* non-fatal */ } }
  return { ok: true, enabled: cfg.vaultGitEnabled };
});

ipcMain.handle('upkeep:run', async (_e, opts) => {
  const { tenant, scope } = opts || {};
  if (!tenant) return { error: 'tenant is required' };
  try {
    // cfg.autoClassify opts into tagging + Section PROPOSALS (state only — the
    // backend never moves files; applying a section is a separate user action).
    // cfg.autoFileObvious additionally opts into executing the returned
    // auto-file move plan (executeAutoFileMoves: pathGuard + worklog).
    const cfg = loadConfig() || {};
    const r = await fetch(`${BACKEND_URL()}/upkeep/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        tenant, scope,
        auto_classify: cfg.autoClassify === true,
        section_threshold: cfg.sectionThreshold || 5,
        auto_file: cfg.autoFileObvious === true,
        auto_journal: cfg.autoJournal === true,
      }),
    });
    const result = await r.json();
    if (r.ok) {
      try { await executeAutoFileMoves(result); } catch { /* moves retry next run */ }
      // Stamp when the library was last tidied/backfilled so the UI can show it.
      try { const c2 = loadConfig() || {}; c2.upkeepLastRun = new Date().toISOString(); saveConfig(c2); } catch { /* non-fatal */ }
    }
    refreshManifests('upkeep', `upkeep run — folded ${result.folded || 0}, topics ${result.topics || 0}`);
    // Notify the renderer so it can refresh the graph / status panel.
    if (win && !win.isDestroyed())
      win.webContents.send('scrape:progress', { phase: 'done', done: 0, total: 0, current: 'tidy-up complete', errors: 0, summary: result });
    return result;
  } catch (e) {
    return { error: String(e) };
  }
});

// ---------- IPC: sections (auto-proposed note folders) ----------
// SAFEGUARD: section proposals are computed in the background, but files move
// ONLY inside sections:apply / sections:undo below — i.e. only when the user
// clicks Enable/Undo in the renderer. Every move runs under pathGuard and the
// backend merely tracks state + original paths.

ipcMain.handle('sections:list', async () => {
  const cfg = loadConfig() || {};
  if (!cfg.tenant) return { sections: [] };
  try {
    const r = await fetch(`${BACKEND_URL()}/sections?tenant=${encodeURIComponent(cfg.tenant)}`, { headers: authHeaders() });
    return await r.json();
  } catch (e) {
    return { sections: [], error: String(e) };
  }
});

ipcMain.handle('sections:dismiss', async (_e, id) => {
  const cfg = loadConfig() || {};
  if (!cfg.tenant) return { ok: false, error: 'tenant is not configured' };
  try {
    const r = await postJSON(`${BACKEND_URL()}/sections/${encodeURIComponent(id)}/dismiss`, { tenant: cfg.tenant });
    const body = await r.json();
    return r.ok ? body : { ok: false, error: body.detail || `backend ${r.status}` };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// Moves one file (already pathGuard-ed) and keeps the index in sync:
// /forget the old path (its note id is path-derived), /reindex the new one.
async function moveAndReindex(from, to, cfg) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  const fromFwd = from.replace(/\\/g, '/');
  try { await postJSON(`${BACKEND_URL()}/forget`, { tenant: cfg.tenant, path_prefix: fromFwd }); } catch { /* index catches up on reconcile */ }
  try { await postJSON(`${BACKEND_URL()}/reindex`, { path: to, owner_id: cfg.owner, scope_id: cfg.scope, tenant_id: cfg.tenant }); } catch { /* ditto */ }
}

// ---------- auto-file (opt-in): execute upkeep's auto-file move plan ----------
// With cfg.autoFileObvious ON, upkeep records unambiguous notes into an EXISTING
// applied section (original path kept — undoable via the section's Undo) and
// returns the moves in stats.autoFile. Files move HERE only: under pathGuard,
// re-checked against the live config (NEVER when the toggle is off), and every
// executed move is logged to the .lore manifest worklog.
async function executeAutoFileMoves(result) {
  const moves = (result && result.autoFile && result.autoFile.moves) || [];
  const cfg = loadConfig() || {};
  if (!moves.length || cfg.autoFileObvious !== true) return;
  const root = vaultRoot();
  let moved = 0, skipped = 0;
  for (const mv of moves) {
    try {
      const from = path.normalize(mv.from);
      const to = path.normalize(mv.to);
      pathGuard(from); pathGuard(to);
      if (!fs.existsSync(from) || fs.existsSync(to)) { skipped++; continue; }
      await moveAndReindex(from, to, cfg);
      moved++;
      if (root) { try { loreManifest.appendWorklog(root, { action: 'auto-file', summary: `auto-filed "${path.basename(from)}" → ${mv.section || mv.section_id}` }); } catch { /* ignore */ } }
    } catch { skipped++; }
  }
  if (moved && win && !win.isDestroyed())
    win.webContents.send('scrape:progress', { phase: 'done', done: moved, total: moves.length, current: `auto-filed ${moved} note(s)`, errors: skipped });
}

ipcMain.handle('sections:apply', async (_e, id) => {
  const cfg = loadConfig() || {};
  const root = vaultRoot();
  if (!root || !cfg.tenant) return { ok: false, error: 'No library/tenant configured' };

  // Resolve the section name so the destination folder can be computed up front.
  let section;
  try {
    const lr = await fetch(`${BACKEND_URL()}/sections?tenant=${encodeURIComponent(cfg.tenant)}`, { headers: authHeaders() });
    const body = await lr.json();
    section = (body.sections || []).find((s) => s.id === id);
  } catch (e) { return { ok: false, error: String(e) }; }
  if (!section) return { ok: false, error: 'Section not found' };
  const destDir = path.join(root, safeVaultName(section.name, 'Section'));

  // Backend transition proposed -> applied; records each note's ORIGINAL path
  // for undo and returns the move plan. It does not touch the filesystem.
  let plan;
  try {
    const r = await postJSON(`${BACKEND_URL()}/sections/${encodeURIComponent(id)}/apply`,
      { tenant: cfg.tenant, dest_dir: destDir.replace(/\\/g, '/') });
    plan = await r.json();
    if (!r.ok) return { ok: false, error: plan.detail || `backend ${r.status}` };
  } catch (e) { return { ok: false, error: String(e) }; }

  // Execute the plan — the ONLY place proposed-section files move, and only
  // because the user clicked Enable. Never overwrites an existing file.
  try { fs.mkdirSync(destDir, { recursive: true }); } catch { /* exists */ }
  let moved = 0, skipped = 0;
  for (const mv of (plan.moves || [])) {
    try {
      const from = path.normalize(mv.from);
      const to = mv.to ? path.normalize(mv.to) : path.join(destDir, path.basename(from));
      pathGuard(from); pathGuard(to);
      if (!fs.existsSync(from) || fs.existsSync(to)) { skipped++; continue; }
      await moveAndReindex(from, to, cfg);
      moved++;
    } catch { skipped++; }
  }
  try { loreManifest.appendWorklog(root, { action: 'section-apply', summary: `applied section "${section.name}" — moved ${moved} note(s)` }); } catch { /* ignore */ }
  refreshManifests();
  if (win && !win.isDestroyed())
    win.webContents.send('scrape:progress', { phase: 'done', done: moved, total: (plan.moves || []).length, current: `section "${section.name}" applied`, errors: skipped });
  return { ok: true, moved, skipped, folder: destDir };
});

ipcMain.handle('sections:undo', async (_e, id) => {
  const cfg = loadConfig() || {};
  const root = vaultRoot();
  if (!root || !cfg.tenant) return { ok: false, error: 'No library/tenant configured' };

  // Backend transition applied -> proposed; returns the recorded original paths.
  let plan;
  try {
    const r = await postJSON(`${BACKEND_URL()}/sections/${encodeURIComponent(id)}/undo`, { tenant: cfg.tenant });
    plan = await r.json();
    if (!r.ok) return { ok: false, error: plan.detail || `backend ${r.status}` };
  } catch (e) { return { ok: false, error: String(e) }; }

  // Move each file back to its recorded original path (user-initiated only).
  let moved = 0, skipped = 0;
  const sectionDirs = new Set();
  for (const mv of (plan.moves || [])) {
    try {
      const from = path.normalize(mv.from);                     // original location
      const current = mv.to ? path.normalize(mv.to) : null;     // where apply put it
      if (!current) { skipped++; continue; }
      pathGuard(current); pathGuard(from);
      if (!fs.existsSync(current) || fs.existsSync(from)) { skipped++; continue; }
      sectionDirs.add(path.dirname(current));
      await moveAndReindex(current, from, cfg);
      moved++;
    } catch { skipped++; }
  }
  // Tidy up now-empty section folders (best-effort; never recursive).
  for (const dir of sectionDirs) {
    try { if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir); } catch { /* keep it */ }
  }
  try { loreManifest.appendWorklog(root, { action: 'section-undo', summary: `undid section "${plan.name || id}" — restored ${moved} note(s)` }); } catch { /* ignore */ }
  refreshManifests();
  if (win && !win.isDestroyed())
    win.webContents.send('scrape:progress', { phase: 'done', done: moved, total: (plan.moves || []).length, current: 'section undo complete', errors: skipped });
  return { ok: true, moved, skipped };
});

// ---------- IPC: enrichment LLM providers (codex sub / claude sub / byok) ----------
ipcMain.handle('enrich:providers', async () => {
  try {
    const r = await fetch(`${BACKEND_URL()}/enrich/providers`, { headers: authHeaders() });
    return await r.json();   // { codex, claude, byok }
  } catch (e) { return { codex: false, claude: false, byok: false, error: String(e) }; }
});

ipcMain.handle('enrich:run', async (_e, opts) => {
  const { tenant, limit, provider } = opts || {};
  if (!tenant) return { error: 'tenant is required' };
  try {
    const r = await fetch(`${BACKEND_URL()}/enrich`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
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
    const r = await fetch(`${BACKEND_URL()}/upkeep/status`, { headers: authHeaders() });
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

// ---------- IPC: retrieval config (backend /config/retrieval proxy) ----------
// Truthful snapshot of the retrieval stack (embedder/reranker/contextual/local-fallback)
// for the Settings "Indexing & recall" section. {error} when the backend is down.
ipcMain.handle('retrieval:config', async () => {
  try {
    const cfg = loadConfig() || {};
    const qs = cfg.tenant ? `?tenant=${encodeURIComponent(cfg.tenant)}` : '';
    const r = await fetch(`${BACKEND_URL()}/config/retrieval${qs}`, { headers: authHeaders() });
    return await r.json();
  } catch (e) {
    return { error: String(e) };
  }
});

// ---------- IPC: CLI install (put `lore` on the user's PATH) ----------
// Delegates to cli-installer.js; no sudo, user-writable PATH dir only, idempotent.
ipcMain.handle('cli:status',  () => cliInstaller.cliStatus());
ipcMain.handle('cli:install', () => cliInstaller.installCli());

// ---------- IPC: graph ----------
// Fetches /graph from the backend in main-process (avoids CORS from renderer).
// Cheap per-tenant counts — the renderer polls this to keep the graph/tree live
// as captures land (agent hooks, auto-index) without refetching the full graph.
ipcMain.handle('stats:get', async (_e, tenant) => {
  const cfg = loadConfig() || {};
  const t = tenant || cfg.tenant || '';
  const r = await fetch(`${BACKEND_URL()}/stats?tenant=${encodeURIComponent(t)}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`backend /stats returned ${r.status}`);
  return r.json();
});

// This-week digest for the Home tab: notes grouped by day × section, plus the
// created-since-yesterday count. Backend does the grouping (no LLM).
ipcMain.handle('digest:get', async (_e, opts) => {
  const cfg = loadConfig() || {};
  const { tenant, days } = opts || {};
  const t = tenant || cfg.tenant || '';
  if (!t) return { rows: [], sinceYesterday: 0, total: 0 };
  try {
    const r = await fetch(`${BACKEND_URL()}/digest?tenant=${encodeURIComponent(t)}&days=${encodeURIComponent(days || 7)}`,
      { headers: authHeaders() });
    if (!r.ok) return { rows: [], sinceYesterday: 0, total: 0, error: `backend ${r.status}` };
    return await r.json();
  } catch (e) {
    return { rows: [], sinceYesterday: 0, total: 0, error: String(e) };
  }
});

ipcMain.handle('graph:get', async (_e, opts) => {
  const cfg = loadConfig() || {};
  const scopes = Array.isArray(opts) ? opts.join(',') : (opts && opts.scopes ? opts.scopes : '');
  const tenant = (opts && opts.tenant) || cfg.tenant || '';
  const params = new URLSearchParams();
  if (tenant) params.set('tenant', tenant);
  if (scopes) params.set('scopes', Array.isArray(scopes) ? scopes.join(',') : scopes);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const r = await fetch(`${BACKEND_URL()}/graph${qs}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`backend /graph returned ${r.status}`);
  return r.json();
});

// ---------- boot-time disk<->index reconcile ----------
// A store swap (e.g. Postgres -> SQLite) or a fresh machine can leave the on-disk
// vault far ahead of what's actually indexed, with nothing that ever re-scans
// automatically. This runs once per app launch, right after the backend becomes
// reachable, to detect that gap and self-heal with a background re-index.
//
// Contract: fire-and-forget. MUST NOT delay window or backend startup, MUST NOT
// throw (every failure path is caught + logged), and MUST NOT run twice in one
// process (reconcileStarted guard below).
const RECONCILE_THRESHOLD_DEFAULT = 10;
let reconcileStarted = false;

async function reconcileIndex(bootStatus) {
  if (reconcileStarted) return;
  // Only reconcile when the backend actually came up — a 'timeout'/'no-core'
  // result means there is nothing to query and nothing to re-index against.
  if (bootStatus !== 'already-running' && bootStatus !== 'spawned') return;
  reconcileStarted = true;
  try {
    const cfg = loadConfig();
    if (!cfg || cfg.autoReconcile === false) return;
    const roots = Array.isArray(cfg.roots) ? cfg.roots : [];
    if (!roots.length || !cfg.tenant) return;

    let diskCount = 0;
    for (const root of roots) diskCount += countNotes(buildTree(root));

    const r = await fetch(`${BACKEND_URL()}/stats?tenant=${encodeURIComponent(cfg.tenant)}`, { headers: authHeaders() });
    if (!r.ok) return;
    const stats = await r.json();
    const indexedCount = (stats && typeof stats.notes === 'number') ? stats.notes : 0;
    // Tombstoned paths: on disk but deliberately folded out of the index by
    // upkeep. Counting them as "unindexed" re-triggered a full re-scrape every
    // boot (whose re-indexed notes upkeep then re-folded — endless churn).
    const foldedCount = (stats && typeof stats.foldedPaths === 'number') ? stats.foldedPaths : 0;

    const threshold = cfg.reconcileThreshold || RECONCILE_THRESHOLD_DEFAULT;
    if (diskCount - indexedCount - foldedCount <= threshold) return; // in sync (or index ahead) — nothing to do

    console.log(`[reconcile] disk=${diskCount} indexed=${indexedCount} folded=${foldedCount} (threshold ${threshold}) — starting background re-index`);
    const summary = await runScrape({
      roots,
      excludes:  cfg.excludes,
      extensions: cfg.extensions,
      maxFiles:  cfg.maxFiles,
      maxBytes:  cfg.maxBytes,
      scope:     cfg.scope,
      owner:     cfg.owner,
      tenant:    cfg.tenant,
      full:      false,
      promptHistory: false,
      headers:   authHeaders(),
      // Reuse the existing scrape:progress renderer plumbing so the app's progress
      // banner shows this exactly like a user-initiated scrape.
      onProgress: (evt) => { if (win && !win.isDestroyed()) win.webContents.send('scrape:progress', evt); },
    });
    refreshManifests('reconcile', `re-indexed ${summary.files} file(s), ${summary.errors} error(s)`);
    if (win && !win.isDestroyed()) {
      win.webContents.send('scrape:progress', {
        phase: 'done', done: summary.files, total: summary.files,
        current: 'reconcile complete', errors: summary.errors, summary,
      });
    }
  } catch (e) {
    console.error('[reconcile] error (non-fatal):', e);
  }
}

// ---------- window ----------
async function createWindow() {
  const windowOptions = {
    width: 1440, height: 900, minWidth: 1040, minHeight: 640,
    backgroundColor: '#101116', show: false,
    title: 'Lore',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,          // preload only uses contextBridge/ipcRenderer/fetch — sandbox-safe
      webSecurity: true,      // explicit: keep same-origin policy on for the renderer
    },
  };
  if (process.platform === 'darwin') {
    windowOptions.titleBarStyle = 'hiddenInset';
    windowOptions.trafficLightPosition = { x: 16, y: 16 };
  }
  win = new BrowserWindow(windowOptions);
  win.removeMenu();

  // Navigation lockdown: the renderer should only ever be the bundled index.html.
  // Any attempt to navigate elsewhere (e.g. injected code doing location=…) is blocked,
  // and window.open / target=_blank goes to the OS browser, never a node-less Electron
  // child window. Defends the IPC bridge even if renderer content is compromised.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  const blockNav = (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  };
  win.webContents.on('will-navigate', blockNav);
  win.webContents.on('will-redirect', blockNav);
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
  // App icon — in dev (`electron .`) the dock/taskbar shows Electron's default
  // icon; set ours explicitly. Packaged builds get it from electron-builder config.
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
    if (!icon.isEmpty() && app.dock && app.dock.setIcon) app.dock.setIcon(icon);
  } catch { /* non-fatal */ }

  // macOS "About Lore" panel — without this, the Apple-menu About item (and some
  // dock hover contexts) fall back to the Electron default identity in dev.
  if (process.platform === 'darwin' && app.setAboutPanelOptions) {
    try { app.setAboutPanelOptions({ applicationName: 'Lore' }); } catch { /* non-fatal */ }
  }

  const cfg = loadConfig();
  // Path-guard: bless the user's persisted library roots on boot so the renderer can
  // reopen them (readTree/read/write) without vault:tree having to self-register an
  // arbitrary renderer-supplied path. Only these + native-dialog picks are ever allowed.
  if (cfg && Array.isArray(cfg.roots)) cfg.roots.forEach(registerRoot);
  // Upkeep defaults to auto-ON for a configured user: undefined/missing means on;
  // only an explicit false (the user toggled it off in Settings) disables it.
  if (cfg && cfg.upkeepAuto !== false && cfg.tenant) startUpkeepInterval(cfg.tenant);
  // Refresh the backup once on launch (catches changes made while closed).
  if (cfg && cfg.backupEnabled && cfg.backupDir) setTimeout(() => runBackup('startup'), 4000);

  // Auto-update via GitHub Releases (electron-updater reads latest*.yml attached
  // by the release workflow). Packaged builds only; kill-switch cfg.autoUpdate=false.
  // Fail-open: an update-check failure must never affect the app. NOTE: on macOS
  // electron-updater requires SIGNED builds — until signing secrets are configured
  // this is inert on mac (logs and moves on); Windows/Linux work unsigned.
  if (app.isPackaged && (!cfg || cfg.autoUpdate !== false)) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.on('error', (e) => console.warn('[updater]', e && e.message));
      autoUpdater.checkForUpdatesAndNotify().catch((e) => console.warn('[updater]', e && e.message));
    } catch (e) { console.warn('[updater] unavailable:', e && e.message); }
  }

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
  // Once the backend resolves, kick off the async disk<->index reconcile in the
  // background (see reconcileIndex above) — never awaited, never blocks the window.
  ensureBackend()
    .then((status) => { reconcileIndex(status).catch((e) => console.error('[reconcile] uncaught', e)); })
    .catch((e) => console.error('backend startup error', e));
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
