// Lore desktop — preload: the only bridge between renderer and Node/main.
// Exposes window.lore with filesystem (via IPC) + backend (via fetch).
const { contextBridge, ipcRenderer } = require('electron');

const BACKEND = 'http://localhost:8099';

// Local API token — fetched synchronously at load so the direct backend fetches
// below carry it. main.js generates/persists it; the backend enforces it.
let LOCAL_TOKEN = '';
try { LOCAL_TOKEN = ipcRenderer.sendSync('local-token') || ''; } catch { /* backend unlocked */ }
function authH(extra) { return LOCAL_TOKEN ? { ...extra, 'X-Lore-Token': LOCAL_TOKEN } : { ...extra }; }

contextBridge.exposeInMainWorld('lorePeople', {
  peopleList: (tenant, scopes) =>
    fetch(`${BACKEND}/people?tenant=${encodeURIComponent(tenant)}&scopes=${encodeURIComponent(scopes)}`, { headers: authH() }).then((r) => r.json()),
  peopleDetail: (tenant, scopes, personId) =>
    fetch(`${BACKEND}/people/detail?tenant=${encodeURIComponent(tenant)}&scopes=${encodeURIComponent(scopes)}&person_id=${encodeURIComponent(personId)}`, { headers: authH() }).then((r) => r.json()),
  peopleMerge: (tenant, keepId, mergeId) =>
    fetch(`${BACKEND}/people/merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authH() },
      body: JSON.stringify({ tenant, keep_id: keepId, merge_id: mergeId }),
    }).then((r) => r.json()),
  peopleHide: (tenant, personId) =>
    fetch(`${BACKEND}/people/hide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authH() },
      body: JSON.stringify({ tenant, person_id: personId }),
    }).then((r) => r.json()),
});

