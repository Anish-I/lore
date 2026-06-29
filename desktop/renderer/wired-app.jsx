/* global React */
// Lore desktop — WIRED root app. Real file tree, note content, presets, Ask.
// + multi-tab editor (notes & buckets), quick-switcher search, Ask source scopes.
const M = window.LoreMock;

function toggleFolder(tree, id) {
  return tree.map((n) => n.id === id ? { ...n, open: !n.open }
    : (n.children ? { ...n, children: toggleFolder(n.children, id) } : n));
}
function findNode(tree, id) {
  for (const n of tree) {
    if (n.id === id) return n;
    if (n.children) { const f = findNode(n.children, id); if (f) return f; }
  }
  return null;
}
function flatten(tree, acc = []) {
  for (const n of tree) { if (n.kind === 'note') acc.push(n); if (n.children) flatten(n.children, acc); }
  return acc;
}
function firstNote(tree) { return flatten(tree)[0] || null; }

function cleanScope(scope) {
  return scope == null ? '' : String(scope).trim();
}

function uniqScopes(values = []) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(values) ? values.flat() : [values];
  for (const raw of list) {
    const s = cleanScope(raw);
    if (!s) continue;
    const key = s.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(s); }
  }
  return out;
}

function collectTreeScopes(tree, out = []) {
  for (const n of tree || []) {
    if (n.scope) out.push(n.scope);
    if (n.children) collectTreeScopes(n.children, out);
  }
  return out;
}

function scopeLabel(scope) {
  const s = cleanScope(scope);
  return s || 'None';
}

function parseNote(raw, p) {
  let scope = null, tags = [], body = raw || '';
  const fm = body.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (fm) {
    const meta = fm[1];
    const sc = meta.match(/^scope:\s*(.+)$/m); if (sc) scope = String(sc[1]).trim().replace(/^['"]|['"]$/g, '') || null;
    const tg = meta.match(/^tags:\s*\[(.*?)\]/m); if (tg) tags = tg[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
    body = body.slice(fm[0].length);
  }
  const base = p.split(/[\\/]/).pop();
  const h1 = body.match(/^#\s+(.+)$/m);
  const title = h1 ? h1[1].trim() : base.replace(/\.md$/i, '');
  const outline = [...body.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1].trim());
  return { id: p, path: base, title, scope, owner: null, updated: 'on disk', tags, backlinks: [], outline: outline.length ? outline : [title], body: window.mdToRuns(body), raw };
}

function evidenceFromTrace(trace) {
  return (trace.final || []).map((f, i) => {
    const parts = String(f.title || '').split(' > ');
    return { index: i + 1, note: parts[0] || f.title, heading: parts.slice(1).join(' › ') || '—', scope: f.scope, lane: trace.classification || 'hybrid', score: typeof f.final === 'number' ? f.final : 0, owner: String(f.note_id || '').slice(0, 6) };
  });
}

function sourceScopes(scopes = [], source) {
  const clean = uniqScopes(scopes);
  if (!source || source === 'all') return clean;
  const selected = clean.find((s) => s.toLowerCase() === String(source).toLowerCase());
  return selected ? [selected] : clean;
}

function sourceLabel(source, scopes = []) {
  if (!source || source === 'all') return scopes.length > 1 ? `all ${scopes.length} scopes` : (scopes[0] || 'scope');
  return scopeLabel(source);
}

function SearchPalette({ notes, onPick, onClose }) {
  const D = window.VaultDesignSystem_ffbf58;
  const [q, setQ] = React.useState('');
  const [idx, setIdx] = React.useState(0);
  const results = (q ? notes.filter((n) => n.name.toLowerCase().includes(q.toLowerCase())) : notes).slice(0, 40);
  React.useEffect(() => { setIdx(0); }, [q]);
  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { if (results[idx]) onPick(results[idx].id); }
    else if (e.key === 'Escape') onClose();
  };
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 50, background: 'var(--backdrop)', backdropFilter: 'blur(var(--backdrop-blur))', display: 'flex', justifyContent: 'center', paddingTop: '12vh' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 560, maxHeight: '64vh', display: 'flex', flexDirection: 'column', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--divider)' }}>
          <D.Icon name="search" size={16} style={{ color: 'var(--text-faint)' }} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key}
            placeholder="Search notes by name…"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-strong)', fontFamily: 'var(--font-sans)', fontSize: 15 }} />
          <D.Kbd>esc</D.Kbd>
        </div>
        <div style={{ overflowY: 'auto', padding: 6 }}>
          {results.length === 0 && <div style={{ padding: 18, color: 'var(--text-faint)', fontSize: 13 }}>No notes match.</div>}
          {results.map((n, i) => (
            <div key={n.id} onMouseEnter={() => setIdx(i)} onClick={() => onPick(n.id)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              background: i === idx ? 'var(--surface-selected)' : 'transparent',
            }}>
              <D.Icon name="file-text" size={15} style={{ color: i === idx ? 'var(--brand-fg)' : 'var(--text-faint)' }} />
              <span style={{ flex: 1, fontSize: 13.5, color: 'var(--text-body)' }}>{n.name}</span>
              {n.scope && <D.ScopeTag scope={n.scope} size="sm" showLabel={false} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Draggable divider between panels. Adjusts the CSS width vars the panels already read
// (--sidebar-width / --context-width), so no per-component plumbing is needed.
function PaneResizer({ side }) {
  const ref = React.useRef(null);
  const applyWidth = (delta) => {
    const el = ref.current;
    const target = side === 'sidebar' ? el?.previousElementSibling : el?.nextElementSibling;
    if (!target) return;
    const vName = side === 'sidebar' ? '--sidebar-width' : '--context-width';
    const min = side === 'sidebar' ? 180 : 220, max = side === 'sidebar' ? 520 : 600;
    const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(vName)) || target.getBoundingClientRect().width;
    const next = Math.max(min, Math.min(max, current + delta));
    document.documentElement.style.setProperty(vName, next + 'px');
  };
  const onDown = (e) => {
    e.preventDefault();
    const el = ref.current;
    const target = side === 'sidebar' ? el.previousElementSibling : el.nextElementSibling;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const anchor = side === 'sidebar' ? rect.left : rect.right;
    const vName = side === 'sidebar' ? '--sidebar-width' : '--context-width';
    const min = side === 'sidebar' ? 180 : 220, max = side === 'sidebar' ? 520 : 600;
    const move = (ev) => {
      let w = side === 'sidebar' ? (ev.clientX - anchor) : (anchor - ev.clientX);
      w = Math.max(min, Math.min(max, w));
      document.documentElement.style.setProperty(vName, w + 'px');
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      document.body.style.cursor = ''; document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
  };
  const onKeyDown = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    applyWidth(side === 'sidebar' ? dir * 16 : -dir * 16);
  };
  return <div ref={ref} onPointerDown={onDown} onKeyDown={onKeyDown} role="separator" tabIndex={0} aria-orientation="vertical" title="Drag or use arrow keys to resize"
    style={{ width: 10, flexShrink: 0, cursor: 'col-resize', zIndex: 5, background: 'transparent', transition: 'background 120ms', outline: '2px solid transparent', outlineOffset: -2 }}
    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--brand-bg)')}
    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    onFocus={(e) => { e.currentTarget.style.background = 'var(--brand-bg)'; e.currentTarget.style.outlineColor = 'var(--brand-fg)'; }}
    onBlur={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.outlineColor = 'transparent'; }} />;
}

