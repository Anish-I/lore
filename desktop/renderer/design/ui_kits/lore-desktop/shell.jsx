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

function Titlebar({ theme, onToggleTheme, onSearch, onAsk, onSettings, onProfile, onImport }) {
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

function TreeNode({ node, activeNote, onOpen, onToggle }) {
  return (
    <React.Fragment>
      <FileTreeItem
        name={node.name} kind={node.kind} depth={node.depth} open={node.open}
        active={node.kind === 'note' && node.id === activeNote}
        scope={node.scope} indexed={node.indexed}
        onClick={() => node.kind === 'folder' ? onToggle(node.id) : onOpen(node.id)}
      />
      {node.kind === 'folder' && node.open && node.children &&
        node.children.map((c) => (
          <TreeNode key={c.id} node={c} activeNote={activeNote} onOpen={onOpen} onToggle={onToggle} />
        ))}
    </React.Fragment>
  );
}

function Sidebar({ tree, activeNote, onOpen, onToggle, workspace, bases, baseScopes, kbFilter, onToggleBase, onClearBases, wizard, onCreateNote }) {
  const legendScopes = SH_uniqScopes([workspace.scope, ...Object.values(baseScopes || {}), ...SH_collectScopes(tree)]);
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
        <IconButton icon="plus" label="New note" size="sm" onClick={onCreateNote} />
      </div>
      {bases && bases.length > 0 && (
        <div style={{ borderBottom: '1px solid var(--divider)', padding: '7px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <Icon name="layers" size={11} style={{ color: 'var(--text-faint)' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Knowledge bases {allActive ? '· all' : `· ${kbFilter.length} selected`}</span>
            <HelpHint size={13} tip="Switch to one base, or click several to combine them. Filters the file tree AND the knowledge graph." />
          </div>
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
        </div>
      )}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
        {tree.map((n) => (
          <TreeNode key={n.id} node={n} activeNote={activeNote} onOpen={onOpen} onToggle={onToggle} />
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
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--jade-400)', animation: 'lore-pulse 2.4s var(--ease-out) infinite' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}>green dot = indexed · {workspace.indexedLabel || 'indexed'}</span>
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