contextBridge.exposeInMainWorld('lore', {
  // --- filesystem (main process) ---
  pickVault:      ()           => ipcRenderer.invoke('vault:pick'),
  createVault:    (opts)       => ipcRenderer.invoke('vault:create', opts || {}),
  readTree:       (root)       => ipcRenderer.invoke('vault:tree', root),
  readNote:       (path)       => ipcRenderer.invoke('note:read', path),
  writeNote:      (path, text) => ipcRenderer.invoke('note:write', { path, text }),
  // Inline images for the WYSIWYG editor. addImage() opens a picker, copies the
  // file into <vault>/assets/, and returns { ok, rel, dataUrl }. assetDataUrl(rel)
  // resolves a stored `assets/…` path to a data: URL for display under the CSP.
  addImage:       ()          => ipcRenderer.invoke('note:add-image'),
  assetDataUrl:   (rel)       => ipcRenderer.invoke('asset:dataurl', rel),
  // Change a note's scope (confidentiality). Broadening is blocked if the note
  // has secrets unless force:true. Resolves {ok, scope, broadened} or {ok:false, reason}.
  setNoteScope:   (path, scope, force) => ipcRenderer.invoke('note:set-scope', { path, scope, force }),

  // Move a note to the OS trash (page-view delete button). Reconciliation
  // arrives via the 'trashed' tree action, same as the tree context menu.
  trashNote:      (path) => ipcRenderer.invoke('note:trash', path),

  // --- audit log (compliance trail) ---
  queryLog: {
    list: async (tenant, limit) => {
      const r = await fetch(`${BACKEND}/query-log?tenant=${encodeURIComponent(tenant)}&limit=${limit || 50}`, { headers: authH() });
      return r.json();
    },
    purge: async (tenant) => {
      const r = await fetch(`${BACKEND}/query-log/purge`, {
        method: 'POST', headers: authH({ 'content-type': 'application/json' }),
        body: JSON.stringify({ tenant }),
      });
      return r.json();
    },
  },

  // --- vault git history (autocommit snapshots; per-note history/diff/restore) ---
  vaultGit: {
    status:     ()               => ipcRenderer.invoke('vault:git-status'),
    history:    (relPath)        => ipcRenderer.invoke('vault:git-history', relPath),
    diff:       (relPath, oid)   => ipcRenderer.invoke('vault:git-diff', { relPath, oid }),
    restore:    (relPath, oid)   => ipcRenderer.invoke('vault:git-restore', { relPath, oid }),
    setEnabled: (enabled)        => ipcRenderer.invoke('vault:git-set-enabled', enabled),
    onCommitted: (cb) => {
      const h = (_e, payload) => cb(payload);
      ipcRenderer.on('vault:git-committed', h);
      return () => ipcRenderer.removeListener('vault:git-committed', h);
    },
  },

  // --- backup mirror (SharePoint/OneDrive assurance) ---
  backup: {
    pickDir: () => ipcRenderer.invoke('backup:pick-dir'),
    run:     () => ipcRenderer.invoke('backup:run'),
    status:  () => ipcRenderer.invoke('backup:status'),
    onChange: (cb) => {
      const h = (_e, payload) => cb(payload);
      ipcRenderer.on('backup:changed', h);
      return () => ipcRenderer.removeListener('backup:changed', h);
    },
  },
  importUrl:      (url)        => ipcRenderer.invoke('import:url', url),
  onVaultChanged: (cb)         => ipcRenderer.on('vault:changed', (_e, payload) => cb(payload)),

  // --- sidebar context menu (native, main-process) ---
  // treeContextMenu(id, kind, root) → pops a native right-click menu for a note/folder row.
  //   Pure-fs actions (new note/folder, duplicate, copy, trash) run in main; actions that need
  //   renderer state (open a tab, start an inline rename) arrive via onTreeAction(cb).
  // treeRename(oldPath, newName, kind) → commits an inline rename; resolves {ok, newPath?, reason?}.
  treeContextMenu: (id, kind, root)        => ipcRenderer.invoke('tree:context-menu', { id, kind, root }),
  treeRename:      (oldPath, newName, kind) => ipcRenderer.invoke('tree:rename', { oldPath, newName, kind }),
  onTreeAction: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('tree:action', handler);
    return () => ipcRenderer.removeListener('tree:action', handler);
  },

  // --- config (persisted to userData/lore-config.json) ---
  config: {
    // Returns the full config object, or null on first run.
    get: ()        => ipcRenderer.invoke('config:get'),
    // Shallow-merges partial into current config, persists, and returns the merged result.
    set: (partial) => ipcRenderer.invoke('config:set', partial),
    // Opens a file picker for a JSON settings file (retrieval/upkeep keys only,
    // validated in main). Returns {ok, applied, ignored} or {ok:false, reason}.
    importRetrieval: () => ipcRenderer.invoke('config:import-retrieval'),
  },

  // --- retrieval config (backend GET /config/retrieval proxy) ---
  // config() → {embeddingModel, reranker, contextualRetrieval, localFallback} or {error}
  retrieval: {
    config: () => ipcRenderer.invoke('retrieval:config'),
  },

  // --- CLI install (put `lore` on the user's PATH; no sudo, idempotent) ---
  // status()  → {installed, path, target?, mechanism?, onPath, hint?}
  // install() → {ok, path, mechanism, onPath, hint?} or {ok:false, reason}
  cli: {
    status:  () => ipcRenderer.invoke('cli:status'),
    install: () => ipcRenderer.invoke('cli:install'),
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

  // --- stats (live counts for graph/tree refresh polling) ---
  stats: (tenant) => ipcRenderer.invoke('stats:get', tenant),

  // --- recent AI-session prompts (Home suggestion mining) ---
  recentPrompts: async (tenant, limit) => {
    const r = await fetch(`${BACKEND}/recent-prompts?tenant=${encodeURIComponent(tenant)}&limit=${limit || 200}`, { headers: authH() });
    return r.json();
  },

  // --- digest (Home tab: notes grouped by day × section + since-yesterday count) ---
  // digest(tenant, days) → {rows:[{day, section, count, topTitles}], sinceYesterday, total}
  digest: (tenant, days, scopes) => ipcRenderer.invoke('digest:get', { tenant, days, scopes }),

  // --- to-dos wizard (thread → action items, confirm/dismiss) ---
  // extract({text|note_id, scope?, owner?}) → {todos:[{id, assignee, task, due, due_text, source, status, scope_id}], count}
  // list({scopes, status?})   → {todos:[...], count} (scope-filtered like digest)
  // confirm/dismiss({id, scopes}) → {id, status} | {error} (404 when not in caller's scopes)
  // syncMailbox({scope?, owner?}) → picks a folder, ingests its .eml into pending
  //   to-dos (idempotent) → {processed, skipped, todos_created, folder} | {cancelled} | {error}
  todos: {
    extract: (opts)          => ipcRenderer.invoke('todos:extract', opts || {}),
    list:    (opts)          => ipcRenderer.invoke('todos:list', opts || {}),
    confirm: (id, scopes)    => ipcRenderer.invoke('todos:confirm', { id, scopes }),
    dismiss: (id, scopes)    => ipcRenderer.invoke('todos:dismiss', { id, scopes }),
    syncMailbox: (opts)      => ipcRenderer.invoke('todos:sync-mailbox', opts || {}),
  },

  // --- ask chat history (persisted threads for the main chat) ---
  // append(tenant, turn) → {ok, id}; turn = {thread_id, role, text, sources?, source?}
  // thread(tenant, threadId) → {messages:[...]} oldest first
  // recent(tenant, limit?)   → {messages:[...]} across threads (suggestPrompts mining)
  // threads(tenant)          → {threads:[{thread_id, title, count, updated_at}]}
  // remove(tenant, threadId) → {ok, deleted}
  askHistory: {
    append: async (tenant, turn) => {
      const r = await fetch(`${BACKEND}/ask-history`, {
        method: 'POST', headers: authH({ 'content-type': 'application/json' }),
        body: JSON.stringify({ tenant, ...turn }),
      });
      return r.json();
    },
    thread: async (tenant, threadId) => {
      const r = await fetch(`${BACKEND}/ask-history?tenant=${encodeURIComponent(tenant)}&thread_id=${encodeURIComponent(threadId)}`, { headers: authH() });
      return r.json();
    },
    recent: async (tenant, limit) => {
      const r = await fetch(`${BACKEND}/ask-history?tenant=${encodeURIComponent(tenant)}&limit=${limit || 200}`, { headers: authH() });
      return r.json();
    },
    threads: async (tenant) => {
      const r = await fetch(`${BACKEND}/ask-history/threads?tenant=${encodeURIComponent(tenant)}`, { headers: authH() });
      return r.json();
    },
    remove: async (tenant, threadId) => {
      const r = await fetch(`${BACKEND}/ask-history/delete`, {
        method: 'POST', headers: authH({ 'content-type': 'application/json' }),
        body: JSON.stringify({ tenant, thread_id: threadId }),
      });
      return r.json();
    },
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

  // --- wizards (knowledge-base store + personal wizards) ---
  // promoteSection(id) → promotes an APPLIED Section to a Personal Wizard (backend
  //                      state only — no files move; the folder already exists).
  // createFromNotes({name, noteIds, shareScope}) → chat-builder flow: applied
  //                      section from an explicit note set + promote. No file moves;
  //                      shareScope 'team'/'public' are stored, forward-looking flags.
  // personal.list()    → { wizards: [{id, name, topic, note_count, share_scope, folder, ...}] }
  // personal.ask(id,q) → wizard-scoped RAG answer {answer, engine, citations} —
  //                      retrieval sees ONLY that wizard's notes; persists the chat.
  // personal.history(id) → { messages: [{id, role, text, sources, created_at}] }
  // personal.notes(id)   → { notes: [{id, title, path}] } (detail "what's inside")
  wizards: {
    catalog:   ()           => ipcRenderer.invoke('wizards:catalog'),
    install:   (id)         => ipcRenderer.invoke('wizards:install', id),
    uninstall: (id)         => ipcRenderer.invoke('wizards:uninstall', id),
    rate:      (id, stars)  => ipcRenderer.invoke('wizards:rate', { id, stars }),
    promoteSection: (sectionId) => ipcRenderer.invoke('wizards:promote-section', sectionId),
    createFromNotes: (opts)     => ipcRenderer.invoke('wizards:create-from-notes', opts || {}),
    personal: {
      list:    ()             => ipcRenderer.invoke('wizards:personal-list'),
      ask:     (id, question) => ipcRenderer.invoke('wizards:personal-ask', { id, question }),
      history: (id)           => ipcRenderer.invoke('wizards:personal-chat-history', id),
      notes:   (id)           => ipcRenderer.invoke('wizards:personal-notes', id),
    },
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

  // --- auth (Google OAuth / Okta SSO desktop loopback → Lore session) ---
  // login()     → opens the browser for Google sign-in; resolves {ok, user_id, email, scopes} or {ok:false, reason}
  // loginOkta() → same, via Okta SSO (server maps groups → team scopes)
  // status() → current signed-in user {user_id, email, scopes} or null
  // logout() → clears the stored session
  auth: {
    login:  () => ipcRenderer.invoke('auth:login'),
    loginOkta: () => ipcRenderer.invoke('auth:login-okta'),
    status: () => ipcRenderer.invoke('auth:status'),
    logout: () => ipcRenderer.invoke('auth:logout'),
  },

  // --- teams + invites (share a base with another user) ---
  // Each call returns {ok, status, body} from the backend (401 body when signed out).
  teams: {
    create:  (name)            => ipcRenderer.invoke('teams:create', name),
    invite:  (teamId, email)   => ipcRenderer.invoke('teams:invite', teamId, email),
  },
  invites: {
    list:    ()                => ipcRenderer.invoke('invites:list'),
    accept:  (inviteId)        => ipcRenderer.invoke('invites:accept', inviteId),
  },

  // --- MCP server ---
  // detect()    → { detected, installed, configPath }
  // install()   → { ok, backupPath, configPath, reason? }
  // uninstall() → { ok, reason? }
  mcp: {
    detect:      () => ipcRenderer.invoke('mcp:detect'),
    detectTools: () => ipcRenderer.invoke('mcp:detect-tools'),
    install:     (tool) => ipcRenderer.invoke('mcp:install', tool),
    uninstall:   (tool) => ipcRenderer.invoke('mcp:uninstall', tool),
  },

  // --- notes (backend proxy) ---
  // get(id) → backend /notes/:id response (or {error} on failure)
  notes: {
    get: (id) => ipcRenderer.invoke('notes:get', id),
  },

  // --- search (backend proxy) ---
  // search(query, scopes, k) → backend POST /search response (or {error})
  search: (query, scopes, k) => ipcRenderer.invoke('search', { query, scopes, k }),

  // --- enrichment LLM providers (codex sub / claude sub / byok) ---
  // providers() → { codex:bool, claude:bool, byok:bool } availability
  // run(opts)   → POST /enrich {tenant, limit, provider} (small batch test or full run)
  enrich: {
    providers: ()     => ipcRenderer.invoke('enrich:providers'),
    run:       (opts) => ipcRenderer.invoke('enrich:run', opts || {}),
  },

  // --- sections (auto-proposed note folders) ---
  // list()     → { sections: [{id, name, topic, status, notes, ...}] }
  // apply(id)  → user-initiated ONLY: moves the notes into the section folder
  //              (main-process fs moves under pathGuard) and re-indexes them.
  // dismiss(id)→ hides the proposal permanently (never re-proposed).
  // undo(id)   → moves an applied section's notes back to their original paths.
  sections: {
    list:    ()   => ipcRenderer.invoke('sections:list'),
    apply:   (id) => ipcRenderer.invoke('sections:apply', id),
    dismiss: (id) => ipcRenderer.invoke('sections:dismiss', id),
    undo:    (id) => ipcRenderer.invoke('sections:undo', id),
  },

  // --- libraries discovered via `.lore` manifests ---
  // discovered() → [{root, name, tenant, indexed, topics, tags, lastWork}] for
  // every folder (configured roots + immediate subfolders) carrying a .lore file.
  libraries: {
    discovered: () => ipcRenderer.invoke('libraries:discovered'),
  },

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
    const r = await fetch(`${BACKEND}/presets`, { headers: authH() });
    return r.json();
  },
  // history: optional prior turns [{role, text}] — the backend uses the last 6
  // so follow-up questions resolve against the running conversation.
  ask: async (question, scopes, tenant, model, history, provider) => {
    const r = await fetch(`${BACKEND}/trace`, {
      method: 'POST',
      headers: authH({ 'content-type': 'application/json' }),
      body: JSON.stringify({ question, principal_scopes: scopes, tenant_id: tenant, model: model || null, history: history || null, provider: provider || null }),
    });
    if (!r.ok) throw new Error('backend ' + r.status);
    return r.json();
  },
  reindex: async (path, owner, scope, tenant) => {
    const r = await fetch(`${BACKEND}/reindex`, {
      method: 'POST',
      headers: authH({ 'content-type': 'application/json' }),
      body: JSON.stringify({ path, owner_id: owner, scope_id: scope, tenant_id: tenant }),
    });
    return r.json();
  },
});
