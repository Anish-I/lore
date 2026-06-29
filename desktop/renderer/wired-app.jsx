/* global React */
// Lore desktop — WIRED root app. Real file tree, note content, presets, Ask.
// + multi-tab editor (notes & buckets), quick-switcher search, Ask source (me/team/both).
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

function parseNote(raw, p) {
  let scope = 'private', tags = [], body = raw || '';
  const fm = body.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (fm) {
    const meta = fm[1];
    const sc = meta.match(/^scope:\s*([a-zA-Z]+)/m); if (sc) scope = sc[1].toLowerCase();
    const tg = meta.match(/^tags:\s*\[(.*?)\]/m); if (tg) tags = tg[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
    body = body.slice(fm[0].length);
  }
  const base = p.split(/[\\/]/).pop();
  const h1 = body.match(/^#\s+(.+)$/m);
  const title = h1 ? h1[1].trim() : base.replace(/\.md$/i, '');
  const outline = [...body.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1].trim());
  return { id: p, path: base, title, scope, owner: 'you', updated: 'on disk', tags, backlinks: [], outline: outline.length ? outline : [title], body: window.mdToRuns(body), raw };
}

function evidenceFromTrace(trace) {
  return (trace.final || []).map((f, i) => {
    const parts = String(f.title || '').split(' > ');
    return { index: i + 1, note: parts[0] || f.title, heading: parts.slice(1).join(' › ') || '—', scope: f.scope, lane: trace.classification || 'hybrid', score: typeof f.final === 'number' ? f.final : 0, owner: String(f.note_id || '').slice(0, 6) };
  });
}

// scopes for "ask from me / team / both"
function sourceScopes(scopes, source) {
  const mine = scopes.filter((s) => /private/i.test(s));
  const shared = scopes.filter((s) => !/private/i.test(s));
  if (source === 'me') return mine.length ? mine : scopes;
  if (source === 'team') return shared.length ? shared : scopes;
  return scopes;
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
  return <div ref={ref} onPointerDown={onDown} title="Drag to resize"
    style={{ width: 6, flexShrink: 0, cursor: 'col-resize', zIndex: 5, background: 'transparent', transition: 'background 120ms' }}
    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--brand-bg)')}
    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')} />;
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

function App() {
  const [theme, setTheme] = React.useState('dark');
  const [view, setView] = React.useState('workspace');
  const [askOpen, setAskOpen] = React.useState(false);
  const [askSource, setAskSource] = React.useState('both');
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [treeData, setTreeData] = React.useState(null);
  const [tabs, setTabs] = React.useState([]);            // [{id,title,kind,bucket?}]
  const [activeId, setActiveId] = React.useState(null);
  const [notes, setNotes] = React.useState({});          // path -> parsed note
  const [drafts, setDrafts] = React.useState({});        // path -> raw text
  const [mode, setMode] = React.useState('read');
  const [scope, setScope] = React.useState('team');
  const [messages, setMessages] = React.useState([]);
  const [asking, setAsking] = React.useState(false);
  const [presets, setPresets] = React.useState(null);
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

  React.useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  const tree = treeData ? treeData.tree : [];
  const allNotes = React.useMemo(() => flatten(tree), [tree]);

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
  const persona = (presets && presets.personas && presets.personas[personaIdx]) || { label: 'You', scopes: ['alice-private', 'eng-team', 'acme-corp'] };
  const tenant = (presets && presets.tenant) || 'acme';
  const suggestions = (presets && presets.examples) || ['What do we know about the Acme renewal risk?'];

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
    if (td) { setTreeData(td); const f = firstNote(td.tree); if (f) openNote(f.id); }
  }, [openNote]);

  React.useEffect(() => {
    (async () => {
      try { const p = await window.lore.presets(); setPresets(p); setBackendOk(true); } catch { setBackendOk(false); }
      // Resolve the vault root: prefer the CONFIGURED vault (e.g. your Obsidian folder) so the
      // workspace tree, node-clicks and saves all operate on your real .md files. Falls back to
      // the bundled default. loadTree() registers the root with the main-process path-guard.
      let existingCfg = null;
      try { existingCfg = window.lore?.config?.get ? await window.lore.config.get() : null; } catch { /* none */ }
      let autoRoot = (existingCfg && Array.isArray(existingCfg.roots) && existingCfg.roots[0]) || null;
      if (!autoRoot) { try { autoRoot = await window.lore.defaultVault(); } catch { /* none */ } }
      if (autoRoot) { try { await loadTree(autoRoot); } catch { /* none */ } }
      if (window.lore.onVaultChanged) window.lore.onVaultChanged(() => { if (treeData) loadTree(treeData.root); });
      // first-run: show the Welcome modal instead of silently auto-configuring.
      // The Welcome's Skip button performs the same zero-config path in one click.
      if (!existingCfg) setShowOnboarding(true);
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
    if (td) { setTreeData(td); setTabs([]); setNotes({}); setDrafts({}); const f = firstNote(td.tree); if (f) openNote(f.id); else setActiveId(null); }
  };

  // flags: { scan?: boolean, openWizards?: boolean }
  // Skip passes no flags → scan defaults to true (zero-config scrape). Finish passes explicit values.
  const handleOnboardingDone = React.useCallback(async (cfg, flags = {}) => {
    setShowOnboarding(false);
    const shouldScrape = flags.scan !== false;
    if (shouldScrape && window.lore?.startScrape) {
      try { await window.lore.startScrape(cfg); } catch { /* non-fatal */ }
    }
    if (window.lore?.scrapeProgress) {
      if (progressUnsubRef.current) progressUnsubRef.current();
      const unsub = window.lore.scrapeProgress((p) => {
        setProgressState(p); setShowProgress(true);
        if (p.phase === 'done') { if (progressUnsubRef.current) { progressUnsubRef.current(); progressUnsubRef.current = null; } }
      });
      progressUnsubRef.current = unsub;
    }
    if (cfg.roots && cfg.roots[0]) { try { await loadTree(cfg.roots[0]); } catch { /* non-fatal */ } }
    if (flags.openWizards) setView('buckets');
  }, [loadTree]);

  // Load real graph data when graph view is active or persona changes
  React.useEffect(() => {
    if (view !== 'graph' || !window.lore?.graph) return;
    setGraphLoading(true);
    const scopes = (presets && presets.personas && presets.personas[personaIdx])
      ? presets.personas[personaIdx].scopes
      : ['alice-private', 'eng-team', 'acme-corp'];
    window.lore.graph(scopes).then((g) => {
      setGraphData(g); setGraphLoading(false);
    }).catch(() => setGraphLoading(false));
  }, [view, personaIdx, presets, graphNonce]);

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
    const content = '---\nscope: private\n---\n\n# New note\n\n';
    try { await window.lore.writeNote(path, content); } catch { return; }
    await openNote(path);
    setMode('edit');
  }, [treeData, openNote]);

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
    let trace;
    try { trace = await window.lore.ask(q, scopes, tenant, model); }
    catch (e) {
      setMessages((m) => { const c = m.slice(); c[c.length - 1] = { role: 'answer', shown: [{ x: 'Couldn’t reach the index. Make sure the Lore backend is running on :8099.' }], streaming: false }; return c; });
      setAsking(false); return;
    }
    const words = String(trace.answer || 'No notes in your scope mention this yet.').split(/(\s+)/).filter(Boolean).map((w) => ({ x: w }));
    const evidence = evidenceFromTrace(trace);
    const sources = (trace.final || []).length;
    const scopesLabel = `${askSource} · ${sources} chunks · ${(trace.scopes_asked || scopes).join(', ')}`;
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
  const workspace = { name: treeData ? treeData.name : 'No vault', scope: (presets && presets.tenant === 'solo') ? 'private' : 'team', indexedLabel: treeData ? `${treeData.indexed} notes` : 'open a vault' };

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
  const askPanel = <AskPanel messages={messages} asking={asking} suggestions={askSuggestions} onSend={ask} onClose={() => setAskOpen(false)} source={askSource} onSource={setAskSource} />;

  const EmptyEditor = () => {
    const [draftQ, setDraftQ] = React.useState('');
    const submitAsk = () => {
      const q = draftQ.trim();
      if (!q) return;
      setDraftQ('');
      ask(q);
    };
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, background: 'var(--surface-canvas)', color: 'var(--text-subtle)' }}>
        {treeData ? (
          <React.Fragment>
            <img src="design/assets/sprites/lore-familiar.png" alt="" style={{ width: 96, height: 96, objectFit: 'contain', filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.28))' }} onError={(e) => { e.target.style.display = 'none'; }} />
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 20, color: 'var(--text-body)' }}>{treeData.name} · {treeData.indexed} notes</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', maxWidth: 480, padding: '0 24px', boxSizing: 'border-box' }}>
              <input
                autoFocus
                value={draftQ}
                onChange={(e) => setDraftQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitAsk(); }}
                placeholder="Ask your vault anything…"
                style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: '1.5px solid var(--border-subtle)', background: 'var(--surface-raised)', color: 'var(--text-strong)', fontFamily: 'var(--font-sans)', fontSize: 14, outline: 'none' }}
              />
              <D.Button variant="primary" icon="sparkles" onClick={submitAsk}>Ask</D.Button>
            </div>
            <div style={{ display: 'flex', gap: 20, marginTop: 2 }}>
              <button onClick={onCreateNote} style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 13, textDecoration: 'underline', padding: 0 }}>New note</button>
              <button onClick={() => setShowImportModal(true)} style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 13, textDecoration: 'underline', padding: 0 }}>Import</button>
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
  };

  const GraphEmptyState = ({ loading }) => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, background: 'var(--surface-canvas)', color: 'var(--text-subtle)' }}>
      <img src="design/assets/sprites/node-orb.png" alt="" style={{ width: 56, height: 56, opacity: 0.7 }} onError={(e) => { e.target.style.display = 'none'; }} />
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 17, color: 'var(--text-body)' }}>{loading ? 'Loading graph…' : 'No notes in your scope yet.'}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-faint)' }}>{loading ? 'Fetching nodes and edges…' : 'Index some notes to see the knowledge graph.'}</div>
    </div>
  );

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface-sunken)' }}
      onDragOver={(e) => { e.preventDefault(); }} onDrop={onDropImport}>
      <Titlebar theme={theme} onToggleTheme={() => setTheme((t) => t === 'dark' ? 'light' : 'dark')} onAsk={() => setAskOpen(true)} onSettings={() => setView('settings')} onProfile={() => setView('settings')} onImport={onImport} />
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
                ? <Editor note={editorNote} tabs={tabs} activeId={activeId} onTab={onTab} onCloseTab={closeTab} mode={mode} onMode={onMode} onOpen={() => {}} scope={scope} onScope={setScope} />
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
        {view === 'settings' && <SettingsView settings={M.settings} />}
        {view === 'hooks' && HooksView && <HooksView />}
        </LoreErrorBoundary>

        {searchOpen && <SearchPalette notes={allNotes} onPick={openNote} onClose={() => setSearchOpen(false)} />}

        {showProgress && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30, background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border)', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 11, backdropFilter: 'blur(4px)' }}>
            <span style={{ color: 'var(--brand-fg)', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 10 }}>{progressState.phase}</span>
            <span style={{ color: 'var(--text-muted)' }}>{progressState.done}/{progressState.total || '?'}</span>
            <span style={{ flex: 1, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{progressState.current}</span>
            {progressState.errors > 0 && <span style={{ color: 'var(--clay-400)' }}>{progressState.errors} error{progressState.errors !== 1 ? 's' : ''}</span>}
            {progressState.phase === 'done' && <span style={{ color: 'var(--jade-400)' }}>Done</span>}
            {progressState.phase === 'done' && (
              <button onClick={() => setShowProgress(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontSize: 11, padding: '0 4px' }}>dismiss</button>
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
          {backendOk ? `${tenant} · backend ready` : 'backend offline (:8099)'}
        </span>
        <div style={{ flex: 1 }} />
        <span>{tabs.length} tab{tabs.length === 1 ? '' : 's'}</span>
      </div>
    </div>
  );
}

window.LoreApp = App;
