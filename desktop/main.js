// Lore desktop — Electron main process.
// Owns the OS: file explorer (fs), spawns the Python `lore` retrieval backend,
// and serves IPC for the renderer's window.lore bridge.
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const BACKEND_PORT = 8099;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const CORE_DIR = path.join(__dirname, '..', 'core');
const DEFAULT_VAULT = process.env.LORE_VAULT
  || (fs.existsSync(path.join(__dirname, '..', 'sample-vault')) ? path.join(__dirname, '..', 'sample-vault') : null);

let win = null;
let backendProc = null;
let watcher = null;

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
    env: { ...process.env, VAULT_PROFILE: process.env.VAULT_PROFILE || 'acme' },
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
      const m = fm[1].match(/^scope:\s*([a-zA-Z]+)/m);
      if (m) {
        const s = m[1].toLowerCase();
        if (['private', 'team', 'enterprise'].includes(s)) return s;
      }
    }
  } catch { /* ignore */ }
  return 'private';
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
  try {
    const chokidar = require('chokidar');
    watcher = chokidar.watch(root, { ignoreInitial: true, depth: 8, ignored: /(^|[\/\\])\../ });
    const notify = (event, p) => { if (win && p && p.toLowerCase().endsWith('.md')) win.webContents.send('vault:changed', { event, path: p }); };
    watcher.on('add', (p) => notify('add', p)).on('change', (p) => notify('change', p)).on('unlink', (p) => notify('unlink', p));
  } catch (e) { console.error('watch error', e); }
}

// ---------- IPC ----------
ipcMain.handle('vault:default', () => DEFAULT_VAULT);

ipcMain.handle('vault:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Open a Lore vault', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths.length) return null;
  const root = r.filePaths[0];
  startWatch(root);
  const tree = buildTree(root);
  return { root, name: path.basename(root), tree, indexed: countNotes(tree) };
});

ipcMain.handle('vault:tree', (_e, root) => {
  if (!root || !fs.existsSync(root)) return null;
  startWatch(root);
  const tree = buildTree(root);
  return { root, name: path.basename(root), tree, indexed: countNotes(tree) };
});

ipcMain.handle('note:read', (_e, p) => {
  try { return { path: p, raw: fs.readFileSync(p, 'utf8') }; } catch (e) { return { path: p, raw: '', error: String(e) }; }
});

ipcMain.handle('note:write', (_e, { path: p, text }) => {
  try { fs.writeFileSync(p, text, 'utf8'); return { ok: true }; } catch (e) { return { ok: false, error: String(e) }; }
});

// ---------- window ----------
async function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1040, minHeight: 640,
    backgroundColor: '#101116', show: false,
    title: 'Lore',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.show();
}

app.whenReady().then(async () => {
  await ensureBackend(); // best-effort; renderer shows a banner if it's not reachable
  await createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (backendProc) try { backendProc.kill(); } catch {} if (watcher) try { watcher.close(); } catch {} });
