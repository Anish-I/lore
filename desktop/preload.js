// Lore desktop — preload: the only bridge between renderer and Node/main.
// Exposes window.lore with filesystem (via IPC) + backend (via fetch).
const { contextBridge, ipcRenderer } = require('electron');

const BACKEND = 'http://localhost:8099';

contextBridge.exposeInMainWorld('lore', {
  // --- filesystem (main process) ---
  pickVault: () => ipcRenderer.invoke('vault:pick'),
  defaultVault: () => ipcRenderer.invoke('vault:default'),
  readTree: (root) => ipcRenderer.invoke('vault:tree', root),
  readNote: (path) => ipcRenderer.invoke('note:read', path),
  writeNote: (path, text) => ipcRenderer.invoke('note:write', { path, text }),
  onVaultChanged: (cb) => ipcRenderer.on('vault:changed', (_e, payload) => cb(payload)),

  // --- backend (the running lore.api) ---
  presets: async () => {
    const r = await fetch(`${BACKEND}/presets`);
    return r.json();
  },
  ask: async (question, scopes, tenant) => {
    const r = await fetch(`${BACKEND}/trace`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, principal_scopes: scopes, tenant_id: tenant }),
    });
    if (!r.ok) throw new Error('backend ' + r.status);
    return r.json();
  },
  reindex: async (path, owner, scope, tenant) => {
    const r = await fetch(`${BACKEND}/reindex`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, owner_id: owner, scope_id: scope, tenant_id: tenant }),
    });
    return r.json();
  },
});
