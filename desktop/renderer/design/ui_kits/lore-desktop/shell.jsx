/* global React */
// Lore desktop — shell: titlebar, activity rail, sidebar, status bar
const NS = window.VaultDesignSystem_ffbf58;
const { Icon, IconButton, Tooltip, Avatar, FileTreeItem, ScopeTag, Input, Kbd, Badge } = NS;

const shellS = {
  titlebar: {
    height: 'var(--topbar-height)', display: 'flex', alignItems: 'center', gap: 10,
    padding: '0 12px', background: 'var(--surface-base)',
    borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, WebkitUserSelect: 'none',
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

function Titlebar({ theme, onToggleTheme, onAsk, onSettings }) {
  return (
    <div style={shellS.titlebar}>
      <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: 'var(--clay-400)' }} />
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: 'var(--amber-400)' }} />
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: 'var(--jade-400)' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
        <img src="design/assets/logo/logomark.svg" alt="Lore" style={{ width: 20, height: 20 }} />
        <span style={{ fontFamily: 'var(--font-serif)', fontSize: 15, fontWeight: 600, color: 'var(--text-strong)' }}>Lore</span>
        <Icon name="chevron-right" size={13} style={{ color: 'var(--text-faint)' }} />
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sales</span>
      </div>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, width: 360, height: 28, padding: '0 10px',
          background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
          color: 'var(--text-subtle)', fontSize: 13, cursor: 'text',
        }}>
          <Icon name="search" size={14} />
          <span style={{ flex: 1 }}>Search or jump to…</span>
          <Kbd>⌘K</Kbd>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <Tooltip label="Ask Lore" kbd="⌘↵" side="bottom"><IconButton icon="sparkles" label="Ask Lore" onClick={onAsk} /></Tooltip>
        <Tooltip label={theme === 'dark' ? 'Paper theme' : 'Workbench theme'} side="bottom">
          <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label="Toggle theme" onClick={onToggleTheme} />
        </Tooltip>
        <IconButton icon="settings" label="Settings" onClick={onSettings} />
        <Avatar name="Alice Ng" size={24} scope="team" style={{ marginLeft: 4 }} />
      </div>
    </div>
  );
}

function ActivityRail({ view, askOpen, onView, onAsk }) {
  const items = [
    { id: 'workspace', icon: 'files', label: 'Files' },
    { id: 'search', icon: 'search', label: 'Search' },
    { id: 'graph', icon: 'network', label: 'Graph' },
    { id: 'projects', icon: 'layout-grid', label: 'Projects' },
    { id: 'buckets', icon: 'library', label: 'Buckets' },
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

function Sidebar({ tree, activeNote, onOpen, onToggle, workspace }) {
  return (
    <div style={shellS.sidebar}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--divider)' }}>
        <Icon name="folder-open" size={16} style={{ color: 'var(--brand-fg)' }} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>{workspace.name}</span>
        <ScopeTag scope={workspace.scope} size="sm" showLabel={false} />
        <IconButton icon="plus" label="New note" size="sm" />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
        {tree.map((n) => (
          <TreeNode key={n.id} node={n} activeNote={activeNote} onOpen={onOpen} onToggle={onToggle} />
        ))}
      </div>
      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--divider)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--jade-400)', animation: 'lore-pulse 2.4s var(--ease-out) infinite' }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>{workspace.indexedLabel || 'indexed'}</span>
      </div>
    </div>
  );
}

function StatusBar() {
  return (
    <div style={shellS.status}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="circle-dot" size={12} style={{ color: 'var(--jade-400)' }} />indexed · recall@20</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="git-fork" size={12} />7 links</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="users" size={12} />team</span>
      <div style={{ flex: 1 }} />
      <span>234 words</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="refresh-cw" size={12} />synced</span>
      <span>Markdown</span>
    </div>
  );
}

Object.assign(window, { LoreTitlebar: Titlebar, LoreActivityRail: ActivityRail, LoreSidebar: Sidebar, LoreStatusBar: StatusBar });
