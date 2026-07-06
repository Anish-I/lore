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

// Top-bar CONTEXT switch (Private / Team / Company) — shared predicate used for BOTH
// the file tree (below) and the graph (see filteredGraph). Private is the owner's
// view: EVERYTHING you own, including notes you pushed to a team (you still own
// them). Team/Company narrow to what's been pushed there. (The third `wizardHit`
// arg from the old All/Private/Team/Wizards filter is accepted and ignored so the
// call sites stay untouched.)
function passesScopeFilter(filter, scopeValue, _wizardHit) {
  if (!filter || filter === 'all' || filter === 'private') return true;
  const s = String(scopeValue || '').toLowerCase();
  if (filter === 'team') return s === 'team';
  if (filter === 'company') return s === 'company' || s === 'enterprise';
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
  if (!s) return 'None';
  // Business words only — internal scope ids (engineering/research/…) are all
  // the solo user's own notes, so anything that isn't team/company IS Private.
  const low = String(s).toLowerCase();
  if (low === 'team') return 'Team';
  if (low === 'company' || low === 'enterprise') return 'Company';
  return 'Private';
}

// Quiet "updated Xd ago" label for the doc header, from a file mtime (ms).
function agoLabel(ms) {
  if (!ms || !Number.isFinite(ms)) return 'on disk';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function parseNote(raw, p, mtime) {
  let scope = null, tags = [], body = raw || '';
  const fm = body.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (fm) {
    const meta = fm[1];
    const sc = meta.match(/^scope:\s*(.+)$/m); if (sc) scope = String(sc[1]).trim().replace(/^['"]|['"]$/g, '') || null;
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
  return { id: p, path: base, title, scope, owner: null, updated: agoLabel(mtime), tags, backlinks: [], outline: outline.length ? outline : [title], body: window.mdToRuns(body), raw };
}

// First meaningful body line for the page-card snippet (frontmatter/headings/fences skipped).
function snippetOf(raw) {
  let body = String(raw || '');
  const fm = body.match(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/);
  if (fm) body = body.slice(fm[0].length);
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('```') || t.startsWith('---')) continue;
    return t.replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/[*_`>]/g, '').slice(0, 180);
  }
  return '';
}

// scope value -> place id ('my' | 'team' | 'company')
function placeOfScope(scope) {
  const s = String(scope || '').toLowerCase();
  if (s === 'team') return 'team';
  if (s === 'company' || s === 'enterprise') return 'company';
  return 'my';
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
      <div onClick={(e) => e.stopPropagation()} style={{ width: 560, maxHeight: '64vh', display: 'flex', flexDirection: 'column', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 14, boxShadow: 'var(--shadow-modal)', overflow: 'hidden', animation: 'lore-fade-in 140ms ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--divider)' }}>
          <D.Icon name="search" size={16} style={{ color: 'var(--text-faint)' }} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key}
            placeholder="Search pages by name…"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-strong)', fontFamily: 'var(--font-sans)', fontSize: 15 }} />
          <D.Kbd>esc</D.Kbd>
        </div>
        <div style={{ overflowY: 'auto', padding: 6 }}>
          {results.length === 0 && <div style={{ padding: 18, color: 'var(--text-faint)', fontSize: 13 }}>No pages match.</div>}
          {results.map((n, i) => {
            const pm = (window.LorePlaceMeta || {})[placeOfScope(n.scope)] || {};
            return (
            <div key={n.id} onMouseEnter={() => setIdx(i)} onClick={() => onPick(n.id)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              background: i === idx ? 'var(--surface-selected)' : 'transparent',
            }}>
              <D.Icon name="file-text" size={15} style={{ color: i === idx ? 'var(--brand-fg)' : 'var(--text-faint)' }} />
              <span style={{ flex: 1, fontSize: 13.5, color: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: pm.fg || 'var(--text-faint)', flexShrink: 0 }}>
                <D.Icon name={pm.icon || 'lock'} size={11} />{pm.label || ''}
              </span>
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
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
  return Boolean(p.current && p.current.toLowerCase() !== 'tidy-up complete');
}

function progressCountText(p) {
  if (p.total > 0) return `${p.done}/${p.total}`;
  if (p.done > 0) return String(p.done);
  return '';
}

function App() {
  const [theme, setTheme] = React.useState('dark');
  const [view, setView] = React.useState('workspace');   // hybrid shell boots into the place grid
  const [askOpen, setAskOpen] = React.useState(false);
  const [askSource, setAskSource] = React.useState('all');
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [treeData, setTreeData] = React.useState(null);
  const [tabs, setTabs] = React.useState([]);            // [{id,title,kind,bucket?}]
  const [activeId, setActiveId] = React.useState(null);
  // Backlink breadcrumb: the note id the user just came FROM, when the current
  // note was opened by clicking a connection in the mini-graph/backlinks list.
  // null whenever the user opened the current note any other way.
  const [cameFromId, setCameFromId] = React.useState(null);
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
  const [llmProviders, setLlmProviders] = React.useState(null); // {codex, claude, byok} for the Ask engine picker
  React.useEffect(() => {
    if (!backendOk) return;
    let live = true;
    window.lore?.enrich?.providers?.().then((p) => { if (live && p && !p.error) setLlmProviders(p); }).catch(() => {});
    return () => { live = false; };
  }, [backendOk]);
  const [showOnboarding, setShowOnboarding] = React.useState(false);
  const [showProgress, setShowProgress] = React.useState(false);
  const [progressState, setProgressState] = React.useState({ phase: 'walk', done: 0, total: 0, current: '', errors: 0 });
  const [graphData, setGraphData] = React.useState(null);
  const [graphLoading, setGraphLoading] = React.useState(false);
  const [graphNonce, setGraphNonce] = React.useState(0);
  const [kbFilter, setKbFilter] = React.useState([]);   // selected knowledge bases (top-level folders); [] = all
  const [scopeFilter, setScopeFilter] = React.useState('private'); // top-bar context switch: private | team | company — filters tree+graph AND sets the ask source
  const [showImportModal, setShowImportModal] = React.useState(false);
  const [renamingId, setRenamingId] = React.useState(null); // sidebar node currently showing an inline rename input
  const [previewNote, setPreviewNote] = React.useState(null); // {title, body} for DB-only graph nodes with no source_path
  const [pendingInvites, setPendingInvites] = React.useState([]); // team invites addressed to the signed-in email
  const [inviteBusy, setInviteBusy] = React.useState(null); // invite_id currently being accepted
  const [sectionProposals, setSectionProposals] = React.useState([]); // background upkeep's proposed/applied Sections
  const [toast, setToast] = React.useState(null);          // bottom-center toast message
  const [moveOpen, setMoveOpen] = React.useState(false);   // "Move…" place dialog
  const [mapOpen, setMapOpen] = React.useState(false);     // full-screen knowledge map overlay
  const [authUser, setAuthUser] = React.useState(null);    // {user_id, email, scopes} | null — avatar menu
  const [askCtx, setAskCtx] = React.useState(null);        // {id, title} — "About: {page}" chat context chip
  const [noteMeta, setNoteMeta] = React.useState({});      // id -> {snippet} card-snippet cache
  const [freshIds, setFreshIds] = React.useState(() => new Set()); // "Moved just now" badges
  const [teamBusy, setTeamBusy] = React.useState(false);
  const [teamError, setTeamError] = React.useState('');
  const noteMetaFetched = React.useRef(new Set());
  const toastTimer = React.useRef(null);
  const timer = React.useRef(null);
  const progressUnsubRef = React.useRef(null);
  const progressDoneTimerRef = React.useRef(null);

  React.useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  // Bottom-center toast — auto-dismisses after 2.6s (mockup timing).
  const flash = React.useCallback((msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => { setToast(null); toastTimer.current = null; }, 2600);
  }, []);
  React.useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Signed-in identity for the avatar menu (best-effort; offline → null).
  const refreshAuth = React.useCallback(async () => {
    if (!window.lore?.auth?.status) return;
    try { setAuthUser((await window.lore.auth.status()) || null); } catch { /* signed out */ }
  }, []);
  React.useEffect(() => { refreshAuth(); }, [refreshAuth]);
  const signIn = React.useCallback(async () => {
    if (!window.lore?.auth?.login) { flash('Sign-in is unavailable in this build.'); return; }
    try {
      const r = await window.lore.auth.login();
      if (r && r.ok) { await refreshAuth(); refreshInvites(); flash('Signed in.'); }
      else flash((r && r.reason) || 'Sign-in failed.');
    } catch { flash('Sign-in failed.'); }
  }, [refreshAuth, flash]);
  const signOut = React.useCallback(async () => {
    try { if (window.lore?.auth?.logout) await window.lore.auth.logout(); } catch { /* ignore */ }
    setAuthUser(null);
    flash('Signed out.');
  }, [flash]);

  // Pending team invites for the signed-in user — checked on launch and every few
  // minutes; silently empty when signed out or the backend is unreachable. Also
  // exposed as refreshInvites so the Teams view can force an immediate re-check
  // right after sign-in (e.g. the "Join a team" flow).
  const refreshInvites = React.useCallback(async () => {
    if (!window.lore?.invites?.list) return;
    try {
      const r = await window.lore.invites.list();
      if (r && r.ok && r.body && Array.isArray(r.body.invites)) setPendingInvites(r.body.invites);
    } catch { /* signed out or offline — leave prior state */ }
  }, []);

  React.useEffect(() => {
    let alive = true;
    const check = async () => {
      if (!window.lore?.invites?.list) return;
      try {
        const r = await window.lore.invites.list();
        if (alive && r && r.ok && r.body && Array.isArray(r.body.invites)) setPendingInvites(r.body.invites);
      } catch { /* signed out or offline — no inbox */ }
    };
    check();
    const iv = setInterval(check, 5 * 60 * 1000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const acceptInvite = React.useCallback(async (inviteId) => {
    setInviteBusy(inviteId);
    try {
      const r = await window.lore.invites.accept(inviteId);
      if (r && r.ok) setPendingInvites((list) => list.filter((i) => i.invite_id !== inviteId));
    } catch { /* keep the banner so the user can retry */ }
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
    } catch { /* backend offline — keep the last known list */ }
  }, []);

  React.useEffect(() => {
    loadSections();
    const iv = setInterval(loadSections, 5 * 60 * 1000);
    // scrape:progress fires with phase:'done' after every scrape/upkeep/import run
    // (see main.js) — a good, cheap trigger to refresh the proposal list.
    const unsub = window.lore?.scrapeProgress
      ? window.lore.scrapeProgress((p) => { if (p && p.phase === 'done') loadSections(); })
      : null;
    return () => { clearInterval(iv); if (unsub) unsub(); };
  }, [loadSections]);

  // Enable: moves the section's notes into a new folder (main-process fs, path-guarded)
  // and re-indexes them — fires ONLY from the sidebar's "Enable" button onClick.
  const onSectionApply = React.useCallback(async (id) => {
    if (!window.lore?.sections?.apply) return;
    try { await window.lore.sections.apply(id); } finally { loadSections(); }
  }, [loadSections]);

  const onSectionDismiss = React.useCallback(async (id) => {
    if (!window.lore?.sections?.dismiss) return;
    try { await window.lore.sections.dismiss(id); } finally { loadSections(); }
  }, [loadSections]);

  // Undo: moves an applied section's notes back to their recorded original paths —
  // fires ONLY from the sidebar's "Undo" button onClick.
  const onSectionUndo = React.useCallback(async (id) => {
    if (!window.lore?.sections?.undo) return;
    try { await window.lore.sections.undo(id); } finally { loadSections(); }
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

  // Places (My Notes / Team / Company) ride the existing scopeFilter state:
  // 'my' ⇔ 'private' (everything you own), team/company pass through.
  const place = scopeFilter === 'team' ? 'team' : scopeFilter === 'company' ? 'company' : 'my';
  const setPlace = React.useCallback((id) => {
    setScopeFilter(id === 'my' ? 'private' : id);
    setView('workspace');
  }, []);
  // Tab count badges — notes passing each place's filter (counts match what the
  // place shows, so "My Notes" includes pages you own that are also shared).
  const placeCounts = React.useMemo(() => {
    const c = { my: 0, team: 0, company: 0 };
    for (const n of allNotes) {
      if (passesScopeFilter('private', n.scope)) c.my += 1;
      if (passesScopeFilter('team', n.scope)) c.team += 1;
      if (passesScopeFilter('company', n.scope)) c.company += 1;
    }
    return c;
  }, [allNotes]);
  // Pages created/edited in the last day — the greeting's "N new since yesterday".
  const newCount = React.useMemo(() => {
    const cutoff = Date.now() - 86400 * 1000;
    return allNotes.filter((n) => n.mtimeMs && n.mtimeMs > cutoff).length;
  }, [allNotes]);

  // Getting-started checklist — flags persist in config.gettingStarted.
  const checklistCfg = (appConfig && appConfig.gettingStarted) || {};
  const markStep = React.useCallback(async (step) => {
    setAppConfig((cfg) => {
      const cur = (cfg && cfg.gettingStarted) || {};
      if (cur[step]) return cfg;
      const gettingStarted = { ...cur, [step]: true };
      if (window.lore?.config?.set) window.lore.config.set({ gettingStarted }).catch(() => {});
      return { ...(cfg || {}), gettingStarted };
    });
  }, []);
  const dismissChecklist = React.useCallback(() => {
    setAppConfig((cfg) => {
      const gettingStarted = { ...((cfg && cfg.gettingStarted) || {}), dismissed: true };
      if (window.lore?.config?.set) window.lore.config.set({ gettingStarted }).catch(() => {});
      return { ...(cfg || {}), gettingStarted };
    });
  }, []);

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

  // Grid data for the current place (+ section filter), newest first.
  const placeNotes = React.useMemo(() => {
    const list = flatten(shownTree);
    return [...list].sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
  }, [shownTree]);
  // Section rail rows — top-level folders of this place with note counts.
  const railSections = React.useMemo(() =>
    scopeFilteredTree.filter((n) => n.kind === 'folder')
      .map((f) => ({ name: f.name, count: flatten([f]).length }))
      .filter((s) => s.count > 0),
  [scopeFilteredTree]);
  const railActive = kbFilter.length === 1 ? kbFilter[0] : 'all';
  const onRailSelect = React.useCallback((name) => {
    setKbFilter(name === 'all' ? [] : [name]);
  }, []);

  // Card snippets — lazy readNote for the first 60 visible cards, ~6 at a time.
  // The fetched-set ref stops refetch loops; vault changes clear both caches.
  React.useEffect(() => {
    let live = true;
    const want = placeNotes.slice(0, 60).filter((n) => !noteMetaFetched.current.has(n.id));
    if (!want.length || !window.lore?.readNote) return;
    want.forEach((n) => noteMetaFetched.current.add(n.id));
    const queue = want.slice();
    const worker = async () => {
      while (queue.length && live) {
        const n = queue.shift();
        try {
          const r = await window.lore.readNote(n.id);
          if (live) setNoteMeta((m) => ({ ...m, [n.id]: { snippet: snippetOf(r && r.raw) } }));
        } catch { /* card renders without a snippet */ }
      }
    };
    Promise.all(Array.from({ length: 6 }, worker)).catch(() => {});
    return () => { live = false; };
  }, [placeNotes]);
  React.useEffect(() => {
    if (!window.lore?.onVaultChanged) return;
    return window.lore.onVaultChanged(() => { noteMetaFetched.current = new Set(); setNoteMeta({}); });
  }, []);

  // Team place gate — create/join flows (mirrors the Teams view logic).
  const inTeam = Boolean(appConfig && appConfig.team && appConfig.team.team_id)
    || Boolean(authUser && Array.isArray(authUser.scopes) && authUser.scopes.length > 0);
  const createTeam = React.useCallback(async (name) => {
    setTeamBusy(true); setTeamError('');
    try {
      let user = authUser;
      if (!user && window.lore?.auth?.login) {
        try {
          const r = await window.lore.auth.login();
          if (r && r.ok) { user = { user_id: r.user_id, email: r.email, scopes: r.scopes || [] }; setAuthUser(user); }
        } catch { /* offline sign-in */ }
      }
      if (!user) {
        // No session available — save the intent locally, same as the Teams view.
        const teamCfg = { intent: 'create', name, pending: 'sign-in' };
        if (window.lore?.config?.set) { try { const next = await window.lore.config.set({ team: teamCfg }); setAppConfig(next); } catch { /* non-fatal */ } }
        setTeamError(`Team "${name}" saved locally — team sync and invites activate once sign-in is available.`);
      } else {
        const res = await window.lore.teams.create(name);
        if (!res || !res.ok) { setTeamError((res && res.body && res.body.detail) || 'Could not create the team.'); }
        else {
          const teamCfg = { intent: 'create', name, team_id: res.body.team_id, scope: res.body.scope, ...(user.email ? { email: user.email } : {}) };
          if (window.lore?.config?.set) { try { const next = await window.lore.config.set({ team: teamCfg }); setAppConfig(next); } catch { /* non-fatal */ } }
          flash(`Team "${name}" created.`);
          refreshAuth();
        }
      }
    } catch (e) { setTeamError(String((e && e.message) || e)); }
    setTeamBusy(false);
  }, [authUser, flash, refreshAuth]);
  const joinTeam = React.useCallback(async () => {
    await signIn();
    refreshInvites();
  }, [signIn, refreshInvites]);
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
      { value: 'all', label: scopes.length > 1 ? `All (${scopes.length})` : 'Everything', icon: 'layers' },
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
    const parsed = parseNote(r.raw, id, r.mtime);
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
    setActiveId(id); setView('workspace'); setMode('read'); setSearchOpen(false);
    markStep('opened');
    const parsed = await loadNote(id);
    setScope(parsed.scope);
  }, [loadNote, markStep]);

  // Wiki-link clicks in the reading view: resolve "[[Name]]" (or a path) to a
  // real note and open it, keeping the backlink breadcrumb.
  const openByRef = React.useCallback((ref) => {
    if (!ref) return;
    const low = String(ref).toLowerCase();
    const hit = allNotes.find((n) => n.id.toLowerCase() === low)
      || allNotes.find((n) => n.name.toLowerCase() === low)
      || allNotes.find((n) => n.name.toLowerCase() === low.replace(/\.md$/i, ''));
    if (hit) openNote(hit.id, activeId);
  }, [allNotes, openNote, activeId]);

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

  // "Close others" (tab-strip hover action): keep only the given tab, activating it
  // when the active tab was among the closed — one pass, so it can't race closeTab.
  const closeOtherTabs = (id) => {
    const t = tabs.find((x) => x.id === id);
    if (!t) return;
    setTabs((ts) => ts.filter((x) => x.id === id));
    if (id !== activeId) {
      setActiveId(id);
      if (t.kind === 'note') { setMode('read'); loadNote(id); }
    }
  };

  // Initial/switch library load — lands on the place grid (no auto-opened note).
  const loadTree = React.useCallback(async (root) => {
    const td = await window.lore.readTree(root);
    if (!td) return false;
    setTreeData(td);
    return true;
  }, []);
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

  // "Move…" — the page changes place via the redaction-gated setNoteScope IPC
  // (frontmatter rewrite + reindex in main). Move-to-my restores the user's own
  // configured scope (purpose scopes like `engineering` ARE "My Notes"), never a
  // blind `scope: private` unless nothing is configured.
  const [moveBusy, setMoveBusy] = React.useState(false);
  const moveNote = React.useCallback(async (target) => {
    if (!activeId || !window.lore?.setNoteScope || moveBusy) return;
    const scopeVal = target === 'team' ? 'team'
      : target === 'company' ? 'company'
      : ((appConfig && appConfig.scope) || 'private');
    setMoveBusy(true);
    try {
      let r = await window.lore.setNoteScope(activeId, scopeVal, false);
      if (r && r.reason === 'secret' && !r.ok) {
        if (!window.confirm(`${r.detail}\n\nShare it anyway?`)) { setMoveBusy(false); return; }
        r = await window.lore.setNoteScope(activeId, scopeVal, true);
      }
      if (r && r.ok) {
        setMoveOpen(false);
        try {
          const rr = await window.lore.readNote(activeId);
          const parsed = parseNote(rr.raw, activeId, rr.mtime);
          setNotes((m) => ({ ...m, [activeId]: parsed }));
          setDrafts((m) => ({ ...m, [activeId]: rr.raw }));
          setScope(parsed.scope);
        } catch { /* tree refresh below still applies */ }
        setGraphNonce((n) => n + 1);
        if (treeData) reloadTree(treeData.root);
        markStep('moved');
        const movedId = activeId;
        setFreshIds((prev) => new Set(prev).add(movedId));
        setTimeout(() => setFreshIds((prev) => { const c = new Set(prev); c.delete(movedId); return c; }), 6000);
        setScopeFilter(target === 'my' ? 'private' : target); // follow the page to its new place
        const label = (window.LorePlaceMeta[target] || {}).label || target;
        if (target === 'team' && !inTeam) flash('Moved to Team — finish team setup so teammates can see it.');
        else flash(`Moved to ${label}.`);
      } else if (r && r.error) {
        flash('Move failed: ' + r.error);
      }
    } finally { setMoveBusy(false); }
  }, [activeId, appConfig, treeData, reloadTree, markStep, flash, inTeam, moveBusy]);

  // (Sidebar-era library switcher / discovered-libraries popover / tree context
  // menu removed with the old shell — the status-bar Open library button and
  // onboarding remain the library entry points.)

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
    setNotes((m) => { const c = { ...m }; let ch = false; for (const k of Object.keys(c)) if (pred(k)) { delete c[k]; ch = true; } return ch ? c : m; });
    setDrafts((m) => { const c = { ...m }; let ch = false; for (const k of Object.keys(c)) if (pred(k)) { delete c[k]; ch = true; } return ch ? c : m; });
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
    try { res = await window.lore.treeRename(node.id, trimmed, node.kind); } catch { res = null; }
    if (!res || res.ok === false) { if (treeData) reloadTree(treeData.root); return; }
    const oldId = node.id, newPath = res.newPath;
    if (newPath !== oldId) {
      const remap = (id) => {
        if (node.kind === 'note') return id === oldId ? newPath : id;
        if (id === oldId) return newPath;
        const sep = id.includes('/') ? '/' : '\\';
        const oldPrefix = oldId.replace(/[\\/]+$/, '') + sep;
        return id.startsWith(oldPrefix) ? newPath + sep + id.slice(oldPrefix.length) : id;
      };
      setTabs((ts) => ts.map((t) => t.kind === 'note' ? { ...t, id: remap(t.id) } : t));
      setNotes((m) => { const c = {}; for (const k of Object.keys(m)) c[remap(k)] = { ...m[k], id: remap(k) }; return c; });
      setDrafts((m) => { const c = {}; for (const k of Object.keys(m)) c[remap(k)] = m[k]; return c; });
      setActiveId((a) => (a ? remap(a) : a));
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
      if (action === 'open') { openNote(id); return; }
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
        setRenamingId((r) => (r === id ? null : r));
        return;
      }
      if (action === 'scope-changed') {
        // Context-menu "Push to Team" / "Make Private" landed in main — re-read
        // the note (frontmatter changed on disk), refresh the tree glyphs + graph.
        try {
          const r = await window.lore.readNote(id);
          const parsed = parseNote(r.raw, id, r.mtime);
          setNotes((m) => (m[id] ? { ...m, [id]: parsed } : m));
          setDrafts((m) => (m[id] != null ? { ...m, [id]: r.raw } : m));
          setActiveId((a) => { if (a === id) setScope(parsed.scope); return a; });
        } catch { /* note may be closed — tree refresh below still applies */ }
        if (treeData) await reloadTree(treeData.root);
        setGraphNonce((n) => n + 1);
        return;
      }
      // 'trash-failed' / 'scope-change-failed' — fail soft, nothing to reconcile client-side.
    });
    return unsub;
  }, [treeData, openNote, reloadTree, closeNotesWhere]);

  // Backend liveness: the boot effect below checks ONCE, usually before the
  // engine finishes starting (~10s) — which left the status stuck on "starting"
  // forever. Poll fast (3s) until it's up, then slow (30s) to notice a crash.
  React.useEffect(() => {
    let live = true;
    const check = async () => {
      try { await window.lore.presets(); if (live) setBackendOk(true); }
      catch { if (live) setBackendOk(false); }
    };
    const id = setInterval(check, backendOk ? 30000 : 3000);
    return () => { live = false; clearInterval(id); };
  }, [backendOk]);

  React.useEffect(() => {
    (async () => {
      try { const p = await window.lore.presets(); setPresets(p); setBackendOk(true); } catch { setBackendOk(false); }
      // Resolve only explicitly configured roots. No bundled/sample library is assumed.
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
      // Once a user has set up locally (or explicitly skipped), NEVER auto-prompt
      // onboarding again — not on a version bump, and not just because the library
      // root failed to load this boot (a transient state, not a reason to re-onboard).
      const configuredBefore = existingCfg && (existingCfg.onboardedAt || existingCfg.skippedSetupAt
        || (Array.isArray(existingCfg.roots) && existingCfg.roots.length > 0));
      if (!configuredBefore) setShowOnboarding(true);
    })();
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen((o) => !o); }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); setAskOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => { clearInterval(timer.current); window.removeEventListener('keydown', onKey); };
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
    } catch { /* non-fatal */ }
    setTreeData(td);
    setKbFilter([]);
    setTabs([]);
    setNotes({});
    setDrafts({});
    setActiveId(null);
  }, [appConfig]);

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
      updateProgress({ phase: 'done', done: 0, total: 0, current: String((e && e.message) || e), errors: 1 });
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
      } catch { /* backend briefly down — next tick retries */ }
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
      setGraphData(g); setGraphLoading(false);
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
      const parsed = parseNote(drafts[activeId] || '', activeId, Date.now());
      setNotes((mm) => ({ ...mm, [activeId]: parsed }));
      setTabs((ts) => ts.map((t) => t.id === activeId ? { ...t, title: parsed.title } : t));
    }
    setMode(m);
  };

  // The chat's context follows the top-bar switch: Private → the persona scopes
  // (as before, still narrowable in the panel), Team/Company → only pushed notes.
  const askScopesFor = () => {
    if (scopeFilter === 'team') return ['team'];
    if (scopeFilter === 'company') return ['company', 'enterprise'];
    return sourceScopes(persona.scopes, askSource);
  };

  // One active thread; the History drawer lists/resumes/deletes past ones.
  const askThreadRef = React.useRef(null);
  const [askThreads, setAskThreads] = React.useState(null);
  const persistTurn = (turn) => {
    // Fire-and-forget: history is a convenience, never a blocker for the answer.
    if (tenant && window.lore?.askHistory?.append) {
      window.lore.askHistory.append(tenant, { thread_id: askThreadRef.current, source: scopeFilter, ...turn }).catch(() => {});
    }
  };
  const loadAskThreads = React.useCallback(async () => {
    if (!tenant || !window.lore?.askHistory?.threads) { setAskThreads([]); return; }
    try { const r = await window.lore.askHistory.threads(tenant); setAskThreads((r && r.threads) || []); }
    catch { setAskThreads([]); }
  }, [tenant]);
  const resumeAskThread = React.useCallback(async (threadId) => {
    if (!tenant || !window.lore?.askHistory?.thread) return;
    try {
      const r = await window.lore.askHistory.thread(tenant, threadId);
      askThreadRef.current = threadId;
      setMessages((r.messages || []).map((m) => m.role === 'user'
        ? { role: 'user', text: m.text }
        : { role: 'answer', shown: [], streaming: false, text: m.text, citations: m.sources || [] }));
      setAskOpen(true);
    } catch { /* thread gone — drawer refresh will show it */ }
  }, [tenant]);
  const deleteAskThread = React.useCallback(async (threadId) => {
    if (!tenant || !window.lore?.askHistory?.remove) return;
    try { await window.lore.askHistory.remove(tenant, threadId); } catch { /* refresh below either way */ }
    if (askThreadRef.current === threadId) { askThreadRef.current = null; setMessages([]); }
    loadAskThreads();
  }, [tenant, loadAskThreads]);
  const newAskChat = React.useCallback(() => { askThreadRef.current = null; setMessages([]); }, []);

  // Citation chip context action: push the cited note to the team. Same
  // redaction-gated IPC as the editor's visibility control; the note's path
  // comes from the graph (nodes carry path per note id).
  const pushCitationScope = React.useCallback(async (cite, scope) => {
    const node = graphData && graphData.nodes.find((x) => x.id === cite.note_id);
    if (!node || !node.path || !window.lore?.setNoteScope) return;
    let r = await window.lore.setNoteScope(node.path, scope, false);
    if (r && r.reason === 'secret' && !r.ok) {
      if (!window.confirm(`${r.detail}\n\nShare it anyway?`)) return;
      r = await window.lore.setNoteScope(node.path, scope, true);
    }
    if (r && r.ok) {
      setGraphNonce((n) => n + 1);
      if (treeData) reloadTree(treeData.root);
    }
  }, [graphData, treeData, reloadTree]);

  const ask = async (q, model, provider) => {
    if (asking) return;
    setAskOpen(true);
    setAsking(true);
    markStep('asked');
    // Follow-ups: hand the backend the running conversation (it uses the last 6 turns).
    const history = messages
      .filter((m) => (m.role === 'user' && m.text) || (m.role === 'answer' && !m.streaming && m.text))
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text }))
      .slice(-6);
    if (!askThreadRef.current) askThreadRef.current = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    setMessages((m) => [...m, { role: 'user', text: q }, { role: 'answer', shown: [], streaming: true }]);
    const scopes = askScopesFor();
    if (!tenant || !scopes.length) {
      setMessages((m) => { const c = m.slice(); c[c.length - 1] = { role: 'answer', shown: [{ x: 'Finish setup with an account, library, and purpose before asking Lore.' }], streaming: false }; return c; });
      setAsking(false); return;
    }
    persistTurn({ role: 'user', text: q });
    // "About: {page}" chip — /trace has no note-filter param, so v1 anchors the
    // question to the page by name (TODO: real note_id filter backend-side).
    const sendQ = askCtx && askCtx.title ? `Regarding the page "${askCtx.title}": ${q}` : q;
    let trace;
    try { trace = await window.lore.ask(sendQ, scopes, tenant, model, history, provider); }
    catch (e) {
      setMessages((m) => { const c = m.slice(); c[c.length - 1] = { role: 'answer', shown: [{ x: 'The memory engine isn’t reachable yet (:8099) — try again in a moment.' }], streaming: false }; return c; });
      setAsking(false); return;
    }
    const answerText = String(trace.answer || 'Nothing you can see mentions this yet.');
    const words = answerText.split(/(\s+)/).filter(Boolean).map((w) => ({ x: w }));
    const evidence = evidenceFromTrace(trace);
    // Enrich citations with a hover preview: the retrieved passage for that note
    // (what the chip/[Title] popover shows — 'what the notebook says').
    const akPrevByNote = {};
    (trace.final || []).forEach((f) => {
      if (f.note_id && f.text && !akPrevByNote[f.note_id]) akPrevByNote[f.note_id] = String(f.text).slice(0, 300);
    });
    const citations = (trace.citations || []).map((c) => ({ ...c, preview: akPrevByNote[c.note_id] || '' }));
    const sources = (trace.final || []).length;
    // Prefer the sources the backend ACTUALLY searched (scopes_used) — makes the
    // confidentiality boundary of each answer honest and visible.
    const used = (trace.scopes_used && trace.scopes_used.length) ? trace.scopes_used : (trace.scopes_asked || scopes);
    const scopesLabel = `answered from ${[...new Set(used.map(scopeLabel))].join(', ')} · ${sources} chunks`;
    persistTurn({ role: 'assistant', text: answerText, sources: citations });
    let i = 0;
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      i += 2;
      setMessages((m) => {
        const c = m.slice(); const last = c[c.length - 1];
        if (!last || last.role !== 'answer') return m;
        const shown = words.slice(0, i);
        if (i >= words.length) { clearInterval(timer.current); c[c.length - 1] = { ...last, shown, streaming: false, sources, scopes: scopesLabel, evidence, citations, text: answerText }; setAsking(false); }
        else c[c.length - 1] = { ...last, shown };
        return c;
      });
    }, 28);
  };

  const D = window.VaultDesignSystem_ffbf58;
  // Advanced mode (default OFF) gates the developer surfaces. The old
  // cfg.simpleMode flag is ignored entirely — the default experience IS simple.
  const advancedMode = !!(appConfig && appConfig.advancedMode === true);
  const PlacesBar = window.LorePlacesBar, Ribbon = window.LoreRibbon,
    SectionRail = window.LoreSectionRail, ToastPill = window.LoreToast,
    HomeGrid = window.LoreHomeGrid, PageView = window.LorePageView, RelatedPages = window.LoreRelatedPages,
    Editor = window.LoreEditor, AskPanel = window.LoreAskPanel,
    TeamsView = window.LoreTeamsView, GraphView = window.LoreGraphView,
    BucketsView = window.LoreBucketsView, SettingsView = window.LoreSettingsView,
    HooksView = window.LoreHooksView, Onboarding = window.LoreOnboarding,
    ImportModal = window.LoreImportModal;

  const activeTab = tabs.find((t) => t.id === activeId);
  const activeNote = activeTab && activeTab.kind === 'note' ? notes[activeId] : null;
  const editorNote = activeNote && { ...activeNote, raw: drafts[activeId], onEdit: setDraft };
  const activeBucket = activeTab && activeTab.kind === 'bucket' ? activeTab.bucket : null;
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
      if (other && other.path && !seen.has(other.id)) { seen.add(other.id); out.push({ id: other.id, label: other.label, path: other.path, kind, dir, scope: other.scope }); }
    }
    return out;
  }, [graphData, activeId]);

  // Personalized prompt chips (Home + the empty chat): deterministic
  // suggestPrompts over the persisted ask history + the most recently active
  // section from /digest. Falls back to the profile examples pre-setup.
  const [promptSeed, setPromptSeed] = React.useState({ history: [], recentSection: null, sessionPrompts: [] });
  React.useEffect(() => {
    if (!identityReady) return;
    let live = true;
    (async () => {
      let history = [], recentSection = null;
      try {
        const r = window.lore?.askHistory?.recent ? await window.lore.askHistory.recent(tenant, 200) : null;
        history = (r && r.messages) || [];
      } catch { /* engine starting */ }
      try {
        const d = window.lore?.digest ? await window.lore.digest(tenant, 7) : null;
        recentSection = (d && d.rows && d.rows[0] && d.rows[0].section) || null;
      } catch { /* engine starting */ }
      let sessionPrompts = [];
      try {
        const sp = window.lore?.recentPrompts ? await window.lore.recentPrompts(tenant, 200) : null;
        sessionPrompts = (sp && sp.prompts) || [];
      } catch { /* engine starting */ }
      if (live) setPromptSeed({ history, recentSection, sessionPrompts });
    })();
    return () => { live = false; };
  }, [identityReady, tenant, askOpen, view]);
  const personalPrompts = React.useMemo(() => {
    if (!window.LoreSuggestPrompts) return suggestions;
    return window.LoreSuggestPrompts(promptSeed.history, { recentSection: promptSeed.recentSection, sessionPrompts: promptSeed.sessionPrompts });
  }, [promptSeed, suggestions]);

  // When viewing a Wizard, pre-generate suggested questions for it; otherwise the personalized chips.
  const bucketQuestions = (b) => b ? [
    `Summarize ${b.name}`,
    ...((b.topics || []).slice(0, 2).map((t) => `What's important about ${t}?`)),
    `What are the open risks or gaps in ${b.name}?`,
  ].slice(0, 4) : suggestions;
  const askSuggestions = askCtx
    ? ['Summarize this page', 'What are the key figures here?', 'What connects to this page?']
    : activeBucket ? bucketQuestions(activeBucket) : (identityReady ? personalPrompts : suggestions);

  // Citations card row click — resolve the cited note to a real file and open it;
  // DB-only nodes (no source_path) fall back to the preview modal.
  const openCitation = React.useCallback((cite) => {
    const node = graphData && graphData.nodes.find((x) => x.id === cite.note_id
      || (cite.title && x.label && String(x.label).toLowerCase() === String(cite.title).toLowerCase()));
    if (node && node.path) { openNote(node.path); return; }
    if (window.lore?.notes?.get) {
      window.lore.notes.get(cite.note_id).then((nd) => {
        if (nd) setPreviewNote({ title: nd.title || cite.title || String(cite.note_id), body: nd.body || '' });
      }).catch(() => {});
    }
  }, [graphData, openNote]);

  // Composer scope chip — team/company places are pinned; My Notes cycles the
  // configured sources (same values as the cog's Source select).
  const askScopeChip = React.useMemo(() => {
    if (place === 'team') return { label: 'Team', onCycle: null };
    if (place === 'company') return { label: 'Company', onCycle: null };
    const opts = askSourceOptions;
    if (!opts || opts.length < 2) return { label: 'everywhere', onCycle: null };
    const idx = Math.max(0, opts.findIndex((o) => o.value === (askSource || 'all')));
    const cur = opts[idx] || opts[0];
    return {
      label: cur.value === 'all' ? 'everywhere' : cur.label,
      onCycle: () => setAskSource(opts[(idx + 1) % opts.length].value),
    };
  }, [place, askSourceOptions, askSource]);

  const askPanel = <AskPanel messages={messages} asking={asking} suggestions={askSuggestions} onSend={ask} onClose={() => { setAskOpen(false); setAskCtx(null); }} source={askSource} onSource={setAskSource} sourceOptions={askSourceOptions} identityReady={identityReady} onSetup={() => { setView('settings'); setShowOnboarding(true); }}
    threads={askThreads} onLoadThreads={loadAskThreads} onResumeThread={resumeAskThread} onDeleteThread={deleteAskThread} onNewChat={() => { newAskChat(); setAskCtx(null); }} onCiteScope={pushCitationScope} onOpenCitation={openCitation} providers={llmProviders} defaultProvider={(appConfig && appConfig.llmProvider) || 'claude'}
    ctx={askCtx} onClearCtx={() => setAskCtx(null)} scopeChip={askScopeChip} />;

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
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 20, color: 'var(--text-body)' }}>{treeData.name} · {treeData.indexed} things remembered</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', maxWidth: 480, padding: '0 24px', boxSizing: 'border-box' }}>
              <input
                autoFocus
                value={draftQ}
                onChange={(e) => setDraftQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitAsk(); }}
                placeholder="Ask your library anything…"
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
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, color: 'var(--text-body)' }}>Open a library to start.</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
              <D.Button variant="primary" icon="sparkles" onClick={createLoreVault}>Let Lore choose path</D.Button>
              <D.Button variant="secondary" icon="folder" onClick={openVault}>Open library folder...</D.Button>
              {Onboarding && (
                <D.Button variant="ghost" icon="settings" onClick={() => setShowOnboarding(true)}>Set up…</D.Button>
              )}
            </div>
          </React.Fragment>
        )}
      </div>
    );
  };

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface-sunken)' }}
      onDragOver={(e) => { e.preventDefault(); }} onDrop={onDropImport}>
      <PlacesBar place={place} onPlace={setPlace} counts={placeCounts}
        onSearch={() => setSearchOpen(true)} theme={theme}
        onToggleTheme={() => setTheme((t) => t === 'dark' ? 'light' : 'dark')}
        authUser={authUser} ownerName={(appConfig && appConfig.owner) || null}
        onSettings={() => setView('settings')}
        onHooks={advancedMode ? () => setView('hooks') : null}
        onManageTeam={() => setView('projects')}
        onSignIn={signIn} onSignOut={signOut} />
      <Ribbon place={place} askOpen={askOpen} mapOpen={mapOpen} wizardsOpen={view === 'wizards'}
        canMove={Boolean(activeNote)}
        onNewPage={onCreateNote} onAddFiles={onImport}
        onToggleAsk={() => setAskOpen((o) => !o)}
        onMap={() => setMapOpen((o) => !o)}
        onWizards={() => setView(view === 'wizards' ? 'workspace' : 'wizards')}
        onMove={() => setMoveOpen(true)} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
        <LoreErrorBoundary key={view}>
        {view === 'workspace' && (
          <React.Fragment>
            {!treeData ? (
              <EmptyEditor />
            ) : (
              <React.Fragment>
                {!(place === 'team' && !inTeam && placeCounts.team === 0) && (
                  <SectionRail sections={railSections} allCount={placeCounts[place]}
                    active={railActive} onSelect={onRailSelect} place={place} theme={theme} />
                )}
                {activeBucket ? (
                  <Editor bucket={activeBucket} tabs={tabs} activeId={activeId} onTab={onTab} onCloseTab={closeTab} onCloseOthers={closeOtherTabs} hideTabs onOpen={() => setAskOpen(true)} />
                ) : editorNote ? (
                  <PageView note={editorNote} place={place} mode={mode}
                    onBack={() => setActiveId(null)}
                    onChatAbout={() => { setAskCtx({ id: activeId, title: editorNote.title }); setAskOpen(true); }}
                    onMove={() => setMoveOpen(true)}
                    editor={
                      <Editor note={editorNote} mode={mode} onMode={onMode} onOpen={openByRef}
                        hideTabs hideToolbar
                        accent={(window.LorePlaceMeta[placeOfScope(editorNote.scope)] || {}).fg}
                        footer={RelatedPages ? <RelatedPages connections={connections} onOpen={openNoteFromBacklink} /> : null} />
                    } />
                ) : (
                  <HomeGrid place={place} theme={theme}
                    ownerName={(authUser && authUser.email && authUser.email.split('@')[0]) || (appConfig && appConfig.owner) || null}
                    totalCount={placeCounts.my} newCount={newCount}
                    suggestions={askSuggestions} onAsk={(q) => ask(q)}
                    checklist={{
                      imported: Boolean((treeData && treeData.indexed > 0) || allNotes.length > 0),
                      opened: Boolean(checklistCfg.opened), asked: Boolean(checklistCfg.asked),
                      moved: Boolean(checklistCfg.moved), dismissed: Boolean(checklistCfg.dismissed),
                    }}
                    onChecklistGo={(step) => {
                      if (step === 'imported') setShowImportModal(true);
                      else if (step === 'opened' && placeNotes[0]) openNote(placeNotes[0].id);
                      else if (step === 'asked') setAskOpen(true);
                      else if (step === 'moved') flash('Open a page, then press Move… in the ribbon.');
                    }}
                    onChecklistDismiss={dismissChecklist}
                    sectionFilter={railActive} notes={placeNotes} noteMeta={noteMeta} baseOf={baseOf} freshIds={freshIds}
                    onOpen={openNote} onChat={(id) => { const n = placeNotes.find((x) => x.id === id); setAskCtx({ id, title: (n && n.name) || id }); setAskOpen(true); }}
                    onNewPage={onCreateNote} onAddFiles={onImport}
                    teamGate={(place === 'team' && !inTeam && placeCounts.team === 0) ? {
                      onCreateTeam: createTeam, onJoinTeam: joinTeam,
                      invites: pendingInvites, inviteBusy, onAcceptInvite: acceptInvite,
                      busy: teamBusy, error: teamError,
                    } : null} />
                )}
              </React.Fragment>
            )}
            {askOpen && askPanel}
          </React.Fragment>
        )}

        {view === 'projects' && (
          <React.Fragment>
            <TeamsView config={appConfig} onConfig={setAppConfig} buckets={M.buckets} onOpenWizard={(b) => openBucket(b)}
              pendingInvites={pendingInvites} inviteBusy={inviteBusy} onAcceptInvite={acceptInvite} onRefreshInvites={refreshInvites} />
            {askOpen && askPanel}
          </React.Fragment>
        )}
        {view === 'wizards' && window.LoreWizardsView && (
          <React.Fragment>
            <window.LoreWizardsView onBack={() => setView('workspace')}
              backLabel={(window.LorePlaceMeta[place] || {}).label}
              scopes={persona.scopes} onChanged={reloadAfterImport} />
            {askOpen && askPanel}
          </React.Fragment>
        )}
        {view === 'settings' && <SettingsView settings={M.settings} config={appConfig} scopeOptions={scopeOptions} onConfig={setAppConfig} onOpenSetup={() => setShowOnboarding(true)} />}
        {view === 'hooks' && advancedMode && HooksView && <HooksView scopeOptions={scopeOptions} identityReady={identityReady} tenant={tenant} scope={persona.scopes && persona.scopes[0]} onOpenSetup={() => setShowOnboarding(true)} />}
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

        {pendingInvites.length > 0 && !showOnboarding && view !== 'projects' && (
          <div style={{ position: 'absolute', top: showProgress ? 34 : 0, left: 0, right: 0, zIndex: 29, background: 'var(--brand-soft-bg)', borderBottom: '1px solid var(--brand-soft-border)', padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: 'var(--text-body)' }}>
            <D.Icon name="mail" size={14} style={{ color: 'var(--brand-fg)' }} />
            <span style={{ flex: 1 }}>
              You have {pendingInvites.length} pending team invite{pendingInvites.length === 1 ? '' : 's'}.
            </span>
            <D.Button variant="primary" icon="users" onClick={() => setView('projects')}>Review in Teams</D.Button>
          </div>
        )}

        {showOnboarding && Onboarding && <Onboarding onDone={handleOnboardingDone} />}

        {showImportModal && ImportModal && (
          <ImportModal
            onClose={() => setShowImportModal(false)}
            onDone={() => { setShowImportModal(false); reloadAfterImport(); }}
          />
        )}

        {mapOpen && window.LoreMapOverlay && (
          <window.LoreMapOverlay graph={filteredGraph} loading={graphLoading}
            onOpen={(id) => { setMapOpen(false); onGraphOpen(id); }}
            onClose={() => setMapOpen(false)}
            bases={bases} kbFilter={kbFilter} onToggleBase={toggleBase} baseOf={baseOf} />
        )}

        {ToastPill && <ToastPill toast={toast} />}

        {moveOpen && window.LoreMoveDialog && activeNote && (
          <window.LoreMoveDialog note={activeNote} busy={moveBusy} onMove={moveNote} onClose={() => setMoveOpen(false)} />
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
          <D.Icon name="folder-open" size={12} />{treeData ? treeData.name : 'Open library...'}
        </button>
        <button onClick={() => setSearchOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          <D.Icon name="search" size={12} />search <D.Kbd>⌘K</D.Kbd>
        </button>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <D.Icon name="circle-dot" size={12} style={{ color: backendOk ? 'var(--jade-400)' : 'var(--clay-400)' }} />
          {backendOk ? 'memory engine ready' : 'memory engine is starting… (:8099)'}
        </span>
        {!identityReady && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <D.Icon name="alert-circle" size={12} style={{ color: 'var(--text-faint)' }} />
            setup incomplete
          </span>
        )}
        <div style={{ flex: 1 }} />
        <span>{tabs.length} tab{tabs.length === 1 ? '' : 's'}</span>
      </div>
    </div>
  );
}

window.LoreApp = App;
