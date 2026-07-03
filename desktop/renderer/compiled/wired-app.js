/* global React */
// Lore desktop — WIRED root app. Real file tree, note content, presets, Ask.
// + multi-tab editor (notes & buckets), quick-switcher search, Ask source scopes.
const M = window.LoreMock;

function toggleFolder(tree, id) {
  return tree.map((n) => n.id === id ? { ...n, open: !n.open } :
  n.children ? { ...n, children: toggleFolder(n.children, id) } : n);
}
function findNode(tree, id) {
  for (const n of tree) {
    if (n.id === id) return n;
    if (n.children) {const f = findNode(n.children, id);if (f) return f;}
  }
  return null;
}
function flatten(tree, acc = []) {
  for (const n of tree) {if (n.kind === 'note') acc.push(n);if (n.children) flatten(n.children, acc);}
  return acc;
}
function firstNote(tree) {return flatten(tree)[0] || null;}

// Top-bar scope filter (All / Private / Team / Wizards) — shared predicate used for BOTH the
// file tree (below) and the graph (see filteredGraph). `wizardHit` is precomputed by the caller
// (a wizard-id Set built from the unfiltered tree) since graph nodes don't carry a wizard flag.
function passesScopeFilter(filter, scopeValue, wizardHit) {
  if (!filter || filter === 'all') return true;
  // Solo libraries use a purpose-based scope (e.g. "engineering"), not a literal
  // "private" tag — so "Private" means YOUR own notes: anything that isn't an
  // installed store wizard and isn't explicitly shared to a team/enterprise.
  if (filter === 'private') return !wizardHit && scopeValue !== 'team' && scopeValue !== 'enterprise';
  if (filter === 'team') return scopeValue === 'team' || scopeValue === 'enterprise';
  if (filter === 'plugins') return Boolean(wizardHit); // id predates the Wizards label
  return true;
}

// Collects the ids of wizard-installed notes (main.js buildTree sets `wizard: true` from
// frontmatter) so both the tree filter and the graph filter can detect "Wizards" notes.
// Ids are lowercased since graph node paths and tree note ids may differ in case.
function collectWizardIds(tree, out = new Set()) {
  for (const n of tree || []) {
    if (n.kind === 'note' && n.wizard) out.add(String(n.id).toLowerCase());
    if (n.children) collectWizardIds(n.children, out);
  }
  return out;
}

// Recursively filters the tree by the scope-filter predicate — a folder survives if any
// descendant note survives. Composes with the (separate, top-level-only) kbFilter/Sections
// filter, which is applied on top of this result.
function filterTreeByScope(tree, pred) {
  const out = [];
  for (const n of tree || []) {
    if (n.kind === 'folder') {
      const children = n.children ? filterTreeByScope(n.children, pred) : [];
      if (children.length) out.push({ ...n, children });
    } else if (pred(n)) {
      out.push(n);
    }
  }
  return out;
}