// Per-view error boundary — a single view's crash must never blank the whole app.
// Renders children directly (no wrapper DOM) so it doesn't affect the flex layout.
class LoreErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error('[LoreView crash]', err && (err.stack || err), info && info.componentStack); }
  render() {
    if (this.state.err) {
      const e = this.state.err;
      return (
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '40px 32px', background: 'var(--surface-canvas)' }}>
          <div style={{ maxWidth: 680, margin: '0 auto' }}>
            <h2 style={{ fontFamily: 'var(--font-serif)', color: 'var(--text-strong)', margin: '0 0 8px' }}>This view hit an error</h2>
            <p style={{ color: 'var(--text-subtle)', fontSize: 13, margin: '0 0 14px' }}>The rest of Lore is fine — switch tabs to continue.</p>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 14, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--clay-400)' }}>{String((e && (e.stack || e.message)) || e)}</pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function normalizeProgress(payload) {
  const p = payload || {};
  const done = Number(p.done);
  const total = Number(p.total);
  const errors = Number(p.errors);
  return {
    ...p,
    phase: p.phase || 'working',
    done: Number.isFinite(done) ? done : 0,
    total: Number.isFinite(total) ? total : 0,
    current: p.current || '',
    errors: Number.isFinite(errors) ? errors : 0,
  };
}

function shouldShowProgress(p) {
  if (p.phase !== 'done') return true;
  if (p.errors > 0 || p.done > 0 || p.total > 0) return true;
  return Boolean(p.current && p.current.toLowerCase() !== 'upkeep complete');
}

function progressCountText(p) {
  if (p.total > 0) return `${p.done}/${p.total}`;
  if (p.done > 0) return String(p.done);
  return '';
}

