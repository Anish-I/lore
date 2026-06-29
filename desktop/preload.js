// Lore desktop — preload: the only bridge between renderer and Node/main.
// Exposes window.lore with filesystem (via IPC) + backend (via fetch).
const { contextBridge, ipcRenderer } = require('electron');

const BACKEND = 'http://localhost:8099';

contextBridge.exposeInMainWorld('lore', {
  // --- filesystem (main process) ---
  pickVault:      ()           => ipcRenderer.invoke('vault:pick'),
  createVault:    (opts)       => ipcRenderer.invoke('vault:create', opts || {}),
  readTree:       (root)       => ipcRenderer.invoke('vault:tree', root),
  readNote:       (path)       => ipcRenderer.invoke('note:read', path),
  writeNote:      (path, text) => ipcRenderer.invoke('note:write', { path, text }),
  onVaultChanged: (cb)         => ipcRenderer.on('vault:changed', (_e, payload) => cb(payload)),

  // --- config (persisted to userData/lore-config.json) ---
  config: {
    // Returns the full config object, or null on first run.
    get: ()        => ipcRenderer.invoke('config:get'),
    // Shallow-merges partial into current config, persists, and returns the merged result.
    set: (partial) => ipcRenderer.invoke('config:set', partial),
  },

  // --- scraper ---
  // Kicks off a one-shot crawl. Resolves to {started:true} immediately.
  // Progress arrives via scrapeProgress(cb). Typical call order:
  //   await window.lore.config.set({ roots:['/my/vault'], scope:'team' })
  //   const unsub = window.lore.scrapeProgress((evt) => { ... })
  //   await window.lore.startScrape()   // uses persisted config; or pass overrides
  //   // when evt.phase === 'done', call unsub()
  startScrape: (config) => ipcRenderer.invoke('scrape:start', config || {}),

  // Subscribe to scrape progress events. Returns an unsubscribe function.
  // cb receives: {phase:'walk'|'ingest'|'edges'|'done', done:int, total:int, current:string, errors:int}
  scrapeProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('scrape:progress', handler);
    return () => ipcRenderer.removeListener('scrape:progress', handler);
  },

  // --- graph ---
  // Fetches {nodes, edges} from the backend via main (avoids CORS).
  // opts: {tenant, scopes} where scopes may be an array or comma-separated string.
  graph: (opts) => ipcRenderer.invoke('graph:get', opts),

  // --- import ---
  // importFiles(paths) → copy files/folders/zips into the vault + index them. {ok, copied, skipped, errors}
  // importPick()       → open a file/folder picker then import the selection.
  importFiles: (paths) => ipcRenderer.invoke('import:files', paths),
  importPick:  ()      => ipcRenderer.invoke('import:pick'),

  // --- wizards (installable knowledge bases) ---
  wizards: {
    catalog:   ()           => ipcRenderer.invoke('wizards:catalog'),
    install:   (id)         => ipcRenderer.invoke('wizards:install', id),
    uninstall: (id)         => ipcRenderer.invoke('wizards:uninstall', id),
    rate:      (id, stars)  => ipcRenderer.invoke('wizards:rate', { id, stars }),
  },

  // --- hooks ---
  // detect()           → [{id, name, description, detected, installed}, ...]
  // install({tool, …}) → {ok, reason?}
  // uninstall(tool?)   → {ok, reason?}
  // status(sessionId?) → backend /capture/status proxy
  hooks: {
    detect:    ()                => ipcRenderer.invoke('hooks:detect'),
    install:   (opts)            => ipcRenderer.invoke('hooks:install', opts || {}),
    uninstall: (tool) => ipcRenderer.invoke('hooks:uninstall', tool),
    status:    (sessionId)       => ipcRenderer.invoke('hooks:status', sessionId),
  },

  // Subscribe to hook installation-state change events (fired after install/uninstall).
  // cb receives the same array as hooks.detect(). Returns an unsubscribe function.
  onHooksUpdate: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('hooks:update', handler);
    return () => ipcRenderer.removeListener('hooks:update', handler);
  },

  // --- auth (Google OAuth desktop loopback → Lore session) ---
  // login()  → opens the browser for Google sign-in; resolves {ok, user_id, email, scopes} or {ok:false, reason}
  // status() → current signed-in user {user_id, email, scopes} or null
  // logout() → clears the stored session
  auth: {
    login:  () => ipcRenderer.invoke('auth:login'),
    status: () => ipcRenderer.invoke('auth:status'),
    logout: () => ipcRenderer.invoke('auth:logout'),
  },

  // --- MCP server ---
  // detect()    → { detected, installed, configPath }
  // install()   → { ok, backupPath, configPath, reason? }
  // uninstall() → { ok, reason? }
  mcp: {
    detect:    () => ipcRenderer.invoke('mcp:detect'),
    install:   () => ipcRenderer.invoke('mcp:install'),
    uninstall: () => ipcRenderer.invoke('mcp:uninstall'),
  },

  // --- notes (backend proxy) ---
  // get(id) → backend /notes/:id response (or {error} on failure)
  notes: {
    get: (id) => ipcRenderer.invoke('notes:get', id),
  },

  // --- search (backend proxy) ---
  // search(query, scopes, k) → backend POST /search response (or {error})
  search: (query, scopes, k) => ipcRenderer.invoke('search', { query, scopes, k }),

  // --- upkeep ---
  // run(opts?)    → triggers backend /upkeep/run; fires scrapeProgress 'done' when complete
  // status()      → backend GET /upkeep/status response
  // setAuto(bool) → persists config.upkeepAuto; starts/stops 30-min background scheduler
  upkeep: {
    run:     (opts) => ipcRenderer.invoke('upkeep:run', opts || {}),
    status:  ()     => ipcRenderer.invoke('upkeep:status'),
    setAuto: (on)   => ipcRenderer.invoke('upkeep:set-auto', on),
  },

  // --- backend (the running lore.api) ---
  presets: async () => {
    const r = await fetch(`${BACKEND}/presets`);
    return r.json();
  },
  ask: async (question, scopes, tenant, model) => {
    const r = await fetch(`${BACKEND}/trace`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, principal_scopes: scopes, tenant_id: tenant, model: model || null }),
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