// Forces open every folder that is an ancestor of (or equal to) targetId, so a
// freshly created/renamed item is guaranteed visible after a tree reload.
function forceOpenAncestors(tree, targetId) {
  return tree.map((n) => {
    if (n.kind !== 'folder') return n;
    const sep = n.id.includes('/') ? '/' : '\\';
    const isAncestor = targetId === n.id || targetId.startsWith(n.id.replace(/[\\/]+$/, '') + sep);
    const children = n.children ? forceOpenAncestors(n.children, targetId) : n.children;
    return isAncestor ? { ...n, open: true, children } : { ...n, children };
  });
}

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
    if (!seen.has(key)) {seen.add(key);out.push(s);}
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
  let scope = null,tags = [],body = raw || '';
  const fm = body.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (fm) {
    const meta = fm[1];
    const sc = meta.match(/^scope:\s*(.+)$/m);if (sc) scope = String(sc[1]).trim().replace(/^['"]|['"]$/g, '') || null;
    // Two YAML tag forms in the wild: inline array `tags: [a, b]` and the more
    // common Obsidian-style block list `tags:\n  - a\n  - b`.
    const tgInline = meta.match(/^tags:\s*\[(.*?)\]/m);
    if (tgInline) {
      tags = tgInline[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
    } else {
      const tgBlock = meta.match(/^tags:\s*\r?\n((?:^\s*-\s*.+\r?\n?)+)/m);
      if (tgBlock) tags = [...tgBlock[1].matchAll(/^\s*-\s*(.+)$/gm)].map((m) => m[1].trim().replace(/['"]/g, '')).filter(Boolean);
    }
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
  if (!source || source === 'all') return scopes.length > 1 ? `all ${scopes.length} scopes` : scopes[0] || 'scope';
  return scopeLabel(source);
}

function SearchPalette({ notes, onPick, onClose }) {
  const D = window.VaultDesignSystem_ffbf58;
  const [q, setQ] = React.useState('');
  const [idx, setIdx] = React.useState(0);
  const results = (q ? notes.filter((n) => n.name.toLowerCase().includes(q.toLowerCase())) : notes).slice(0, 40);
  React.useEffect(() => {setIdx(0);}, [q]);
  const key = (e) => {
    if (e.key === 'ArrowDown') {e.preventDefault();setIdx((i) => Math.min(i + 1, results.length - 1));} else
    if (e.key === 'ArrowUp') {e.preventDefault();setIdx((i) => Math.max(i - 1, 0));} else
    if (e.key === 'Enter') {if (results[idx]) onPick(results[idx].id);} else
    if (e.key === 'Escape') onClose();
  };
  return (/*#__PURE__*/
    React.createElement("div", { onClick: onClose, style: { position: 'absolute', inset: 0, zIndex: 50, background: 'var(--backdrop)', backdropFilter: 'blur(var(--backdrop-blur))', display: 'flex', justifyContent: 'center', paddingTop: '12vh' } }, /*#__PURE__*/
    React.createElement("div", { onClick: (e) => e.stopPropagation(), style: { width: 560, maxHeight: '64vh', display: 'flex', flexDirection: 'column', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)', overflow: 'hidden' } }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--divider)' } }, /*#__PURE__*/
    React.createElement(D.Icon, { name: "search", size: 16, style: { color: 'var(--text-faint)' } }), /*#__PURE__*/
    React.createElement("input", { autoFocus: true, value: q, onChange: (e) => setQ(e.target.value), onKeyDown: key,
      placeholder: "Search notes by name\u2026",
      style: { flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-strong)', fontFamily: 'var(--font-sans)', fontSize: 15 } }), /*#__PURE__*/
    React.createElement(D.Kbd, null, "esc")
    ), /*#__PURE__*/
    React.createElement("div", { style: { overflowY: 'auto', padding: 6 } },
    results.length === 0 && /*#__PURE__*/React.createElement("div", { style: { padding: 18, color: 'var(--text-faint)', fontSize: 13 } }, "No notes match."),
    results.map((n, i) => /*#__PURE__*/
    React.createElement("div", { key: n.id, onMouseEnter: () => setIdx(i), onClick: () => onPick(n.id), style: {
        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
        background: i === idx ? 'var(--surface-selected)' : 'transparent'
      } }, /*#__PURE__*/
    React.createElement(D.Icon, { name: "file-text", size: 15, style: { color: i === idx ? 'var(--brand-fg)' : 'var(--text-faint)' } }), /*#__PURE__*/
    React.createElement("span", { style: { flex: 1, fontSize: 13.5, color: 'var(--text-body)' } }, n.name),
    n.scope && /*#__PURE__*/React.createElement(D.ScopeTag, { scope: n.scope, size: "sm", showLabel: false })
    )
    )
    )
    )
    ));

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
    const min = side === 'sidebar' ? 180 : 220,max = side === 'sidebar' ? 520 : 600;
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
    const min = side === 'sidebar' ? 180 : 220,max = side === 'sidebar' ? 520 : 600;
    const move = (ev) => {
      let w = side === 'sidebar' ? ev.clientX - anchor : anchor - ev.clientX;
      w = Math.max(min, Math.min(max, w));
      document.documentElement.style.setProperty(vName, w + 'px');
    };
    const up = () => {
      window.removeEventListener('pointermove', move);window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', move);window.addEventListener('pointerup', up);
    document.body.style.cursor = 'col-resize';document.body.style.userSelect = 'none';
  };
  const onKeyDown = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    applyWidth(side === 'sidebar' ? dir * 16 : -dir * 16);
  };
  return /*#__PURE__*/React.createElement("div", { ref: ref, onPointerDown: onDown, onKeyDown: onKeyDown, role: "separator", tabIndex: 0, "aria-orientation": "vertical", title: "Drag or use arrow keys to resize",
    style: { width: 10, flexShrink: 0, cursor: 'col-resize', zIndex: 5, background: 'transparent', transition: 'background 120ms', outline: '2px solid transparent', outlineOffset: -2 },
    onMouseEnter: (e) => e.currentTarget.style.background = 'var(--brand-bg)',
    onMouseLeave: (e) => e.currentTarget.style.background = 'transparent',
    onFocus: (e) => {e.currentTarget.style.background = 'var(--brand-bg)';e.currentTarget.style.outlineColor = 'var(--brand-fg)';},
    onBlur: (e) => {e.currentTarget.style.background = 'transparent';e.currentTarget.style.outlineColor = 'transparent';} });
}

// Per-view error boundary — a single view's crash must never blank the whole app.
// Renders children directly (no wrapper DOM) so it doesn't affect the flex layout.
class LoreErrorBoundary extends React.Component {
  constructor(p) {super(p);this.state = { err: null };}
  static getDerivedStateFromError(err) {return { err };}
  componentDidCatch(err, info) {console.error('[LoreView crash]', err && (err.stack || err), info && info.componentStack);}
  render() {
    if (this.state.err) {
      const e = this.state.err;
      return (/*#__PURE__*/
        React.createElement("div", { style: { flex: 1, minWidth: 0, overflow: 'auto', padding: '40px 32px', background: 'var(--surface-canvas)' } }, /*#__PURE__*/
        React.createElement("div", { style: { maxWidth: 680, margin: '0 auto' } }, /*#__PURE__*/
        React.createElement("h2", { style: { fontFamily: 'var(--font-serif)', color: 'var(--text-strong)', margin: '0 0 8px' } }, "This view hit an error"), /*#__PURE__*/
        React.createElement("p", { style: { color: 'var(--text-subtle)', fontSize: 13, margin: '0 0 14px' } }, "The rest of Lore is fine \u2014 switch tabs to continue."), /*#__PURE__*/
        React.createElement("pre", { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 14, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--clay-400)' } }, String(e && (e.stack || e.message) || e))
        )
        ));

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
    errors: Number.isFinite(errors) ? errors : 0
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
  // Context pane (backlinks/outline) visibility — hidden via its header button,
  // reopened via the tab-strip panel icon.
  const [contextOpen, setContextOpen] = React.useState(true);
  const [askSource, setAskSource] = React.useState('all');
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [treeData, setTreeData] = React.useState(null);
  const [tabs, setTabs] = React.useState([]); // [{id,title,kind,bucket?}]
  const [activeId, setActiveId] = React.useState(null);
  // Backlink breadcrumb: the note id the user just came FROM, when the current
  // note was opened by clicking a connection in the mini-graph/backlinks list.
  // null whenever the user opened the current note any other way.
  const [cameFromId, setCameFromId] = React.useState(null);
  const [notes, setNotes] = React.useState({}); // path -> parsed note
  const [drafts, setDrafts] = React.useState({}); // path -> raw text
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
  const [kbFilter, setKbFilter] = React.useState([]); // selected knowledge bases (top-level folders); [] = all
  const [scopeFilter, setScopeFilter] = React.useState('all'); // top-bar segmented filter: all | private | team | plugins (labelled Wizards)
  const [showImportModal, setShowImportModal] = React.useState(false);
  const [renamingId, setRenamingId] = React.useState(null); // sidebar node currently showing an inline rename input
  const [previewNote, setPreviewNote] = React.useState(null); // {title, body} for DB-only graph nodes with no source_path
  const [pendingInvites, setPendingInvites] = React.useState([]); // team invites addressed to the signed-in email
  const [inviteBusy, setInviteBusy] = React.useState(null); // invite_id currently being accepted
  const [sectionProposals, setSectionProposals] = React.useState([]); // background upkeep's proposed/applied Sections
  const timer = React.useRef(null);
  const progressUnsubRef = React.useRef(null);
  const progressDoneTimerRef = React.useRef(null);

  React.useEffect(() => {document.documentElement.setAttribute('data-theme', theme);}, [theme]);

  // Pending team invites for the signed-in user — checked on launch and every few
  // minutes; silently empty when signed out or the backend is unreachable. Also
  // exposed as refreshInvites so the Teams view can force an immediate re-check
  // right after sign-in (e.g. the "Join a team" flow).
  const refreshInvites = React.useCallback(async () => {
    if (!window.lore?.invites?.list) return;
    try {
      const r = await window.lore.invites.list();
      if (r && r.ok && r.body && Array.isArray(r.body.invites)) setPendingInvites(r.body.invites);
    } catch {/* signed out or offline — leave prior state */}
  }, []);

  React.useEffect(() => {
    let alive = true;
    const check = async () => {
      if (!window.lore?.invites?.list) return;
      try {
        const r = await window.lore.invites.list();
        if (alive && r && r.ok && r.body && Array.isArray(r.body.invites)) setPendingInvites(r.body.invites);
      } catch {/* signed out or offline — no inbox */}
    };
    check();
    const iv = setInterval(check, 5 * 60 * 1000);
    return () => {alive = false;clearInterval(iv);};
  }, []);

  const acceptInvite = React.useCallback(async (inviteId) => {
    setInviteBusy(inviteId);
    try {
      const r = await window.lore.invites.accept(inviteId);
      if (r && r.ok) setPendingInvites((list) => list.filter((i) => i.invite_id !== inviteId));
    } catch {/* keep the banner so the user can retry */}
    setInviteBusy(null);
  }, []);

  // Section PROPOSALS — background upkeep (main.js) tags notes and proposes folders,
  // but NEVER moves a file itself. This is read-only polling; the only paths that ever
  // move files are the Enable/Undo button handlers below, which the user must click.
  const loadSections = React.useCallback(async () => {
    if (!window.lore?.sections?.list) return;
    try {
      const r = await window.lore.sections.list();
      if (r && Array.isArray(r.sections)) setSectionProposals(r.sections);
    } catch {/* backend offline — keep the last known list */}
  }, []);

  React.useEffect(() => {
    loadSections();
    const iv = setInterval(loadSections, 5 * 60 * 1000);
    // scrape:progress fires with phase:'done' after every scrape/upkeep/import run
    // (see main.js) — a good, cheap trigger to refresh the proposal list.
    const unsub = window.lore?.scrapeProgress ?
    window.lore.scrapeProgress((p) => {if (p && p.phase === 'done') loadSections();}) :
    null;
    return () => {clearInterval(iv);if (unsub) unsub();};
  }, [loadSections]);

  // Enable: moves the section's notes into a new folder (main-process fs, path-guarded)
  // and re-indexes them — fires ONLY from the sidebar's "Enable" button onClick.
  const onSectionApply = React.useCallback(async (id) => {
    if (!window.lore?.sections?.apply) return;
    try {await window.lore.sections.apply(id);} finally {loadSections();}
  }, [loadSections]);

  const onSectionDismiss = React.useCallback(async (id) => {
    if (!window.lore?.sections?.dismiss) return;
    try {await window.lore.sections.dismiss(id);} finally {loadSections();}
  }, [loadSections]);

  // Undo: moves an applied section's notes back to their recorded original paths —
  // fires ONLY from the sidebar's "Undo" button onClick.
  const onSectionUndo = React.useCallback(async (id) => {
    if (!window.lore?.sections?.undo) return;
    try {await window.lore.sections.undo(id);} finally {loadSections();}
  }, [loadSections]);

  // Promote: turns an APPLIED section into a Personal Wizard (backend state only —
  // the section is already a real folder, so no files move). Fires ONLY from the
  // sidebar's "Promote" button; the Wizards view picks the new wizard up on its
  // own next load.
  const onSectionPromote = React.useCallback(async (id) => {
    if (!window.lore?.wizards?.promoteSection) return { ok: false };
    return window.lore.wizards.promoteSection(id);
  }, []);

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

  // Knowledge bases = the library's top-level folders. Selecting them filters BOTH the file tree and the graph.
  const bases = React.useMemo(() => tree.filter((n) => n.kind === 'folder').map((n) => n.name), [tree]);
  const baseOf = React.useCallback((p) => {
    if (!treeData || !p) return null;
    const root = treeData.root || '';
    let rel = p;
    if (root && p.toLowerCase().startsWith(root.toLowerCase())) rel = p.slice(root.length);
    rel = rel.replace(/^[\\/]+/, '');
    return rel.split(/[\\/]/)[0] || null;
  }, [treeData]);
  // Built from the UNFILTERED tree — main.js buildTree/scopeOf() sets `wizard: true` on notes
  // whose frontmatter has a `wizard:` key. Graph nodes carry no wizard flag of their own, so
  // this Set (keyed by lowercased path) is reused to detect "Wizards" notes on both surfaces.
  const wizardIds = React.useMemo(() => collectWizardIds(tree), [tree]);
  // Scope filter (All/Private/Team/Wizards) — recursive, prunes empty folders. Applied BEFORE
  // the Sections (kbFilter) filter below so the two compose rather than one replacing the other.
  const scopeFilteredTree = React.useMemo(
    () => filterTreeByScope(tree, (n) => passesScopeFilter(scopeFilter, n.scope, wizardIds.has(String(n.id).toLowerCase()))),
    [tree, scopeFilter, wizardIds]
  );
  const shownTree = React.useMemo(() => {
    if (!kbFilter.length) return scopeFilteredTree;
    const set = new Set(kbFilter);
    return scopeFilteredTree.filter((n) => n.kind === 'folder' ? set.has(n.name) : true);
  }, [scopeFilteredTree, kbFilter]);
  const toggleBase = React.useCallback((name) => {
    setKbFilter((f) => f.includes(name) ? f.filter((x) => x !== name) : [...f, name]);
  }, []);
  const filteredGraph = React.useMemo(() => {
    if (!graphData) return graphData;
    const kbSet = kbFilter.length ? new Set(kbFilter) : null;
    const nodes = graphData.nodes.filter((n) => {
      if (kbSet && !kbSet.has(baseOf(n.path))) return false;
      return passesScopeFilter(scopeFilter, n.scope, wizardIds.has(String(n.path || '').toLowerCase()));
    });
    const ids = new Set(nodes.map((n) => n.id));
    const edges = graphData.edges.filter((e) => ids.has(e[0]) && ids.has(e[1]));
    return { nodes, edges };
  }, [graphData, kbFilter, scopeFilter, wizardIds, baseOf]);
  // Dominant scope per knowledge base (folder), so the switcher chips can be colored by scope.
  const baseScopes = React.useMemo(() => {
    const m = {},rank = { enterprise: 3, team: 2, private: 1 };
    if (graphData) for (const n of graphData.nodes) {
      const b = baseOf(n.path);if (!b) continue;
      if (!m[b] || (rank[n.scope] || 1) > (rank[m[b]] || 1)) m[b] = n.scope;
    }
    return m;
  }, [graphData, baseOf]);
  const graphScopes = React.useMemo(() => uniqScopes(graphData ? graphData.nodes.map((n) => n.scope) : []), [graphData]);
  const presetPersonas = presets && Array.isArray(presets.personas) ? presets.personas : [];
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
    ...scopes.map((s) => ({ value: s, label: scopeLabel(s), icon: 'tag' }))];

  }, [(persona.scopes || []).join('\u0000')]);
  const tenant = appConfig && appConfig.tenant || presets && presets.tenant || null;
  const identityReady = Boolean(tenant && persona.scopes && persona.scopes.length);
  const suggestions = presets && Array.isArray(presets.examples) ? presets.examples : [];

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

  // `cameFrom` (optional 2nd arg) is the id of the note the user was just on, ONLY
  // when navigating via a backlink/connection click — every other caller (sidebar,
  // search, tabs) calls openNote with one arg, which resets the trail marker.
  const openNote = React.useCallback(async (id, cameFrom = null) => {
    setCameFromId(cameFrom);
    setTabs((ts) => ts.some((t) => t.id === id) ? ts : [...ts, { id, title: id.split(/[\\/]/).pop().replace(/\.md$/i, ''), kind: 'note' }]);
    setActiveId(id);setView('workspace');setMode('read');setSearchOpen(false);
    const parsed = await loadNote(id);
    setScope(parsed.scope);
  }, [loadNote]);

  // Wraps openNote so a backlink/connection click marks where the user came from —
  // the mini-graph on the note they land on highlights that node in a distinct
  // color. Opening a note any other way (sidebar, search, tabs) resets the trail.
  const openNoteFromBacklink = React.useCallback((path) => {
    openNote(path, activeId);
  }, [openNote, activeId]);

  // Stable graph-node open handler (defined AFTER openNote to avoid a TDZ ref).
  // An inline arrow at the call site re-created GraphView's onOpen every render,
  // which (via graph.jsx's [graph, onOpen] effect) restarted the force simulation
  // on every parent re-render ("glitching out").
  const onGraphOpen = React.useCallback((id) => {
    const n = graphData && graphData.nodes.find((x) => x.id === id);
    if (n && n.path) {
      openNote(n.path);
    } else if (window.lore && window.lore.notes && window.lore.notes.get) {
      window.lore.notes.get(id).then((nd) => {
        if (nd) setPreviewNote({ title: nd.title || String(id), body: nd.body || '' });
      }).catch(() => {});
    } else {
      setView('workspace');
    }
  }, [graphData, openNote]);

  const openBucket = (b) => {
    const id = 'bucket:' + b.id;
    setTabs((ts) => ts.some((t) => t.id === id) ? ts : [...ts, { id, title: b.name, kind: 'bucket', bucket: b }]);
    setActiveId(id);setView('workspace');
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
    if (t && t.kind === 'note') {setMode('read');loadNote(id);}
  };

  // "Close others" (tab-strip hover action): keep only the given tab, activating it
  // when the active tab was among the closed — one pass, so it can't race closeTab.
  const closeOtherTabs = (id) => {
    const t = tabs.find((x) => x.id === id);
    if (!t) return;
    setTabs((ts) => ts.filter((x) => x.id === id));
    if (id !== activeId) {
      setActiveId(id);
      if (t.kind === 'note') {setMode('read');loadNote(id);}
    }
  };

  const onNodeClick = (id) => {
    const n = findNode(tree, id);
    if (n && n.kind === 'folder') setTreeData((td) => ({ ...td, tree: toggleFolder(td.tree, id) }));else
    openNote(id);
  };

  const loadTree = React.useCallback(async (root) => {
    const td = await window.lore.readTree(root);
    if (!td) return false;
    setTreeData(td);
    const f = firstNote(td.tree);
    if (f) openNote(f.id);
    return true;
  }, [openNote]);
  // Change the OPEN note's confidentiality. Persists on disk + reindexes via the
  // main process; on a redaction block (broadening a note that has secrets),
  // confirm and retry with force. Refreshes the note + graph so the new scope
  // shows immediately (node recolors, view filters update).
  const onSetNoteScope = React.useCallback(async (visId, force = false) => {
    if (!activeId || !window.lore?.setNoteScope) return;
    const r = await window.lore.setNoteScope(activeId, visId, force);
    if (r && r.reason === 'secret' && !force) {
      const ok = window.confirm(`${r.detail}\n\nShare it anyway?`);
      if (ok) return onSetNoteScope(visId, true);
      return;
    }
    if (r && r.ok) {
      const parsed = await loadNote(activeId);
      setScope(parsed.scope);
      setGraphNonce((n) => n + 1);
      if (treeData) loadTree(treeData.root);
    }
  }, [activeId, loadNote, treeData, loadTree]);


  // Mid-session refresh: re-reads the tree WITHOUT touching the active tab.
  // loadTree's openNote(firstNote) is for initial load only.
  const reloadTree = React.useCallback(async (root) => {
    const td = await window.lore.readTree(root);
    if (td) setTreeData(td);
  }, []);

  // Library up/down switcher (sidebar header chevrons) — cycles appConfig.roots, wrapping
  // around, and opens the target library via loadTree (its initial-load variant is correct
  // here: switching libraries should land on that library's first note).
  const switchLibrary = React.useCallback((dir) => {
    const roots = appConfig && Array.isArray(appConfig.roots) ? appConfig.roots : [];
    if (roots.length <= 1) return;
    const curIdx = treeData ? roots.indexOf(treeData.root) : -1;
    const from = curIdx === -1 ? 0 : curIdx;
    const next = roots[(from + dir + roots.length) % roots.length];
    if (next) loadTree(next);
  }, [appConfig, treeData, loadTree]);

  // Libraries discovered via `.lore` manifests (main scans configured roots +
  // subfolders) — the sidebar surfaces the ones that are NOT already open/configured
  // so a known library can be reopened with one click. Manifest reads only; cheap.
  const [discoveredLibs, setDiscoveredLibs] = React.useState([]);
  React.useEffect(() => {
    if (!window.lore?.libraries?.discovered) return;
    window.lore.libraries.discovered().
    then((d) => setDiscoveredLibs(Array.isArray(d) ? d : [])).
    catch(() => {/* non-fatal */});
  }, [appConfig]);
  const otherLibraries = React.useMemo(() => {
    const norm = (p) => String(p || '').replace(/[\\/]+$/, '');
    const known = new Set((appConfig && Array.isArray(appConfig.roots) ? appConfig.roots : []).map(norm));
    if (treeData && treeData.root) known.add(norm(treeData.root));
    return discoveredLibs.filter((d) => d && d.root && !known.has(norm(d.root)));
  }, [discoveredLibs, appConfig, treeData]);
  // Same switch mechanism as the roots chevrons: loadTree opens the library and
  // lands on its first note. Config is untouched — reopening is not adopting.
  const openDiscoveredLibrary = React.useCallback((root) => {
    if (root) loadTree(root);
  }, [loadTree]);

  // Right-click on a sidebar row: hand off to the native Electron context menu (main process).
  const onTreeContextMenu = React.useCallback((node) => {
    if (!window.lore?.treeContextMenu || !treeData) return;
    window.lore.treeContextMenu(node.id, node.kind, treeData.root);
  }, [treeData]);

  // Closes every note matching pred (tab + loaded state) in one pass, used when notes
  // are trashed out from under the editor. Single setTabs + functional setActiveId so
  // multi-note closes (folder trash) can't race a stale activeId.
  const closeNotesWhere = React.useCallback((pred) => {
    setTabs((ts) => {
      const first = ts.findIndex((t) => t.kind === 'note' && pred(t.id));
      if (first === -1) return ts;
      const next = ts.filter((t) => !(t.kind === 'note' && pred(t.id)));
      setActiveId((a) => {
        if (!a || !pred(a)) return a;
        const n = next[Math.max(0, first - 1)] || next[0] || null;
        if (n && n.kind === 'note') loadNote(n.id);
        return n ? n.id : null;
      });
      return next;
    });
    setNotes((m) => {const c = { ...m };let ch = false;for (const k of Object.keys(c)) if (pred(k)) {delete c[k];ch = true;}return ch ? c : m;});
    setDrafts((m) => {const c = { ...m };let ch = false;for (const k of Object.keys(c)) if (pred(k)) {delete c[k];ch = true;}return ch ? c : m;});
  }, [loadNote]);

  const onRenameCancel = React.useCallback(() => setRenamingId(null), []);

  // Commits an inline rename (Enter or blur). Remaps any open tabs / loaded note state
  // from the old path to the new one so a rename of the active note never leaves a
  // stale/broken reference — folders remap every descendant note under the old prefix too.
  const onRenameCommit = React.useCallback(async (node, newName) => {
    const trimmed = (newName || '').trim();
    setRenamingId(null);
    if (!trimmed || trimmed === node.name) return;
    if (!window.lore?.treeRename) return;
    let res;
    try {res = await window.lore.treeRename(node.id, trimmed, node.kind);} catch {res = null;}
    if (!res || res.ok === false) {if (treeData) reloadTree(treeData.root);return;}
    const oldId = node.id,newPath = res.newPath;
    if (newPath !== oldId) {
      const remap = (id) => {
        if (node.kind === 'note') return id === oldId ? newPath : id;
        if (id === oldId) return newPath;
        const sep = id.includes('/') ? '/' : '\\';
        const oldPrefix = oldId.replace(/[\\/]+$/, '') + sep;
        return id.startsWith(oldPrefix) ? newPath + sep + id.slice(oldPrefix.length) : id;
      };
      setTabs((ts) => ts.map((t) => t.kind === 'note' ? { ...t, id: remap(t.id) } : t));
      setNotes((m) => {const c = {};for (const k of Object.keys(m)) c[remap(k)] = { ...m[k], id: remap(k) };return c;});
      setDrafts((m) => {const c = {};for (const k of Object.keys(m)) c[remap(k)] = m[k];return c;});
      setActiveId((a) => a ? remap(a) : a);
    }
    if (treeData) await reloadTree(treeData.root);
  }, [treeData, reloadTree]);

  // Handles events pushed from main after a context-menu action: opening a note,
  // starting an inline rename (both for existing items and freshly-created ones),
  // and cleaning up after a trash.
  React.useEffect(() => {
    if (!window.lore?.onTreeAction) return;
    const unsub = window.lore.onTreeAction(async (payload) => {
      const { action, id, kind } = payload || {};
      if (action === 'open') {openNote(id);return;}
      if (action === 'rename-start') {
        if (treeData) await reloadTree(treeData.root);
        setTreeData((td) => td ? { ...td, tree: forceOpenAncestors(td.tree, id) } : td);
        setRenamingId(id);
        return;
      }
      if (action === 'trashed') {
        if (kind === 'folder') {
          const sep = id.includes('/') ? '/' : '\\';
          const prefix = id.replace(/[\\/]+$/, '') + sep;
          closeNotesWhere((tid) => tid === id || tid.startsWith(prefix));
        } else {
          closeNotesWhere((tid) => tid === id);
        }
        if (treeData) await reloadTree(treeData.root);
        setRenamingId((r) => r === id ? null : r);
        return;
      }
      // 'trash-failed' — fail soft, nothing to reconcile client-side.
    });
    return unsub;
  }, [treeData, openNote, reloadTree, closeNotesWhere]);

  React.useEffect(() => {
    (async () => {
      try {const p = await window.lore.presets();setPresets(p);setBackendOk(true);} catch {setBackendOk(false);}
      // Resolve only explicitly configured roots. No bundled/sample library is assumed.
      let existingCfg = null;
      try {existingCfg = window.lore?.config?.get ? await window.lore.config.get() : null;} catch {/* none */}
      setAppConfig(existingCfg || null);
      const rootsToTry = [];
      const configuredRoot = existingCfg && Array.isArray(existingCfg.roots) && existingCfg.roots[0] || null;
      if (configuredRoot) rootsToTry.push(configuredRoot);
      let loadedRoot = false;
      for (const root of rootsToTry) {
        try {if (await loadTree(root)) {loadedRoot = true;break;}} catch {/* try next */}
      }
      if (window.lore.onVaultChanged) window.lore.onVaultChanged(() => {if (treeData) loadTree(treeData.root);});
      // Once a user has set up locally (or explicitly skipped), NEVER auto-prompt
      // onboarding again — not on a version bump, and not just because the library
      // root failed to load this boot (a transient state, not a reason to re-onboard).
      const configuredBefore = existingCfg && (existingCfg.onboardedAt || existingCfg.skippedSetupAt ||
      Array.isArray(existingCfg.roots) && existingCfg.roots.length > 0);
      if (!configuredBefore) setShowOnboarding(true);
    })();
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {e.preventDefault();setSearchOpen((o) => !o);} else
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {e.preventDefault();setAskOpen(true);}
    };
    window.addEventListener('keydown', onKey);
    return () => {clearInterval(timer.current);window.removeEventListener('keydown', onKey);};
  }, []); // eslint-disable-line

  const applyVaultTree = React.useCallback(async (td) => {
    if (!td || !td.root) return;
    try {
      if (window.lore?.config?.set) {
        const patch = { roots: [td.root] };
        if (td.tenant) patch.tenant = td.tenant;
        const nextCfg = await window.lore.config.set(patch);
        setAppConfig(nextCfg || appConfig);
      }
    } catch {/* non-fatal */}
    setTreeData(td);
    setKbFilter([]);
    setTabs([]);
    setNotes({});
    setDrafts({});
    const f = firstNote(td.tree);
    if (f) openNote(f.id);else
    setActiveId(null);
  }, [appConfig, openNote]);

  const openVault = async () => {
    const td = await window.lore.pickVault();
    if (td) await applyVaultTree(td);
  };

  const createLoreVault = async () => {
    if (!window.lore?.createVault) {
      updateProgress({ phase: 'done', done: 0, total: 0, current: 'Library creation is not available.', errors: 1 });
      return;
    }
    try {
      const td = await window.lore.createVault({ autoPlace: true });
      if (!td) return;
      if (td.ok === false) {
        updateProgress({ phase: 'done', done: 0, total: 0, current: td.error || 'Could not create the library.', errors: 1 });
        return;
      }
      await applyVaultTree(td);
    } catch (e) {
      updateProgress({ phase: 'done', done: 0, total: 0, current: String(e && e.message || e), errors: 1 });
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
        if (next.phase === 'done') {if (progressUnsubRef.current) {progressUnsubRef.current();progressUnsubRef.current = null;}}
      });
      progressUnsubRef.current = unsub;
    }
    if (shouldScrape && window.lore?.startScrape) {
      try {await window.lore.startScrape(cfg);} catch {updateProgress({ phase: 'done', done: 0, total: 0, current: 'scan failed', errors: 1 });}
    }
    if (cfg.roots && cfg.roots[0]) {try {await loadTree(cfg.roots[0]);} catch {/* non-fatal */}}
    if (flags.openWizards) setView('buckets');
    if (flags.openImport) setShowImportModal(true);
  }, [loadTree, updateProgress]);

  // LIVE graph: poll cheap /stats counts and refetch the graph whenever they
  // change — new notes/edges captured from agent sessions (Claude/Codex hooks,
  // auto-index) pop into the canvas within seconds, no manual refresh.
  const statsRef = React.useRef('');
  React.useEffect(() => {
    if (!identityReady || !window.lore?.stats) return;
    const timer = setInterval(async () => {
      try {
        const st = await window.lore.stats(tenant);
        const sig = st ? `${st.notes}|${st.edges}|${st.chunks}` : '';
        if (sig && statsRef.current && sig !== statsRef.current) {
          setGraphNonce((n) => n + 1);
          if (treeData) loadTree(treeData.root); // keep the file tree in step too
        }
        if (sig) statsRef.current = sig;
      } catch {/* backend briefly down — next tick retries */}
    }, 8000);
    return () => clearInterval(timer);
  }, [identityReady, tenant, treeData, loadTree]);

  // Load real graph data once identity is configured — NOT gated on the Graph tab
  // being open. The note editor's ContextPane (backlinks/connections) also reads
  // graphData, so fetching it only on view==='graph' meant every note falsely
  // showed "No connections yet" until the user had visited the Graph view once.
  React.useEffect(() => {
    if (!window.lore?.graph) return;
    setGraphLoading(true);
    const scopes = persona.scopes || [];
    if (!identityReady) {
      setGraphData({ nodes: [], edges: [] });
      setGraphLoading(false);
      return;
    }
    window.lore.graph({ tenant, scopes }).then((g) => {
      setGraphData(g);setGraphLoading(false);
    }).catch((e) => {
      // Surface it — a silently-empty graph next to a populated file tree was
      // undiagnosable from the UI (audit: silent-failure culture). Root cause
      // of the boot-time flavor: the renderer asks before the backend finishes
      // starting (tree is fs = instant, graph is backend = seconds), and one
      // failure used to stick forever. Retry until the backend is up.
      console.error('[graph] fetch failed (retrying in 3s):', e && e.message);
      setGraphLoading(false);
      setTimeout(() => setGraphNonce((n) => n + 1), 3000);
    });
  }, [tenant, identityReady, (persona.scopes || []).join('\u0000'), graphNonce]);

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
    const noteScope = scope || appConfig && appConfig.scope;
    const content = `${noteScope ? `---\nscope: ${noteScope}\n---\n\n` : ''}# New note\n\n`;
    try {await window.lore.writeNote(path, content);} catch {return;}
    await openNote(path);
    setMode('edit');
  }, [treeData, openNote, scope, appConfig]);

  const onImport = React.useCallback(() => {
    setShowImportModal(true);
  }, []);
  const onDropImport = React.useCallback(async (e) => {
    e.preventDefault();
    const paths = Array.from(e.dataTransfer && e.dataTransfer.files || []).map((f) => f.path).filter(Boolean);
    if (!paths.length) return;
    try {await window.lore.importFiles(paths);} catch {/* non-fatal */}
    reloadAfterImport();
  }, [reloadAfterImport]);

  const setDraft = (v) => {if (activeId) setDrafts((m) => ({ ...m, [activeId]: v }));};

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
    setAskOpen(true);setAsking(true);
    setMessages((m) => [...m, { role: 'user', text: q }, { role: 'answer', shown: [], streaming: true }]);
    const scopes = sourceScopes(persona.scopes, askSource);
    if (!tenant || !scopes.length) {
      setMessages((m) => {const c = m.slice();c[c.length - 1] = { role: 'answer', shown: [{ x: 'Finish setup with an account, library, and purpose before asking Lore.' }], streaming: false };return c;});
      setAsking(false);return;
    }
    let trace;
    try {trace = await window.lore.ask(q, scopes, tenant, model);}
    catch (e) {
      setMessages((m) => {const c = m.slice();c[c.length - 1] = { role: 'answer', shown: [{ x: 'Couldn’t reach the index. Make sure the Lore backend is running on :8099.' }], streaming: false };return c;});
      setAsking(false);return;
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
        const c = m.slice();const last = c[c.length - 1];
        if (!last || last.role !== 'answer') return m;
        const shown = words.slice(0, i);
        if (i >= words.length) {clearInterval(timer.current);c[c.length - 1] = { ...last, shown, streaming: false, sources, scopes: scopesLabel, evidence, text: String(trace.answer || 'No notes in your scope mention this yet.') };setAsking(false);} else
        c[c.length - 1] = { ...last, shown };
        return c;
      });
    }, 28);
  };

  const D = window.VaultDesignSystem_ffbf58;
  const Titlebar = window.LoreTitlebar,Rail = window.LoreActivityRail,Sidebar = window.LoreSidebar,
    Editor = window.LoreEditor,ContextPane = window.LoreContextPane,FloatingGraph = window.LoreFloatingGraph,AskPanel = window.LoreAskPanel,
    TeamsView = window.LoreTeamsView,GraphView = window.LoreGraphView,
    BucketsView = window.LoreBucketsView,SettingsView = window.LoreSettingsView,
    HooksView = window.LoreHooksView,Onboarding = window.LoreOnboarding,
    ImportModal = window.LoreImportModal;

  const activeTab = tabs.find((t) => t.id === activeId);
  const activeNote = activeTab && activeTab.kind === 'note' ? notes[activeId] : null;
  const editorNote = activeNote && { ...activeNote, raw: drafts[activeId], onEdit: setDraft };
  const activeBucket = activeTab && activeTab.kind === 'bucket' ? activeTab.bucket : null;
  const workspace = { name: treeData ? treeData.name : 'No library', scope: appConfig && appConfig.scope || null, indexedLabel: treeData ? `${treeData.indexed} notes` : 'open a library' };
  const progressCount = progressCountText(progressState);

  // The open note's connections (from the knowledge graph edges) — shown in the ContextPane.
  const connections = React.useMemo(() => {
    if (!graphData || !activeId) return [];
    const byId = {};for (const n of graphData.nodes) byId[n.id] = n;
    const key = String(activeId).toLowerCase();
    const self = graphData.nodes.find((n) => n.path && n.path.toLowerCase() === key);
    if (!self) return [];
    const out = [],seen = new Set();
    for (const e of graphData.edges) {
      const s = e[0],d = e[1],kind = e[2];
      let other = null,dir = null;
      if (s === self.id) {other = byId[d];dir = 'out';} else
      if (d === self.id) {other = byId[s];dir = 'in';}
      if (other && other.path && !seen.has(other.id)) {seen.add(other.id);out.push({ id: other.id, label: other.label, path: other.path, kind, dir });}
    }
    return out;
  }, [graphData, activeId]);

  // When viewing a Wizard, pre-generate suggested questions for it; otherwise use the profile examples.
  const bucketQuestions = (b) => b ? [
  `Summarize ${b.name}`,
  ...(b.topics || []).slice(0, 2).map((t) => `What's important about ${t}?`),
  `What are the open risks or gaps in ${b.name}?`].
  slice(0, 4) : suggestions;
  const askSuggestions = activeBucket ? bucketQuestions(activeBucket) : suggestions;
  const askPanel = /*#__PURE__*/React.createElement(AskPanel, { messages: messages, asking: asking, suggestions: askSuggestions, onSend: ask, onClose: () => setAskOpen(false), source: askSource, onSource: setAskSource, sourceOptions: askSourceOptions, identityReady: identityReady, onSetup: () => {setView('settings');setShowOnboarding(true);} });

  const EmptyEditor = () => {
    const [draftQ, setDraftQ] = React.useState('');
    const submitAsk = () => {
      const q = draftQ.trim();
      if (!q) return;
      setDraftQ('');
      ask(q);
    };
    return (/*#__PURE__*/
      React.createElement("div", { style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, background: 'var(--surface-canvas)', color: 'var(--text-subtle)' } },
      treeData ? /*#__PURE__*/
      React.createElement(React.Fragment, null, /*#__PURE__*/
      React.createElement("img", { src: "design/assets/sprites/lore-familiar.png", alt: "", style: { width: 96, height: 96, objectFit: 'contain', filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.28))' }, onError: (e) => {e.target.style.display = 'none';} }), /*#__PURE__*/
      React.createElement("div", { style: { fontFamily: 'var(--font-serif)', fontSize: 20, color: 'var(--text-body)' } }, treeData.name, " \xB7 ", treeData.indexed, " notes"), /*#__PURE__*/
      React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8, width: '100%', maxWidth: 480, padding: '0 24px', boxSizing: 'border-box' } }, /*#__PURE__*/
      React.createElement("input", {
        autoFocus: true,
        value: draftQ,
        onChange: (e) => setDraftQ(e.target.value),
        onKeyDown: (e) => {if (e.key === 'Enter') submitAsk();},
        placeholder: "Ask your library anything\u2026",
        style: { flex: 1, padding: '10px 14px', borderRadius: 8, border: '1.5px solid var(--border-subtle)', background: 'var(--surface-raised)', color: 'var(--text-strong)', fontFamily: 'var(--font-sans)', fontSize: 14, outline: 'none' } }
      ), /*#__PURE__*/
      React.createElement(D.Button, { variant: "primary", icon: "sparkles", onClick: submitAsk }, "Ask")
      ), /*#__PURE__*/
      React.createElement("div", { style: { display: 'flex', gap: 20, marginTop: 2 } }, /*#__PURE__*/
      React.createElement("button", { onClick: onCreateNote, style: { background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 13, textDecoration: 'underline', padding: 0 } }, "New note"), /*#__PURE__*/
      React.createElement("button", { onClick: () => setShowImportModal(true), style: { background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 13, textDecoration: 'underline', padding: 0 } }, "Import")
      )
      ) : /*#__PURE__*/

      React.createElement(React.Fragment, null, /*#__PURE__*/
      React.createElement(D.Icon, { name: "folder-open", size: 34, style: { color: 'var(--text-faint)' } }), /*#__PURE__*/
      React.createElement("div", { style: { fontFamily: 'var(--font-serif)', fontSize: 18, color: 'var(--text-body)' } }, "Open a library to start."), /*#__PURE__*/
      React.createElement("div", { style: { display: 'flex', gap: 8, marginTop: 2, flexWrap: 'wrap', justifyContent: 'center' } }, /*#__PURE__*/
      React.createElement(D.Button, { variant: "primary", icon: "sparkles", onClick: createLoreVault }, "Let Lore choose path"), /*#__PURE__*/
      React.createElement(D.Button, { variant: "secondary", icon: "folder", onClick: openVault }, "Open library folder..."),
      Onboarding && /*#__PURE__*/
      React.createElement(D.Button, { variant: "ghost", icon: "settings", onClick: () => setShowOnboarding(true) }, "Set up\u2026")

      )
      )

      ));

  };

  const GraphEmptyState = ({ loading }) => {
    const needsIdentity = !loading && !identityReady;
    const hasVault = Boolean(treeData);
    return (/*#__PURE__*/
      React.createElement("div", { style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, background: 'var(--surface-canvas)', color: 'var(--text-subtle)' } }, /*#__PURE__*/
      React.createElement("img", { src: "design/assets/sprites/node-orb.png", alt: "", style: { width: 56, height: 56, opacity: 0.7 }, onError: (e) => {e.target.style.display = 'none';} }), /*#__PURE__*/
      React.createElement("div", { style: { fontFamily: 'var(--font-serif)', fontSize: 17, color: 'var(--text-body)' } }, loading ? 'Loading graph…' : needsIdentity ? 'Setup is not complete yet.' : 'No graph nodes yet.'), /*#__PURE__*/
      React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-faint)', maxWidth: 360, textAlign: 'center', lineHeight: 1.5 } }, loading ? 'Fetching nodes and edges…' : needsIdentity ? 'Choose an account and purpose so Lore knows which local index to query.' : hasVault ? 'Import or index notes to build the knowledge graph.' : 'Open a library, then import or index notes.'),
      !loading && /*#__PURE__*/
      React.createElement("div", { style: { display: 'flex', gap: 8, marginTop: 2 } },
      needsIdentity && /*#__PURE__*/React.createElement(D.Button, { variant: "primary", icon: "settings", onClick: () => setShowOnboarding(true) }, "Finish setup"),
      !hasVault && /*#__PURE__*/React.createElement(D.Button, { variant: needsIdentity ? 'secondary' : 'primary', icon: "folder-open", onClick: openVault }, "Open library"),
      hasVault && !needsIdentity && /*#__PURE__*/React.createElement(D.Button, { variant: "secondary", icon: "upload", onClick: () => setShowImportModal(true) }, "Import notes")
      )

      ));

  };

  return (/*#__PURE__*/
    React.createElement("div", { style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface-sunken)' },
      onDragOver: (e) => {e.preventDefault();}, onDrop: onDropImport }, /*#__PURE__*/
    React.createElement(Titlebar, { theme: theme, onToggleTheme: () => setTheme((t) => t === 'dark' ? 'light' : 'dark'), onSearch: () => setSearchOpen(true), onAsk: () => setAskOpen(true), onSettings: () => setView('settings'), onProfile: () => setView('settings'), onImport: onImport, scopeFilter: scopeFilter, onScopeFilter: setScopeFilter }), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1, display: 'flex', minHeight: 0, position: 'relative' } }, /*#__PURE__*/
    React.createElement(Rail, { view: view, askOpen: askOpen,
      onView: (v) => {if (v === 'search') setSearchOpen(true);else setView(v);},
      onAsk: () => setAskOpen((o) => !o) }), /*#__PURE__*/

    React.createElement(LoreErrorBoundary, { key: view },
    view === 'workspace' && /*#__PURE__*/
    React.createElement(React.Fragment, null, /*#__PURE__*/
    React.createElement(Sidebar, { tree: shownTree, activeNote: activeId, workspace: workspace, onOpen: onNodeClick, onToggle: (id) => setTreeData((td) => ({ ...td, tree: toggleFolder(td.tree, id) })),
      bases: bases, baseScopes: baseScopes, kbFilter: kbFilter, onToggleBase: toggleBase, onClearBases: () => setKbFilter([]), wizard: activeBucket, onCreateNote: onCreateNote,
      renamingId: renamingId, onTreeContextMenu: onTreeContextMenu, onRenameCommit: onRenameCommit, onRenameCancel: onRenameCancel,
      roots: appConfig && appConfig.roots || [], activeRoot: treeData ? treeData.root : null, onSwitchRoot: switchLibrary,
      discoveredLibraries: otherLibraries, onOpenDiscovered: openDiscoveredLibrary,
      sectionProposals: sectionProposals, onSectionApply: onSectionApply, onSectionDismiss: onSectionDismiss, onSectionUndo: onSectionUndo, onSectionPromote: onSectionPromote, theme: theme }), /*#__PURE__*/
    React.createElement(PaneResizer, { side: "sidebar" }),
    activeBucket ? /*#__PURE__*/
    React.createElement(Editor, { bucket: activeBucket, tabs: tabs, activeId: activeId, onTab: onTab, onCloseTab: closeTab, onCloseOthers: closeOtherTabs, onTogglePane: () => setContextOpen((o) => !o), onOpen: () => setAskOpen(true) }) :
    editorNote ? /*#__PURE__*/
    React.createElement("div", { style: { position: 'relative', flex: 1, minWidth: 0, display: 'flex' } }, /*#__PURE__*/
    React.createElement(Editor, { note: editorNote, tabs: tabs, activeId: activeId, onTab: onTab, onCloseTab: closeTab, onCloseOthers: closeOtherTabs, onTogglePane: () => setContextOpen((o) => !o), mode: mode, onMode: onMode, onOpen: () => {}, scope: scope, onScope: setScope, scopeOptions: scopeOptions, onSetScope: onSetNoteScope }),
    FloatingGraph && /*#__PURE__*/React.createElement(FloatingGraph, { note: editorNote, connections: connections, onOpenNote: openNoteFromBacklink, cameFromId: cameFromId })
    ) : /*#__PURE__*/
    React.createElement(EmptyEditor, null),
    !askOpen && editorNote && contextOpen && /*#__PURE__*/React.createElement(PaneResizer, { side: "context" }),
    askOpen ? askPanel : editorNote && contextOpen && /*#__PURE__*/React.createElement(ContextPane, { note: editorNote, connections: connections, onOpenNote: openNoteFromBacklink, cameFromId: cameFromId, onAsk: () => setAskOpen(true), onHide: () => setContextOpen(false) })
    ),


    view === 'projects' && /*#__PURE__*/
    React.createElement(React.Fragment, null, /*#__PURE__*/
    React.createElement(TeamsView, { config: appConfig, onConfig: setAppConfig, buckets: M.buckets, onOpenWizard: (b) => openBucket(b),
      pendingInvites: pendingInvites, inviteBusy: inviteBusy, onAcceptInvite: acceptInvite, onRefreshInvites: refreshInvites }),
    askOpen && askPanel
    ),

    view === 'graph' && /*#__PURE__*/
    React.createElement(React.Fragment, null,
    graphLoading || !filteredGraph || filteredGraph.nodes.length === 0 ? /*#__PURE__*/
    React.createElement(GraphEmptyState, { loading: graphLoading }) : /*#__PURE__*/
    React.createElement(GraphView, { graph: filteredGraph, onOpen: onGraphOpen, bases: bases, kbFilter: kbFilter, onToggleBase: toggleBase, baseOf: baseOf }),

    askOpen && askPanel
    ),

    view === 'buckets' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(BucketsView, { buckets: M.buckets, onAsk: () => setAskOpen(true), onOpen: openBucket, onChanged: reloadAfterImport, scopes: persona.scopes }), askOpen && askPanel),
    view === 'settings' && /*#__PURE__*/React.createElement(SettingsView, { settings: M.settings, config: appConfig, scopeOptions: scopeOptions, onOpenSetup: () => setShowOnboarding(true) }),
    view === 'hooks' && HooksView && /*#__PURE__*/React.createElement(HooksView, { scopeOptions: scopeOptions, identityReady: identityReady, tenant: tenant, scope: persona.scopes && persona.scopes[0], onOpenSetup: () => setShowOnboarding(true) })
    ),

    searchOpen && /*#__PURE__*/React.createElement(SearchPalette, { notes: allNotes, onPick: openNote, onClose: () => setSearchOpen(false) }),

    showProgress && /*#__PURE__*/
    React.createElement("div", { style: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30, background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border)', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 11, backdropFilter: 'blur(4px)' } }, /*#__PURE__*/
    React.createElement("span", { style: { color: 'var(--brand-fg)', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 10 } }, progressState.phase),
    progressCount && /*#__PURE__*/React.createElement("span", { style: { color: 'var(--text-muted)' } }, progressCount), /*#__PURE__*/
    React.createElement("span", { style: { flex: 1, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, progressState.current),
    progressState.errors > 0 && /*#__PURE__*/React.createElement("span", { style: { color: 'var(--clay-400)' } }, progressState.errors, " error", progressState.errors !== 1 ? 's' : ''),
    progressState.phase === 'done' && /*#__PURE__*/
    React.createElement("button", { onClick: () => setShowProgress(false), title: "Dismiss", "aria-label": "Dismiss progress", style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 4 } }, /*#__PURE__*/
    React.createElement(D.Icon, { name: "x", size: 12 })
    )

    ),


    pendingInvites.length > 0 && !showOnboarding && view !== 'projects' && /*#__PURE__*/
    React.createElement("div", { style: { position: 'absolute', top: showProgress ? 34 : 0, left: 0, right: 0, zIndex: 29, background: 'var(--brand-soft-bg)', borderBottom: '1px solid var(--brand-soft-border)', padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: 'var(--text-body)' } }, /*#__PURE__*/
    React.createElement(D.Icon, { name: "mail", size: 14, style: { color: 'var(--brand-fg)' } }), /*#__PURE__*/
    React.createElement("span", { style: { flex: 1 } }, "You have ",
    pendingInvites.length, " pending team invite", pendingInvites.length === 1 ? '' : 's', "."
    ), /*#__PURE__*/
    React.createElement(D.Button, { variant: "primary", icon: "users", onClick: () => setView('projects') }, "Review in Teams")
    ),


    showOnboarding && Onboarding && /*#__PURE__*/React.createElement(Onboarding, { onDone: handleOnboardingDone }),

    showImportModal && ImportModal && /*#__PURE__*/
    React.createElement(ImportModal, {
      onClose: () => setShowImportModal(false),
      onDone: () => {setShowImportModal(false);reloadAfterImport();} }
    ),


    previewNote && /*#__PURE__*/
    React.createElement("div", { onClick: () => setPreviewNote(null), style: { position: 'absolute', inset: 0, zIndex: 80, background: 'var(--backdrop)', backdropFilter: 'blur(var(--backdrop-blur))', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, /*#__PURE__*/
    React.createElement("div", { onClick: (e) => e.stopPropagation(), style: { width: 680, maxHeight: '80vh', display: 'flex', flexDirection: 'column', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)', overflow: 'hidden' } }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderBottom: '1px solid var(--divider)' } }, /*#__PURE__*/
    React.createElement(D.Icon, { name: "file-text", size: 15, style: { color: 'var(--brand-fg)' } }), /*#__PURE__*/
    React.createElement("span", { style: { flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' } }, previewNote.title), /*#__PURE__*/
    React.createElement("button", { onClick: () => setPreviewNote(null), style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', display: 'inline-flex', padding: 4 } }, /*#__PURE__*/
    React.createElement(D.Icon, { name: "x", size: 15 })
    )
    ), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1, overflowY: 'auto', padding: '20px 24px', fontFamily: 'var(--font-sans)', fontSize: 13.5, color: 'var(--text-body)', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } },
    previewNote.body || '(no content)'
    )
    )
    )

    ), /*#__PURE__*/

    React.createElement("div", { style: { height: 'var(--statusbar-height)', display: 'flex', alignItems: 'center', gap: 14, padding: '0 12px', background: 'var(--surface-base)', borderTop: '1px solid var(--border-subtle)', flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' } }, /*#__PURE__*/
    React.createElement("button", { onClick: openVault, style: { display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--border)', background: 'var(--surface-inset)', color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11 } }, /*#__PURE__*/
    React.createElement(D.Icon, { name: "folder-open", size: 12 }), treeData ? treeData.name : 'Open library...'
    ), /*#__PURE__*/
    React.createElement("button", { onClick: () => setSearchOpen(true), style: { display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11 } }, /*#__PURE__*/
    React.createElement(D.Icon, { name: "search", size: 12 }), "search ", /*#__PURE__*/React.createElement(D.Kbd, null, "\u2318K")
    ), /*#__PURE__*/
    React.createElement("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, /*#__PURE__*/
    React.createElement(D.Icon, { name: "circle-dot", size: 12, style: { color: backendOk ? 'var(--jade-400)' : 'var(--clay-400)' } }),
    backendOk ? 'backend ready' : 'backend offline (:8099)'
    ), /*#__PURE__*/
    React.createElement("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, /*#__PURE__*/
    React.createElement(D.Icon, { name: identityReady ? 'key-round' : 'alert-circle', size: 12, style: { color: identityReady ? 'var(--brand-fg)' : 'var(--text-faint)' } }),
    identityReady ? `${tenant} · ${(persona.scopes || []).join(', ')}` : 'setup incomplete'
    ), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1 } }), /*#__PURE__*/
    React.createElement("span", null, tabs.length, " tab", tabs.length === 1 ? '' : 's')
    )
    ));

}

window.LoreApp = App;