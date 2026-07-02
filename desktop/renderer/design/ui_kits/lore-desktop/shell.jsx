/* global React */
// Lore desktop — shell: titlebar, activity rail, sidebar, status bar
const NS = window.VaultDesignSystem_ffbf58;
const { Icon, IconButton, Tooltip, FileTreeItem, ScopeTag, Input, Kbd, Badge } = NS;

const shellS = {
  titlebar: {
    height: 'var(--topbar-height)', display: 'flex', alignItems: 'center', gap: 10,
    padding: '0 12px', background: 'var(--surface-base)',
    borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, WebkitUserSelect: 'none',
    WebkitAppRegion: 'drag',
  },
  rail: {
    width: 'var(--rail-width)', flexShrink: 0, background: 'var(--surface-base)',
    borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column',
    alignItems: 'center', padding: '10px 0', gap: 4,
  },
  sidebar: {
    width: 'var(--sidebar-width)', flexShrink: 0, background: 'var(--surface-panel)',
    borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column',
  },
  status: {
    height: 'var(--statusbar-height)', display: 'flex', alignItems: 'center', gap: 14,
    padding: '0 12px', background: 'var(--surface-base)',
    borderTop: '1px solid var(--border-subtle)', flexShrink: 0,
    fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)',
  },
};
const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

// Reusable "?" help hint with an instant custom tooltip (native title is unreliable in Electron).
// Registered on window so other ui-kit files (buckets/projects) can reuse it.
function HelpHint({ tip, size = 14 }) {
  const [show, setShow] = React.useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, borderRadius: '50%', border: '1px solid var(--border-strong)', color: 'var(--text-faint)', fontSize: Math.round(size * 0.62), fontWeight: 700, cursor: 'help' }}>?</span>
      {show && (
        <span style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, width: 240, padding: '9px 11px', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-lg)', color: 'var(--text-body)', fontFamily: 'var(--font-sans)', fontSize: 11.5, fontWeight: 400, lineHeight: 1.5, whiteSpace: 'normal', zIndex: 200, pointerEvents: 'none' }}>{tip}</span>
      )}
    </span>
  );
}
window.LoreHelpHint = HelpHint;

function SH_scopeColor(scope) {
  if (scope === 'team') return 'var(--jade-500)';
  if (scope === 'enterprise') return 'var(--azure-500)';
  if (scope === 'private') return 'var(--obsidian-400)';
  return 'var(--brand-fg)';
}

function SH_scopeIcon(scope) {
  if (scope === 'team') return 'users';
  if (scope === 'enterprise') return 'building-2';
  if (scope === 'private') return 'lock';
  return 'tag';
}

function SH_scopeLabel(scope) {
  return scope ? String(scope) : 'none';
}

function SH_collectScopes(nodes, out = []) {
  for (const n of nodes || []) {
    if (n.scope) out.push(n.scope);
    if (n.children) SH_collectScopes(n.children, out);
  }
  return out;
}

function SH_uniqScopes(values) {
  const out = [], seen = new Set();
  for (const raw of values || []) {
    const s = raw == null ? '' : String(raw).trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(s); }
  }
  return out;
}

// Top-bar scope filter — "All / Private / Team / Plugins". Applied by the caller (wired-app)
// to BOTH the file tree and the graph; this component only renders the pill control.
const SCOPE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'private', label: 'Private' },
  { id: 'team', label: 'Team' },
  { id: 'plugins', label: 'Plugins' },
];

function ScopeFilterBar({ value, onChange }) {
  const active = value || 'all';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 2, background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-full)', WebkitAppRegion: 'no-drag' }}>
      {SCOPE_FILTERS.map((f) => {
        const isActive = active === f.id;
        return (
          <button key={f.id} onClick={() => onChange(f.id)} title={`Show ${f.label.toLowerCase()} notes`} style={{
            border: 'none', padding: '4px 10px', borderRadius: 'var(--radius-full)', cursor: 'pointer',
            background: isActive ? 'var(--surface-raised)' : 'transparent',
            color: isActive ? 'var(--brand-fg)' : 'var(--text-muted)',
            fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: isActive ? 600 : 400, whiteSpace: 'nowrap',
          }}>{f.label}</button>
        );
      })}
    </div>
  );
}

