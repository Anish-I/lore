/* global React */
// Lore desktop — WIRED root app. Reuses the design ui-kit components, but the
// file tree, note content, presets, and Ask all come from the real backend / fs.
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
function firstNote(tree) {
  for (const n of tree) {
    if (n.kind === 'note') return n;
    if (n.children) { const f = firstNote(n.children); if (f) return f; }
  }
  return null;
}

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
  return {
    id: p, path: base, title, scope, owner: 'you', updated: 'on disk', tags,
    backlinks: [], outline: outline.length ? outline : [title],
    body: window.mdToRuns(body), raw,
  };
}

function evidenceFromTrace(trace) {
  return (trace.final || []).map((f, i) => {
    const parts = String(f.title || '').split(' > ');
    return {
      index: i + 1, note: parts[0] || f.title, heading: parts.slice(1).join(' › ') || '—',
      scope: f.scope, lane: trace.classification || 'hybrid',
      score: typeof f.final === 'number' ? f.final : 0, owner: String(f.note_id || '').slice(0, 6),
    };
  });
}

function App() {
  const [theme, setTheme] = React.useState('dark');
  const [view, setView] = React.useState('workspace');
  const [askOpen, setAskOpen] = React.useState(false);
  const [treeData, setTreeData] = React.useState(null);      // { root, name, tree, indexed }
  const [activeId, setActiveId] = React.useState(null);
  const [note, setNote] = React.useState(null);
  const [mode, setMode] = React.useState('read');
  const [draft, setDraft] = React.useState('');
  const [scope, setScope] = React.useState('team');
  const [messages, setMessages] = React.useState([]);
  const [asking, setAsking] = React.useState(false);
  const [presets, setPresets] = React.useState(null);
  const [personaIdx, setPersonaIdx] = React.useState(0);
  const [backendOk, setBackendOk] = React.useState(true);
  const timer = React.useRef(null);

  React.useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  const tree = treeData ? treeData.tree : [];
  const persona = (presets && presets.personas && presets.personas[personaIdx]) || { label: 'You', scopes: ['alice-private', 'eng-team', 'acme-corp'] };
  const tenant = (presets && presets.tenant) || 'acme';
  const suggestions = (presets && presets.examples) || ['What do we know about the Acme renewal risk?'];

  const openNote = React.useCallback(async (id) => {
    const r = await window.lore.readNote(id);
    const parsed = parseNote(r.raw, id);
    setNote(parsed); setActiveId(id); setDraft(r.raw); setScope(parsed.scope); setView('workspace'); setMode('read');
  }, []);

  const onNodeClick = (id) => {
    const n = findNode(tree, id);
    if (n && n.kind === 'folder') setTreeData((td) => ({ ...td, tree: toggleFolder(td.tree, id) }));
    else openNote(id);
  };

  const loadTree = React.useCallback(async (root) => {
    const td = await window.lore.readTree(root);
    if (td) { setTreeData(td); const f = firstNote(td.tree); if (f) openNote(f.id); }
  }, [openNote]);

  // boot: presets + default vault
  React.useEffect(() => {
    (async () => {
      try { const p = await window.lore.presets(); setPresets(p); setBackendOk(true); }
      catch { setBackendOk(false); }
      try { const def = await window.lore.defaultVault(); if (def) await loadTree(def); } catch { /* none */ }
      if (window.lore.onVaultChanged) window.lore.onVaultChanged(() => { if (treeData) loadTree(treeData.root); });
    })();
    return () => clearInterval(timer.current);
  }, []); // eslint-disable-line

  const openVault = async () => {
    const td = await window.lore.pickVault();
    if (td) { setTreeData(td); const f = firstNote(td.tree); if (f) openNote(f.id); else setNote(null); }
  };

  const onMode = async (m) => {
    if (mode === 'edit' && m === 'read' && activeId) {
      await window.lore.writeNote(activeId, draft);
      setNote(parseNote(draft, activeId));
    }
    setMode(m);
  };

  const ask = async (q) => {
    if (asking) return;
    setAskOpen(true); setAsking(true);
    setMessages((m) => [...m, { role: 'user', text: q }, { role: 'answer', shown: [], streaming: true }]);
    let trace;
    try { trace = await window.lore.ask(q, persona.scopes, tenant); }
    catch (e) {
      setMessages((m) => { const c = m.slice(); c[c.length - 1] = { role: 'answer', shown: [{ x: 'Couldn’t reach the index. Make sure the Lore backend is running on :8099.' }], streaming: false }; return c; });
      setAsking(false); return;
    }
    const words = String(trace.answer || 'No notes in your scope mention this yet.').split(/(\s+)/).filter(Boolean).map((w) => ({ x: w }));
    const evidence = evidenceFromTrace(trace);
    const sources = (trace.final || []).length;
    const scopesLabel = `across ${sources} chunks · ${(trace.scopes_asked || persona.scopes).join(', ')}`;
    let i = 0;
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      i += 2;
      setMessages((m) => {
        const c = m.slice(); const last = c[c.length - 1];
        if (!last || last.role !== 'answer') return m;
        const shown = words.slice(0, i);
        if (i >= words.length) { clearInterval(timer.current); c[c.length - 1] = { ...last, shown, streaming: false, sources, scopes: scopesLabel, evidence }; setAsking(false); }
        else c[c.length - 1] = { ...last, shown };
        return c;
      });
    }, 28);
  };

  const D = window.VaultDesignSystem_ffbf58;
  const Titlebar = window.LoreTitlebar, Rail = window.LoreActivityRail, Sidebar = window.LoreSidebar,
    Editor = window.LoreEditor, ContextPane = window.LoreContextPane, AskPanel = window.LoreAskPanel,
    ProjectsView = window.LoreProjectsView, GraphView = window.LoreGraphView,
    BucketsView = window.LoreBucketsView, SettingsView = window.LoreSettingsView;

  const editorNote = note && { ...note, raw: draft, onEdit: setDraft };
  const workspace = { name: treeData ? treeData.name : 'No vault', scope: 'team', indexedLabel: treeData ? `${treeData.indexed} notes` : 'open a vault' };

  const EmptyEditor = () => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, background: 'var(--surface-canvas)', color: 'var(--text-subtle)' }}>
      <D.Icon name="folder-open" size={34} style={{ color: 'var(--text-faint)' }} />
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, color: 'var(--text-body)' }}>Open a vault to start.</div>
      <D.Button variant="primary" icon="folder" onClick={openVault}>Open vault folder…</D.Button>
    </div>
  );

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface-sunken)' }}>
      <Titlebar theme={theme} onToggleTheme={() => setTheme((t) => t === 'dark' ? 'light' : 'dark')} onAsk={() => setAskOpen(true)} onSettings={() => setView('settings')} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Rail view={view} askOpen={askOpen} onView={(v) => setView(v === 'search' ? 'workspace' : v)} onAsk={() => setAskOpen((o) => !o)} />

        {view === 'workspace' && (
          <React.Fragment>
            <Sidebar tree={tree} activeNote={activeId} workspace={workspace} onOpen={onNodeClick} onToggle={(id) => setTreeData((td) => ({ ...td, tree: toggleFolder(td.tree, id) }))} />
            {editorNote
              ? <Editor note={editorNote} mode={mode} onMode={onMode} onOpen={() => {}} scope={scope} onScope={setScope} />
              : <EmptyEditor />}
            {askOpen
              ? <AskPanel messages={messages} asking={asking} suggestions={suggestions} onSend={ask} onClose={() => setAskOpen(false)} />
              : (editorNote && <ContextPane note={editorNote} onAsk={() => setAskOpen(true)} />)}
          </React.Fragment>
        )}

        {view === 'projects' && (
          <React.Fragment>
            <ProjectsView projects={M.projects} groups={M.groups} onOpen={() => setView('workspace')} />
            {askOpen && <AskPanel messages={messages} asking={asking} suggestions={suggestions} onSend={ask} onClose={() => setAskOpen(false)} />}
          </React.Fragment>
        )}

        {view === 'graph' && (
          <React.Fragment>
            <GraphView graph={M.graph} onOpen={() => setView('workspace')} />
            {askOpen && <AskPanel messages={messages} asking={asking} suggestions={suggestions} onSend={ask} onClose={() => setAskOpen(false)} />}
          </React.Fragment>
        )}

        {view === 'buckets' && (
          <React.Fragment>
            <BucketsView buckets={M.buckets} onAsk={() => setAskOpen(true)} />
            {askOpen && <AskPanel messages={messages} asking={asking} suggestions={suggestions} onSend={ask} onClose={() => setAskOpen(false)} />}
          </React.Fragment>
        )}

        {view === 'settings' && <SettingsView settings={M.settings} />}
      </div>

      {/* Wired status bar: vault picker + persona (drives Ask scopes) + backend status */}
      <div style={{ height: 'var(--statusbar-height)', display: 'flex', alignItems: 'center', gap: 14, padding: '0 12px', background: 'var(--surface-base)', borderTop: '1px solid var(--border-subtle)', flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>
        <button onClick={openVault} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--border)', background: 'var(--surface-inset)', color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          <D.Icon name="folder-open" size={12} />{treeData ? treeData.name : 'Open vault…'}
        </button>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <D.Icon name="circle-dot" size={12} style={{ color: backendOk ? 'var(--jade-400)' : 'var(--clay-400)' }} />
          {backendOk ? `${tenant} · backend ready` : 'backend offline (:8099)'}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <D.Icon name="user" size={12} />asking as
          <select value={personaIdx} onChange={(e) => setPersonaIdx(Number(e.target.value))}
            style={{ background: 'var(--surface-inset)', color: 'var(--text-strong)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '2px 6px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            {(presets && presets.personas ? presets.personas : [{ label: 'You' }]).map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
          </select>
        </span>
        <span>Markdown</span>
      </div>
    </div>
  );
}

window.LoreApp = App;