function App() {
  const [theme, setTheme] = React.useState('dark');
  const [view, setView] = React.useState('workspace');
  const [askOpen, setAskOpen] = React.useState(false);
  const [askSource, setAskSource] = React.useState('all');
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [treeData, setTreeData] = React.useState(null);
  const [tabs, setTabs] = React.useState([]);            // [{id,title,kind,bucket?}]
  const [activeId, setActiveId] = React.useState(null);
  const [notes, setNotes] = React.useState({});          // path -> parsed note
  const [drafts, setDrafts] = React.useState({});        // path -> raw text
  const [mode, setMode] = React.useState('read');
  const [scope, setScope] = React.useState(null);
  const [messages, setMessages] = React.useState([]);
  const [asking, setAsking] = React.useState(false);
  const [presets, setPresets] = React.useState(null);
  const [appConfig, setAppConfig] = React.useState(null);
  const [personaIdx, setPersonaIdx] = React.useState(0);
  const [backendOk, setBackendOk] = React.useState(true);
  const [showOnboarding, setShowOnboarding] = React.useState(false);
  const [showProgress, setShowProgress] = React.useState(false);
  const [progressState, setProgressState] = React.useState({ phase: 'walk', done: 0, total: 0, current: '', errors: 0 });
  const [graphData, setGraphData] = React.useState(null);
  const [graphLoading, setGraphLoading] = React.useState(false);
  const [graphNonce, setGraphNonce] = React.useState(0);
  const [kbFilter, setKbFilter] = React.useState([]);   // selected knowledge bases (top-level folders); [] = all
  const [showImportModal, setShowImportModal] = React.useState(false);
  const [previewNote, setPreviewNote] = React.useState(null); // {title, body} for DB-only graph nodes with no source_path
  const timer = React.useRef(null);
  const progressUnsubRef = React.useRef(null);
  const progressDoneTimerRef = React.useRef(null);

  React.useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  const updateProgress = React.useCallback((payload) => {
    const next = normalizeProgress(payload);
    if (progressDoneTimerRef.current) {
      clearTimeout(progressDoneTimerRef.current);
      progressDoneTimerRef.current = null;
    }
    setProgressState(next);
    if (!shouldShowProgress(next)) {
      setShowProgress(false);
      return;
    }
    setShowProgress(true);
    if (next.phase === 'done') {
      progressDoneTimerRef.current = setTimeout(() => {
        setShowProgress(false);
        progressDoneTimerRef.current = null;
      }, next.errors > 0 ? 6000 : 1800);
    }
  }, []);

  React.useEffect(() => () => {
    if (progressUnsubRef.current) progressUnsubRef.current();
    if (progressDoneTimerRef.current) clearTimeout(progressDoneTimerRef.current);
  }, []);

  const tree = treeData ? treeData.tree : [];
  const allNotes = React.useMemo(() => flatten(tree), [tree]);
  const noteScopes = React.useMemo(() => uniqScopes(collectTreeScopes(tree)), [tree]);

  // Knowledge bases = the vault's top-level folders. Selecting them filters BOTH the file tree and the graph.
  const bases = React.useMemo(() => tree.filter((n) => n.kind === 'folder').map((n) => n.name), [tree]);
  const baseOf = React.useCallback((p) => {
    if (!treeData || !p) return null;
    const root = treeData.root || '';
    let rel = p;
    if (root && p.toLowerCase().startsWith(root.toLowerCase())) rel = p.slice(root.length);
    rel = rel.replace(/^[\\/]+/, '');
    return rel.split(/[\\/]/)[0] || null;
  }, [treeData]);
  const shownTree = React.useMemo(() => {
    if (!kbFilter.length) return tree;
    const set = new Set(kbFilter);
    return tree.filter((n) => n.kind === 'folder' ? set.has(n.name) : true);
  }, [tree, kbFilter]);
  const toggleBase = React.useCallback((name) => {
    setKbFilter((f) => f.includes(name) ? f.filter((x) => x !== name) : [...f, name]);
  }, []);
  const filteredGraph = React.useMemo(() => {
    if (!graphData || !kbFilter.length) return graphData;
    const set = new Set(kbFilter);
    const nodes = graphData.nodes.filter((n) => set.has(baseOf(n.path)));
    const ids = new Set(nodes.map((n) => n.id));
    const edges = graphData.edges.filter((e) => ids.has(e[0]) && ids.has(e[1]));
    return { nodes, edges };
  }, [graphData, kbFilter, baseOf]);
  // Dominant scope per knowledge base (folder), so the switcher chips can be colored by scope.
  const baseScopes = React.useMemo(() => {
    const m = {}, rank = { enterprise: 3, team: 2, private: 1 };
    if (graphData) for (const n of graphData.nodes) {
      const b = baseOf(n.path); if (!b) continue;
      if (!m[b] || (rank[n.scope] || 1) > (rank[m[b]] || 1)) m[b] = n.scope;
    }
    return m;
  }, [graphData, baseOf]);
  const graphScopes = React.useMemo(() => uniqScopes(graphData ? graphData.nodes.map((n) => n.scope) : []), [graphData]);
  const presetPersonas = (presets && Array.isArray(presets.personas)) ? presets.personas : [];
  const configScopes = appConfig && appConfig.scope ? uniqScopes([appConfig.scope]) : [];
  const currentPersona = presetPersonas[personaIdx] || { label: null, scopes: [] };
  const personaScopes = uniqScopes(currentPersona.scopes || []);
  const activeScopes = personaScopes.length ? personaScopes : configScopes;
  const persona = { ...currentPersona, label: currentPersona.label || null, scopes: activeScopes };
  const scopeOptions = React.useMemo(() => uniqScopes([...configScopes, ...activeScopes, ...noteScopes, ...graphScopes, scope]), [configScopes.join('\u0000'), activeScopes.join('\u0000'), noteScopes.join('\u0000'), graphScopes.join('\u0000'), scope]);
  const askSourceOptions = React.useMemo(() => {
    const scopes = persona.scopes || [];
    return [
      { value: 'all', label: scopes.length > 1 ? `All (${scopes.length})` : 'Configured scope', icon: 'layers' },
      ...scopes.map((s) => ({ value: s, label: scopeLabel(s), icon: 'tag' })),
    ];
  }, [(persona.scopes || []).join('\u0000')]);
  const tenant = (appConfig && appConfig.tenant) || (presets && presets.tenant) || null;
  const identityReady = Boolean(tenant && persona.scopes && persona.scopes.length);
  const suggestions = (presets && Array.isArray(presets.examples)) ? presets.examples : [];

  React.useEffect(() => {
    if (askSource !== 'all' && !(persona.scopes || []).some((s) => s.toLowerCase() === String(askSource).toLowerCase())) {
      setAskSource('all');
    }
  }, [askSource, (persona.scopes || []).join('\u0000')]);

  const loadNote = React.useCallback(async (id) => {
    if (notes[id]) return notes[id];
    const r = await window.lore.readNote(id);
    const parsed = parseNote(r.raw, id);
    setNotes((m) => ({ ...m, [id]: parsed }));
    setDrafts((m) => ({ ...m, [id]: r.raw }));
    setTabs((ts) => ts.map((t) => t.id === id ? { ...t, title: parsed.title } : t));
    return parsed;
  }, [notes]);

  const openNote = React.useCallback(async (id) => {
    setTabs((ts) => ts.some((t) => t.id === id) ? ts : [...ts, { id, title: id.split(/[\\/]/).pop().replace(/\.md$/i, ''), kind: 'note' }]);
    setActiveId(id); setView('workspace'); setMode('read'); setSearchOpen(false);
    const parsed = await loadNote(id);
    setScope(parsed.scope);
  }, [loadNote]);

  const openBucket = (b) => {
    const id = 'bucket:' + b.id;
    setTabs((ts) => ts.some((t) => t.id === id) ? ts : [...ts, { id, title: b.name, kind: 'bucket', bucket: b }]);
    setActiveId(id); setView('workspace');
  };

  const closeTab = (id) => {
    setTabs((ts) => {
      const i = ts.findIndex((t) => t.id === id);
      const next = ts.filter((t) => t.id !== id);
      if (id === activeId) {
        const n = next[Math.max(0, i - 1)] || next[0] || null;
        setActiveId(n ? n.id : null);
        if (n && n.kind === 'note') loadNote(n.id);
      }
      return next;
    });
  };

  const onTab = (id) => {
    setActiveId(id);
    const t = tabs.find((x) => x.id === id);
    if (t && t.kind === 'note') { setMode('read'); loadNote(id); }
  };

  const onNodeClick = (id) => {
    const n = findNode(tree, id);
    if (n && n.kind === 'folder') setTreeData((td) => ({ ...td, tree: toggleFolder(td.tree, id) }));
    else openNote(id);
  };

  const loadTree = React.useCallback(async (root) => {
    const td = await window.lore.readTree(root);
    if (!td) return false;
    setTreeData(td);
    const f = firstNote(td.tree);
    if (f) openNote(f.id);
    return true;
  }, [openNote]);

  React.useEffect(() => {
    (async () => {
      try { const p = await window.lore.presets(); setPresets(p); setBackendOk(true); } catch { setBackendOk(false); }
      // Resolve only explicitly configured roots. No bundled/sample vault is assumed.
      let existingCfg = null;
      try { existingCfg = window.lore?.config?.get ? await window.lore.config.get() : null; } catch { /* none */ }
      setAppConfig(existingCfg || null);
      const rootsToTry = [];
      const configuredRoot = (existingCfg && Array.isArray(existingCfg.roots) && existingCfg.roots[0]) || null;
      if (configuredRoot) rootsToTry.push(configuredRoot);
      let loadedRoot = false;
      for (const root of rootsToTry) {
        try { if (await loadTree(root)) { loadedRoot = true; break; } } catch { /* try next */ }
      }
      if (window.lore.onVaultChanged) window.lore.onVaultChanged(() => { if (treeData) loadTree(treeData.root); });
      if (!existingCfg || !loadedRoot) setShowOnboarding(true);
    })();
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen((o) => !o); }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); setAskOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => { clearInterval(timer.current); window.removeEventListener('keydown', onKey); };
  }, []); // eslint-disable-line

  const openVault = async () => {
    const td = await window.lore.pickVault();
    if (td) {
      try {
        if (window.lore?.config?.set) {
          const nextCfg = await window.lore.config.set({ roots: [td.root] });
          setAppConfig(nextCfg || appConfig);
        }
      } catch { /* non-fatal */ }
      setTreeData(td); setTabs([]); setNotes({}); setDrafts({}); const f = firstNote(td.tree); if (f) openNote(f.id); else setActiveId(null);
    }
  };

  // flags: { scan?: boolean, openWizards?: boolean }
  const handleOnboardingDone = React.useCallback(async (cfg, flags = {}) => {
    setShowOnboarding(false);
    setAppConfig(cfg || null);
    const shouldScrape = flags.scan === true;
    if (progressUnsubRef.current) {
      progressUnsubRef.current();
      progressUnsubRef.current = null;
    }
    if (shouldScrape && window.lore?.scrapeProgress) {
      if (progressUnsubRef.current) progressUnsubRef.current();
      const unsub = window.lore.scrapeProgress((p) => {
        const next = normalizeProgress(p);
        updateProgress(next);
        if (next.phase === 'done') { if (progressUnsubRef.current) { progressUnsubRef.current(); progressUnsubRef.current = null; } }
      });
      progressUnsubRef.current = unsub;
    }
    if (shouldScrape && window.lore?.startScrape) {
      try { await window.lore.startScrape(cfg); } catch { updateProgress({ phase: 'done', done: 0, total: 0, current: 'scan failed', errors: 1 }); }
    }
    if (cfg.roots && cfg.roots[0]) { try { await loadTree(cfg.roots[0]); } catch { /* non-fatal */ } }
    if (flags.openWizards) setView('buckets');
  }, [loadTree, updateProgress]);

  // Load real graph data when graph view is active and identity is configured.
  React.useEffect(() => {
    if (view !== 'graph' || !window.lore?.graph) return;
    setGraphLoading(true);
    const scopes = persona.scopes || [];
    if (!identityReady) {
      setGraphData({ nodes: [], edges: [] });
      setGraphLoading(false);
      return;
    }
    window.lore.graph({ tenant, scopes }).then((g) => {
      setGraphData(g); setGraphLoading(false);
    }).catch(() => setGraphLoading(false));
  }, [view, tenant, identityReady, (persona.scopes || []).join('\u0000'), graphNonce]);

  // After an import: refresh the graph and the file tree so new nodes/files show up.
  const reloadAfterImport = React.useCallback(() => {
    setGraphNonce((n) => n + 1);
    if (treeData) loadTree(treeData.root);
  }, [treeData, loadTree]);
  const onCreateNote = React.useCallback(async () => {
    if (!treeData || !treeData.root) return;
    const ts = Date.now().toString(36).slice(-5);
    const sep = treeData.root.includes('/') ? '/' : '\\';
    const path = treeData.root.replace(/[\\/]+$/, '') + sep + 'Untitled ' + ts + '.md';
    const noteScope = scope || (appConfig && appConfig.scope);
    const content = `${noteScope ? `---\nscope: ${noteScope}\n---\n\n` : ''}# New note\n\n`;
    try { await window.lore.writeNote(path, content); } catch { return; }
    await openNote(path);
    setMode('edit');
  }, [treeData, openNote, scope, appConfig]);

  const onImport = React.useCallback(() => {
    setShowImportModal(true);
  }, []);
  const onDropImport = React.useCallback(async (e) => {
    e.preventDefault();
    const paths = Array.from((e.dataTransfer && e.dataTransfer.files) || []).map((f) => f.path).filter(Boolean);
    if (!paths.length) return;
    try { await window.lore.importFiles(paths); } catch { /* non-fatal */ }
    reloadAfterImport();
  }, [reloadAfterImport]);

  const setDraft = (v) => { if (activeId) setDrafts((m) => ({ ...m, [activeId]: v })); };

  const onMode = async (m) => {
    if (mode === 'edit' && m === 'read' && activeId) {
      await window.lore.writeNote(activeId, drafts[activeId] || '');
      const parsed = parseNote(drafts[activeId] || '', activeId);
      setNotes((mm) => ({ ...mm, [activeId]: parsed }));
      setTabs((ts) => ts.map((t) => t.id === activeId ? { ...t, title: parsed.title } : t));
    }
    setMode(m);
  };

  const ask = async (q, model) => {
    if (asking) return;
    setAskOpen(true); setAsking(true);
    setMessages((m) => [...m, { role: 'user', text: q }, { role: 'answer', shown: [], streaming: true }]);
    const scopes = sourceScopes(persona.scopes, askSource);
    if (!tenant || !scopes.length) {
      setMessages((m) => { const c = m.slice(); c[c.length - 1] = { role: 'answer', shown: [{ x: 'Configure a tenant and scope before asking Lore. Open Settings or setup to finish identity.' }], streaming: false }; return c; });
      setAsking(false); return;
    }
    let trace;
    try { trace = await window.lore.ask(q, scopes, tenant, model); }
    catch (e) {
      setMessages((m) => { const c = m.slice(); c[c.length - 1] = { role: 'answer', shown: [{ x: 'Couldn’t reach the index. Make sure the Lore backend is running on :8099.' }], streaming: false }; return c; });
      setAsking(false); return;
    }
    const words = String(trace.answer || 'No notes in your scope mention this yet.').split(/(\s+)/).filter(Boolean).map((w) => ({ x: w }));
    const evidence = evidenceFromTrace(trace);
    const sources = (trace.final || []).length;
    const scopesAsked = trace.scopes_asked || scopes;
    const scopesLabel = `${sourceLabel(askSource, scopes)} · ${sources} chunks · ${scopesAsked.join(', ')}`;
    let i = 0;
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      i += 2;
      setMessages((m) => {
        const c = m.slice(); const last = c[c.length - 1];
        if (!last || last.role !== 'answer') return m;
        const shown = words.slice(0, i);
        if (i >= words.length) { clearInterval(timer.current); c[c.length - 1] = { ...last, shown, streaming: false, sources, scopes: scopesLabel, evidence, text: String(trace.answer || 'No notes in your scope mention this yet.') }; setAsking(false); }
        else c[c.length - 1] = { ...last, shown };
        return c;
      });
    }, 28);
  };

  const D = window.VaultDesignSystem_ffbf58;
  const Titlebar = window.LoreTitlebar, Rail = window.LoreActivityRail, Sidebar = window.LoreSidebar,
    Editor = window.LoreEditor, ContextPane = window.LoreContextPane, AskPanel = window.LoreAskPanel,
    ProjectsView = window.LoreProjectsView, GraphView = window.LoreGraphView,
    BucketsView = window.LoreBucketsView, SettingsView = window.LoreSettingsView,
    HooksView = window.LoreHooksView, Onboarding = window.LoreOnboarding,
    ImportModal = window.LoreImportModal;

  const activeTab = tabs.find((t) => t.id === activeId);
  const activeNote = activeTab && activeTab.kind === 'note' ? notes[activeId] : null;
  const editorNote = activeNote && { ...activeNote, raw: drafts[activeId], onEdit: setDraft };
  const activeBucket = activeTab && activeTab.kind === 'bucket' ? activeTab.bucket : null;
  const workspace = { name: treeData ? treeData.name : 'No vault', scope: (appConfig && appConfig.scope) || null, indexedLabel: treeData ? `${treeData.indexed} notes` : 'open a vault' };
  const progressCount = progressCountText(progressState);

  // The open note's connections (from the knowledge graph edges) — shown in the ContextPane.
  const connections = React.useMemo(() => {
    if (!graphData || !activeId) return [];
    const byId = {}; for (const n of graphData.nodes) byId[n.id] = n;
    const key = String(activeId).toLowerCase();
    const self = graphData.nodes.find((n) => n.path && n.path.toLowerCase() === key);
    if (!self) return [];
    const out = [], seen = new Set();
    for (const e of graphData.edges) {
      const s = e[0], d = e[1], kind = e[2];
      let other = null, dir = null;
      if (s === self.id) { other = byId[d]; dir = 'out'; }
      else if (d === self.id) { other = byId[s]; dir = 'in'; }
      if (other && other.path && !seen.has(other.id)) { seen.add(other.id); out.push({ id: other.id, label: other.label, path: other.path, kind, dir }); }
    }
    return out;
  }, [graphData, activeId]);

  // When viewing a Wizard, pre-generate suggested questions for it; otherwise use the profile examples.
  const bucketQuestions = (b) => b ? [
    `Summarize ${b.name}`,
    ...((b.topics || []).slice(0, 2).map((t) => `What's important about ${t}?`)),
    `What are the open risks or gaps in ${b.name}?`,
  ].slice(0, 4) : suggestions;
  const askSuggestions = activeBucket ? bucketQuestions(activeBucket) : suggestions;
  const askPanel = <AskPanel messages={messages} asking={asking} suggestions={askSuggestions} onSend={ask} onClose={() => setAskOpen(false)} source={askSource} onSource={setAskSource} sourceOptions={askSourceOptions} identityReady={identityReady} onSetup={() => { setView('settings'); setShowOnboarding(true); }} />;

  const EmptyEditor = () => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, background: 'var(--surface-canvas)', color: 'var(--text-subtle)' }}>
      {treeData ? (
        <React.Fragment>
          <img src="design/assets/sprites/lore-familiar.png" alt="" style={{ width: 116, height: 116, objectFit: 'contain', filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.28))' }} onError={(e) => { e.target.style.display = 'none'; }} />
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, color: 'var(--text-body)' }}>{treeData.name} is open · {treeData.indexed} notes</div>
          <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>Pick a note from the sidebar, or create a new one.</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <D.Button variant="primary" icon="plus" onClick={onCreateNote}>New note</D.Button>
            <D.Button variant="secondary" icon="upload" onClick={() => setShowImportModal(true)}>Import</D.Button>
            <D.Button variant="ghost" icon="sparkles" onClick={() => setAskOpen(true)}>Ask Lore</D.Button>
          </div>
        </React.Fragment>
      ) : (
        <React.Fragment>
          <D.Icon name="folder-open" size={34} style={{ color: 'var(--text-faint)' }} />
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, color: 'var(--text-body)' }}>Open a vault to start.</div>
          <D.Button variant="primary" icon="folder" onClick={openVault}>Open vault folder…</D.Button>
          {Onboarding && (
            <D.Button variant="ghost" icon="settings" onClick={() => setShowOnboarding(true)}>Set up…</D.Button>
          )}
        </React.Fragment>
      )}
    </div>
  );

  const GraphEmptyState = ({ loading }) => {
    const needsIdentity = !loading && !identityReady;
    const hasVault = Boolean(treeData);
    return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, background: 'var(--surface-canvas)', color: 'var(--text-subtle)' }}>
      <img src="design/assets/sprites/node-orb.png" alt="" style={{ width: 56, height: 56, opacity: 0.7 }} onError={(e) => { e.target.style.display = 'none'; }} />
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 17, color: 'var(--text-body)' }}>{loading ? 'Loading graph…' : needsIdentity ? 'Identity is not configured yet.' : 'No graph nodes yet.'}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-faint)', maxWidth: 360, textAlign: 'center', lineHeight: 1.5 }}>{loading ? 'Fetching nodes and edges…' : needsIdentity ? 'Set a tenant and scope so Lore knows which index to query.' : hasVault ? 'Import or index notes to build the knowledge graph.' : 'Open a vault, then import or index notes.'}</div>
      {!loading && (
        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          {needsIdentity && <D.Button variant="primary" icon="settings" onClick={() => setShowOnboarding(true)}>Configure identity</D.Button>}
          {!hasVault && <D.Button variant={needsIdentity ? 'secondary' : 'primary'} icon="folder-open" onClick={openVault}>Open vault</D.Button>}
          {hasVault && !needsIdentity && <D.Button variant="secondary" icon="upload" onClick={() => setShowImportModal(true)}>Import notes</D.Button>}
        </div>
      )}
    </div>
    );
  };

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface-sunken)' }}
      onDragOver={(e) => { e.preventDefault(); }} onDrop={onDropImport}>
      <Titlebar theme={theme} onToggleTheme={() => setTheme((t) => t === 'dark' ? 'light' : 'dark')} onSearch={() => setSearchOpen(true)} onAsk={() => setAskOpen(true)} onSettings={() => setView('settings')} onProfile={() => setView('settings')} onImport={onImport} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
        <Rail view={view} askOpen={askOpen}
          onView={(v) => { if (v === 'search') setSearchOpen(true); else setView(v); }}
          onAsk={() => setAskOpen((o) => !o)} />

        <LoreErrorBoundary key={view}>
        {view === 'workspace' && (
          <React.Fragment>
            <Sidebar tree={shownTree} activeNote={activeId} workspace={workspace} onOpen={onNodeClick} onToggle={(id) => setTreeData((td) => ({ ...td, tree: toggleFolder(td.tree, id) }))}
              bases={bases} baseScopes={baseScopes} kbFilter={kbFilter} onToggleBase={toggleBase} onClearBases={() => setKbFilter([])} wizard={activeBucket} onCreateNote={onCreateNote} />
            <PaneResizer side="sidebar" />
            {activeBucket
              ? <Editor bucket={activeBucket} tabs={tabs} activeId={activeId} onTab={onTab} onCloseTab={closeTab} onOpen={() => setAskOpen(true)} />
              : (editorNote
                ? <Editor note={editorNote} tabs={tabs} activeId={activeId} onTab={onTab} onCloseTab={closeTab} mode={mode} onMode={onMode} onOpen={() => {}} scope={scope} onScope={setScope} scopeOptions={scopeOptions} />
                : <EmptyEditor />)}
            {!askOpen && editorNote && <PaneResizer side="context" />}
            {askOpen ? askPanel : (editorNote && <ContextPane note={editorNote} connections={connections} onOpenNote={openNote} onAsk={() => setAskOpen(true)} />)}
          </React.Fragment>
        )}

        {view === 'projects' && (<React.Fragment><ProjectsView projects={M.projects} groups={M.groups} onOpen={() => setView('workspace')} />{askOpen && askPanel}</React.Fragment>)}
        {view === 'graph' && (
          <React.Fragment>
            {(graphLoading || !filteredGraph || filteredGraph.nodes.length === 0)
              ? <GraphEmptyState loading={graphLoading} />
              : <GraphView graph={filteredGraph} onOpen={(id) => {
                  const n = graphData && graphData.nodes.find((x) => x.id === id);
                  if (n && n.path) {
                    openNote(n.path);
                  } else if (window.lore && window.lore.notes && window.lore.notes.get) {
                    // DB-only node (no source_path) — fetch body and show read-only preview
                    window.lore.notes.get(id).then((nd) => {
                      if (nd) setPreviewNote({ title: nd.title || String(id), body: nd.body || '' });
                    }).catch(() => {});
                  } else {
                    setView('workspace');
                  }
                }} />
            }
            {askOpen && askPanel}
          </React.Fragment>
        )}
        {view === 'buckets' && (<React.Fragment><BucketsView buckets={M.buckets} onAsk={() => setAskOpen(true)} onOpen={openBucket} onChanged={reloadAfterImport} />{askOpen && askPanel}</React.Fragment>)}
        {view === 'settings' && <SettingsView settings={M.settings} config={appConfig} scopeOptions={scopeOptions} onOpenSetup={() => setShowOnboarding(true)} />}
        {view === 'hooks' && HooksView && <HooksView scopeOptions={scopeOptions} identityReady={identityReady} onOpenSetup={() => setShowOnboarding(true)} />}
        </LoreErrorBoundary>

        {searchOpen && <SearchPalette notes={allNotes} onPick={openNote} onClose={() => setSearchOpen(false)} />}

        {showProgress && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30, background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border)', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 11, backdropFilter: 'blur(4px)' }}>
            <span style={{ color: 'var(--brand-fg)', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 10 }}>{progressState.phase}</span>
            {progressCount && <span style={{ color: 'var(--text-muted)' }}>{progressCount}</span>}
            <span style={{ flex: 1, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{progressState.current}</span>
            {progressState.errors > 0 && <span style={{ color: 'var(--clay-400)' }}>{progressState.errors} error{progressState.errors !== 1 ? 's' : ''}</span>}
            {progressState.phase === 'done' && (
              <button onClick={() => setShowProgress(false)} title="Dismiss" aria-label="Dismiss progress" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 4 }}>
                <D.Icon name="x" size={12} />
              </button>
            )}
          </div>
        )}

        {showOnboarding && Onboarding && <Onboarding onDone={handleOnboardingDone} />}

        {showImportModal && ImportModal && (
          <ImportModal
            onClose={() => setShowImportModal(false)}
            onDone={() => { setShowImportModal(false); reloadAfterImport(); }}
          />
        )}

        {previewNote && (
          <div onClick={() => setPreviewNote(null)} style={{ position: 'absolute', inset: 0, zIndex: 80, background: 'var(--backdrop)', backdropFilter: 'blur(var(--backdrop-blur))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 680, maxHeight: '80vh', display: 'flex', flexDirection: 'column', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderBottom: '1px solid var(--divider)' }}>
                <D.Icon name="file-text" size={15} style={{ color: 'var(--brand-fg)' }} />
                <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>{previewNote.title}</span>
                <button onClick={() => setPreviewNote(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', display: 'inline-flex', padding: 4 }}>
                  <D.Icon name="x" size={15} />
                </button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', fontFamily: 'var(--font-sans)', fontSize: 13.5, color: 'var(--text-body)', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {previewNote.body || '(no content)'}
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ height: 'var(--statusbar-height)', display: 'flex', alignItems: 'center', gap: 14, padding: '0 12px', background: 'var(--surface-base)', borderTop: '1px solid var(--border-subtle)', flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>
        <button onClick={openVault} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--border)', background: 'var(--surface-inset)', color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          <D.Icon name="folder-open" size={12} />{treeData ? treeData.name : 'Open vault…'}
        </button>
        <button onClick={() => setSearchOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          <D.Icon name="search" size={12} />search <D.Kbd>⌘K</D.Kbd>
        </button>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <D.Icon name="circle-dot" size={12} style={{ color: backendOk ? 'var(--jade-400)' : 'var(--clay-400)' }} />
          {backendOk ? 'backend ready' : 'backend offline (:8099)'}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <D.Icon name={identityReady ? 'key-round' : 'alert-circle'} size={12} style={{ color: identityReady ? 'var(--brand-fg)' : 'var(--text-faint)' }} />
          {identityReady ? `${tenant} · ${(persona.scopes || []).join(', ')}` : 'identity not configured'}
        </span>
        <div style={{ flex: 1 }} />
        <span>{tabs.length} tab{tabs.length === 1 ? '' : 's'}</span>
      </div>
    </div>
  );
}

window.LoreApp = App;