function Titlebar({ theme, onToggleTheme, onSearch, onAsk, onSettings, onProfile, onImport, scopeFilter, onScopeFilter }) {
  return (
    <div style={shellS.titlebar}>
      {isMac && <div style={{ width: 72, flexShrink: 0 }} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <img src="design/assets/logo/logomark.svg" alt="Lore" draggable={false} style={{ width: 20, height: 20 }} />
        <span style={{ fontFamily: 'var(--font-serif)', fontSize: 15, fontWeight: 600, color: 'var(--text-strong)' }}>Lore</span>
      </div>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        <button onClick={onSearch} aria-label="Search or jump to a note" style={{
          display: 'flex', alignItems: 'center', gap: 8, width: 360, height: 28, padding: '0 10px',
          background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
          color: 'var(--text-subtle)', fontSize: 13, cursor: 'pointer', WebkitAppRegion: 'no-drag', fontFamily: 'var(--font-sans)',
        }}>
          <Icon name="search" size={14} />
          <span style={{ flex: 1 }}>Search or jump to…</span>
          <Kbd>⌘K</Kbd>
        </button>
      </div>
      {onScopeFilter && <ScopeFilterBar value={scopeFilter} onChange={onScopeFilter} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, WebkitAppRegion: 'no-drag' }}>
        <button onClick={onImport} title="Import files, folders, or a .zip — drop anywhere too" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 11px', marginRight: 4, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-inset)', color: 'var(--text-body)', fontFamily: 'var(--font-sans)', fontSize: 12.5, cursor: 'pointer' }}>
          <Icon name="upload" size={14} />Import
        </button>
        <Tooltip label="Ask Lore" kbd="⌘↵" side="bottom"><IconButton icon="sparkles" label="Ask Lore" onClick={onAsk} /></Tooltip>
        <Tooltip label={theme === 'dark' ? 'Paper theme' : 'Workbench theme'} side="bottom">
          <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label="Toggle theme" onClick={onToggleTheme} />
        </Tooltip>
        <IconButton icon="settings" label="Settings" onClick={onSettings} />
        <IconButton icon="user" label="Account" onClick={onProfile} />
      </div>
    </div>
  );
}

function ActivityRail({ view, askOpen, onView, onAsk }) {
  const items = [
    { id: 'workspace', icon: 'files', label: 'Files' },
    { id: 'search', icon: 'search', label: 'Search' },
    { id: 'graph', icon: 'network', label: 'Graph' },
    { id: 'projects', icon: 'layout-grid', label: 'Sagas' },
    { id: 'buckets', icon: 'library', label: 'Wizards' },
    { id: 'hooks', icon: 'plug', label: 'Hooks' },
  ];
  return (
    <div style={shellS.rail}>
      {items.map((it) => (
        <Tooltip key={it.id} label={it.label} side="right">
          <IconButton icon={it.icon} label={it.label} size="lg" active={view === it.id}
            onClick={() => onView(it.id)} />
        </Tooltip>
      ))}
      <div style={{ height: 1, width: 26, background: 'var(--divider)', margin: '6px 0' }} />
      <Tooltip label="Ask Lore" side="right">
        <IconButton icon="sparkles" label="Ask" size="lg" variant={askOpen ? 'primary' : 'ghost'} onClick={onAsk} />
      </Tooltip>
      <div style={{ flex: 1 }} />
      <Tooltip label="Groups" side="right"><IconButton icon="users" label="Groups" size="lg" onClick={() => onView('projects')} /></Tooltip>
      <Tooltip label="Settings" side="right"><IconButton icon="settings" label="Settings" size="lg" active={view === 'settings'} onClick={() => onView('settings')} /></Tooltip>
    </div>
  );
}

// VS Code-style file tree row — replaces FileTreeItem for tighter, denser layout.
const TREE_INDENT = 12; // px per depth level
function TreeNode({ node, activeNote, onOpen, onToggle, renamingId, onContextMenu, onRenameCommit, onRenameCancel }) {
  const [hover, setHover] = React.useState(false);
  const isFolder = node.kind === 'folder';
  const isActive = node.kind === 'note' && node.id === activeNote;
  const depth = node.depth || 0;
  const isRenaming = renamingId === node.id;
  const [renameValue, setRenameValue] = React.useState(node.name);
  const commitGuard = React.useRef(false);
  React.useEffect(() => {
    if (isRenaming) { setRenameValue(node.name); commitGuard.current = false; }
  }, [isRenaming, node.name]);

  return (
    <React.Fragment>
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => { if (isRenaming) return; isFolder ? onToggle(node.id) : onOpen(node.id); }}
        onContextMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); if (onContextMenu) onContextMenu(node); }}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          height: 22,
          paddingRight: 6,
          paddingLeft: depth * TREE_INDENT + 6,
          cursor: 'pointer',
          background: isActive ? 'var(--surface-selected)' : hover ? 'var(--surface-hover)' : 'transparent',
          transition: 'background 0.08s ease',
          userSelect: 'none',
        }}
      >
        {/* Indent guides: one faint vertical line per ancestor level */}
        {Array.from({ length: depth }).map((_, i) => (
          <span key={i} style={{
            position: 'absolute',
            left: i * TREE_INDENT + Math.floor(TREE_INDENT / 2),
            top: 0,
            bottom: 0,
            width: 1,
            background: 'rgba(255,255,255,0.07)',
            pointerEvents: 'none',
          }} />
        ))}
        {/* Chevron (folders) or blank spacer (files) to keep icon columns aligned */}
        {isFolder ? (
          <Icon name="chevron-right" size={11} style={{
            color: 'var(--text-faint)',
            transform: node.open ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.12s ease',
            flexShrink: 0,
          }} />
        ) : (
          <span style={{ width: 11, flexShrink: 0 }} />
        )}
        {/* Folder / file icon */}
        <Icon
          name={isFolder ? (node.open ? 'folder-open' : 'folder') : 'file-text'}
          size={13}
          style={{
            color: isActive ? 'var(--brand-fg)' : isFolder ? 'var(--text-subtle)' : node.scope ? SH_scopeColor(node.scope) : 'var(--text-faint)',
            flexShrink: 0,
          }}
        />
        {/* Label — becomes an inline editable input while renaming (VS Code style) */}
        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onClick={(ev) => ev.stopPropagation()}
            onChange={(ev) => setRenameValue(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') { ev.preventDefault(); commitGuard.current = true; onRenameCommit(node, renameValue); }
              else if (ev.key === 'Escape') { ev.preventDefault(); commitGuard.current = true; onRenameCancel(node); }
            }}
            onBlur={() => { if (!commitGuard.current) onRenameCommit(node, renameValue); }}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12.5,
              lineHeight: 1,
              color: 'var(--text-strong)',
              fontFamily: 'inherit',
              letterSpacing: '0.01em',
              background: 'var(--surface-inset)',
              border: '1px solid var(--brand-fg)',
              borderRadius: 3,
              padding: '1px 4px',
              outline: 'none',
            }}
          />
        ) : (
          <span style={{
            flex: 1,
            fontSize: 12.5,
            lineHeight: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: isActive ? 'var(--text-strong)' : 'var(--text-body)',
            fontWeight: isActive ? 600 : 400,
            letterSpacing: '0.01em',
          }}>
            {node.name}
          </span>
        )}
        {/* Right-side indicators: scope icons */}
        {node.scope === 'private' && <Icon name="lock" size={10} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />}
        {node.scope === 'team' && <Icon name="users" size={10} style={{ color: 'var(--scope-team-fg)', flexShrink: 0 }} />}
        {node.scope === 'enterprise' && <Icon name="building-2" size={10} style={{ color: 'var(--scope-ent-fg)', flexShrink: 0 }} />}
      </div>
      {isFolder && node.open && node.children && node.children.map((c) => (
        <TreeNode key={c.id} node={c} activeNote={activeNote} onOpen={onOpen} onToggle={onToggle}
          renamingId={renamingId} onContextMenu={onContextMenu} onRenameCommit={onRenameCommit} onRenameCancel={onRenameCancel} />
      ))}
    </React.Fragment>
  );
}

function SH_baseName(p) {
  return String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || '');
}

function Sidebar({ tree, activeNote, onOpen, onToggle, workspace, bases, baseScopes, kbFilter, onToggleBase, onClearBases, wizard, onCreateNote, renamingId, onTreeContextMenu, onRenameCommit, onRenameCancel, roots, activeRoot, onSwitchRoot }) {
  const legendScopes = SH_uniqScopes([workspace.scope, ...Object.values(baseScopes || {}), ...SH_collectScopes(tree)]);
  // Library up/down switcher — only shown with more than one configured library (root folder).
  const showLibrarySwitcher = Array.isArray(roots) && roots.length > 1 && typeof onSwitchRoot === 'function';
  let prevLibraryName = '', nextLibraryName = '';
  if (showLibrarySwitcher) {
    const idx = Math.max(0, roots.indexOf(activeRoot));
    prevLibraryName = SH_baseName(roots[(idx - 1 + roots.length) % roots.length]);
    nextLibraryName = SH_baseName(roots[(idx + 1) % roots.length]);
  }

  // "Add group" inline form state — hooks must run before any early return.
  const [grpInput, setGrpInput] = React.useState(false);
  const [grpName, setGrpName] = React.useState('');
  const [grpStatus, setGrpStatus] = React.useState('');

  const handleAddGroup = async () => {
    const name = grpName.trim();
    if (!name) return;
    setGrpStatus('Creating…');
    try {
      const cfg = window.lore && window.lore.config && await window.lore.config.get();
      const root = (cfg && Array.isArray(cfg.roots) && cfg.roots[0]) || null;
      if (!root) { setGrpStatus('Open a library first.'); return; }
      const sep = root.includes('/') ? '/' : '\\';
      const path = root.replace(/[\\/]+$/, '') + sep + name + sep + '_index.md';
      const res = await window.lore.writeNote(path, '---\ntype: group\n---\n\n# ' + name + '\n\n');
      if (!res || res.ok === false) { setGrpStatus('Error: ' + ((res && res.error) || 'could not create group')); return; }
      setGrpName(''); setGrpInput(false); setGrpStatus('');
      // vault:changed is already wired in wired-app.jsx → auto-refreshes tree + bases chips
    } catch (e) { setGrpStatus('Error: ' + ((e && e.message) || String(e))); }
  };

  // While viewing a Wizard, the sidebar shows the Wizard — NOT your personal files (scope isolation).
  if (wizard) {
    return (
      <div style={shellS.sidebar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--divider)' }}>
          <Icon name="library" size={16} style={{ color: 'var(--brand-fg)' }} />
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wizard.name}</span>
          {wizard.scope && <ScopeTag scope={wizard.scope} size="sm" showLabel={false} />}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {wizard.desc && <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', lineHeight: 1.5 }}>{wizard.desc}</div>}
          {wizard.topics && wizard.topics.length > 0 && (
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Topics</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{wizard.topics.map((t) => <Badge key={t} tone="info">#{t}</Badge>)}</div>
            </div>
          )}
          {wizard.contributors && wizard.contributors.length > 0 && (
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Contributors</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{wizard.contributors.map((m) => <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar name={m} size={20} /><span style={{ fontSize: 12.5, color: 'var(--text-body)' }}>{m}</span></div>)}</div>
            </div>
          )}
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>{wizard.notes} notes{wizard.recall != null ? ` · recall ${wizard.recall}` : ''}</div>
        </div>
        <div style={{ padding: '9px 12px', borderTop: '1px solid var(--divider)', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Icon name="eye-off" size={12} style={{ color: 'var(--text-faint)' }} />
          <span style={{ fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.4 }}>Your personal library is hidden while viewing a Wizard.</span>
        </div>
      </div>
    );
  }
  const kbChip = (active, scope) => {
    const c = scope ? SH_scopeColor(scope) : null;
    return {
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 9px', borderRadius: 'var(--radius-full)', cursor: 'pointer',
      border: `1px solid ${active ? (c || 'var(--brand-soft-border)') : 'var(--border)'}`,
      background: active ? 'var(--surface-raised)' : 'var(--surface-inset)',
      color: active ? (c || 'var(--brand-fg)') : 'var(--text-muted)',
      fontFamily: 'var(--font-mono)', fontSize: 10.5, whiteSpace: 'nowrap',
    };
  };
  const allActive = !kbFilter || kbFilter.length === 0;
  return (
    <div style={shellS.sidebar}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--divider)' }}>
        <Icon name="folder-open" size={16} style={{ color: 'var(--brand-fg)' }} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>{workspace.name}</span>
        {workspace.scope && <ScopeTag scope={workspace.scope} size="sm" showLabel={false} />}
        {showLibrarySwitcher && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconButton icon="chevron-up" label={`Previous library — ${prevLibraryName}`} size="sm" onClick={() => onSwitchRoot(-1)} />
            <IconButton icon="chevron-down" label={`Next library — ${nextLibraryName}`} size="sm" onClick={() => onSwitchRoot(1)} />
          </div>
        )}
        <IconButton icon="plus" label="New note" size="sm" onClick={onCreateNote} />
      </div>
      <div style={{ borderBottom: '1px solid var(--divider)', padding: '7px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <Icon name="layers" size={11} style={{ color: 'var(--text-faint)' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Sections {allActive ? '· all' : `· ${kbFilter.length} selected`}</span>
            <HelpHint size={13} tip="Switch to one base, or click several to combine them. Filters the file tree AND the knowledge graph." />
            <button onClick={() => { setGrpInput(true); setGrpName(''); setGrpStatus(''); }} title="Add a section"
              style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-inset)', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 14, lineHeight: 1, flexShrink: 0 }}>+</button>
          </div>
          {grpInput && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <input autoFocus value={grpName} onChange={(e) => setGrpName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddGroup(); if (e.key === 'Escape') setGrpInput(false); }}
                placeholder="Group name…"
                style={{ flex: 1, padding: '4px 8px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-inset)', color: 'var(--text-strong)', fontFamily: 'var(--font-sans)', fontSize: 12, outline: 'none' }} />
              <button onClick={handleAddGroup} style={{ padding: '4px 9px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', background: 'var(--brand-soft-bg)', color: 'var(--brand-fg)', fontFamily: 'var(--font-sans)', fontSize: 11, cursor: 'pointer' }}>Add</button>
              <button onClick={() => setGrpInput(false)} style={{ padding: '4px 9px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-faint)', fontFamily: 'var(--font-sans)', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
            </div>
          )}
          {grpStatus && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--clay-400)', marginBottom: 4 }}>{grpStatus}</div>}
          {bases && bases.length > 0 && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              <button onClick={onClearBases} style={{ ...kbChip(allActive), borderColor: allActive ? 'var(--jade-500)' : 'var(--border)', background: allActive ? 'var(--surface-raised)' : 'var(--surface-inset)', color: allActive ? 'var(--jade-400)' : 'var(--text-muted)', fontWeight: 600 }}>All</button>
              {bases.map((b) => {
                const sc = baseScopes && baseScopes[b];
                return (
                  <button key={b} onClick={() => onToggleBase(b)} style={kbChip(kbFilter && kbFilter.includes(b), sc)}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: sc ? SH_scopeColor(sc) : 'var(--text-faint)', flexShrink: 0 }} />{b}
                  </button>
                );
              })}
            </div>
          )}
          {(!bases || bases.length === 0) && !grpInput && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', padding: '2px 0' }}>No groups yet — click + to add one.</div>
          )}
        </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {tree.length === 0 ? (
          <div style={{ padding: '18px 14px', fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.5 }}>
            No notes match the current filter.
          </div>
        ) : tree.map((n) => (
          <TreeNode key={n.id} node={n} activeNote={activeNote} onOpen={onOpen} onToggle={onToggle}
            renamingId={renamingId} onContextMenu={onTreeContextMenu} onRenameCommit={onRenameCommit} onRenameCancel={onRenameCancel} />
        ))}
      </div>
      <div style={{ padding: '9px 12px', borderTop: '1px solid var(--divider)', display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Scope legend</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 12px' }}>
          {legendScopes.length ? legendScopes.map((sc) => (
            <span key={sc} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
              <Icon name={SH_scopeIcon(sc)} size={11} style={{ color: SH_scopeColor(sc) }} />{SH_scopeLabel(sc)}
            </span>
          )) : (
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>No scope configured</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderTop: '1px solid var(--divider)', paddingTop: 6 }}>
          <Icon name="file-text" size={11} style={{ color: 'var(--text-faint)' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}>{workspace.indexedLabel ? `${workspace.indexedLabel} on disk` : 'no library'}</span>
        </div>
      </div>
    </div>
  );
}

function StatusBar() {
  return (
    <div style={shellS.status}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="circle-dot" size={12} />status unavailable</span>
      <div style={{ flex: 1 }} />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="refresh-cw" size={12} />not synced</span>
      <span>Markdown</span>
    </div>
  );
}

Object.assign(window, { LoreTitlebar: Titlebar, LoreActivityRail: ActivityRail, LoreSidebar: Sidebar, LoreStatusBar: StatusBar });
