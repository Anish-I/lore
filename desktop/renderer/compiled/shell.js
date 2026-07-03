/* global React */
// Lore desktop — shell: titlebar, activity rail, sidebar, status bar
const NS = window.VaultDesignSystem_ffbf58;
const { Icon, IconButton, Tooltip, FileTreeItem, ScopeTag, Input, Kbd, Badge } = NS;

const shellS = {
  titlebar: {
    height: 'var(--topbar-height)', display: 'flex', alignItems: 'center', gap: 10,
    padding: '0 12px', background: 'var(--surface-base)',
    borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, WebkitUserSelect: 'none',
    WebkitAppRegion: 'drag'
  },
  rail: {
    width: 'var(--rail-width)', flexShrink: 0, background: 'var(--surface-base)',
    borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column',
    alignItems: 'center', padding: '10px 0', gap: 4
  },
  sidebar: {
    width: 'var(--sidebar-width)', flexShrink: 0, background: 'var(--surface-panel)',
    borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column'
  },
  status: {
    height: 'var(--statusbar-height)', display: 'flex', alignItems: 'center', gap: 14,
    padding: '0 12px', background: 'var(--surface-base)',
    borderTop: '1px solid var(--border-subtle)', flexShrink: 0,
    fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)'
  }
};
const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

// Reusable "?" help hint with an instant custom tooltip (native title is unreliable in Electron).
// Registered on window so other ui-kit files (buckets/projects) can reuse it.
function HelpHint({ tip, size = 14 }) {
  const [show, setShow] = React.useState(false);
  return (/*#__PURE__*/
    React.createElement("span", { style: { position: 'relative', display: 'inline-flex', verticalAlign: 'middle' },
      onMouseEnter: () => setShow(true), onMouseLeave: () => setShow(false) }, /*#__PURE__*/
    React.createElement("span", { style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, borderRadius: '50%', border: '1px solid var(--border-strong)', color: 'var(--text-faint)', fontSize: Math.round(size * 0.62), fontWeight: 700, cursor: 'help' } }, "?"),
    show && /*#__PURE__*/
    React.createElement("span", { style: { position: 'absolute', top: 'calc(100% + 6px)', left: 0, width: 240, padding: '9px 11px', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-lg)', color: 'var(--text-body)', fontFamily: 'var(--font-sans)', fontSize: 11.5, fontWeight: 400, lineHeight: 1.5, whiteSpace: 'normal', zIndex: 200, pointerEvents: 'none' } }, tip)

    ));

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
  const out = [],seen = new Set();
  for (const raw of values || []) {
    const s = raw == null ? '' : String(raw).trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (!seen.has(key)) {seen.add(key);out.push(s);}
  }
  return out;
}

// Top-bar scope filter — "All / Private / Team / Plugins". Applied by the caller (wired-app)
// to BOTH the file tree and the graph; this component only renders the pill control.
const SCOPE_FILTERS = [
{ id: 'all', label: 'All' },
{ id: 'private', label: 'Private' },
{ id: 'team', label: 'Team' },
{ id: 'plugins', label: 'Plugins' }];


function ScopeFilterBar({ value, onChange }) {
  const active = value || 'all';
  return (/*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 2, padding: 2, background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-full)', WebkitAppRegion: 'no-drag' } },
    SCOPE_FILTERS.map((f) => {
      const isActive = active === f.id;
      return (/*#__PURE__*/
        React.createElement("button", { key: f.id, onClick: () => onChange(f.id), title: `Show ${f.label.toLowerCase()} notes`, style: {
            border: 'none', padding: '4px 10px', borderRadius: 'var(--radius-full)', cursor: 'pointer',
            background: isActive ? 'var(--surface-raised)' : 'transparent',
            color: isActive ? 'var(--brand-fg)' : 'var(--text-muted)',
            fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: isActive ? 600 : 400, whiteSpace: 'nowrap'
          } }, f.label));

    })
    ));

}

function Titlebar({ theme, onToggleTheme, onSearch, onAsk, onSettings, onProfile, onImport, scopeFilter, onScopeFilter }) {
  return (/*#__PURE__*/
    React.createElement("div", { style: shellS.titlebar },
    isMac && /*#__PURE__*/React.createElement("div", { style: { width: 72, flexShrink: 0 } }), /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8 } }, /*#__PURE__*/
    React.createElement("img", { src: "design/assets/logo/logomark.svg", alt: "Lore", draggable: false, style: { width: 20, height: 20 } }), /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-serif)', fontSize: 15, fontWeight: 600, color: 'var(--text-strong)' } }, "Lore")
    ), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1, display: 'flex', justifyContent: 'center' } }, /*#__PURE__*/
    React.createElement("button", { onClick: onSearch, "aria-label": "Search or jump to a note", style: {
        display: 'flex', alignItems: 'center', gap: 8, width: 360, height: 28, padding: '0 10px',
        background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
        color: 'var(--text-subtle)', fontSize: 13, cursor: 'pointer', WebkitAppRegion: 'no-drag', fontFamily: 'var(--font-sans)'
      } }, /*#__PURE__*/
    React.createElement(Icon, { name: "search", size: 14 }), /*#__PURE__*/
    React.createElement("span", { style: { flex: 1 } }, "Search or jump to\u2026"), /*#__PURE__*/
    React.createElement(Kbd, null, "\u2318K")
    )
    ),
    onScopeFilter && /*#__PURE__*/React.createElement(ScopeFilterBar, { value: scopeFilter, onChange: onScopeFilter }), /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 4, WebkitAppRegion: 'no-drag' } }, /*#__PURE__*/
    React.createElement("button", { onClick: onImport, title: "Import files, folders, or a .zip \u2014 drop anywhere too", style: { display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 11px', marginRight: 4, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-inset)', color: 'var(--text-body)', fontFamily: 'var(--font-sans)', fontSize: 12.5, cursor: 'pointer' } }, /*#__PURE__*/
    React.createElement(Icon, { name: "upload", size: 14 }), "Import"
    ), /*#__PURE__*/
    React.createElement(Tooltip, { label: "Ask Lore", kbd: "\u2318\u21B5", side: "bottom" }, /*#__PURE__*/React.createElement(IconButton, { icon: "sparkles", label: "Ask Lore", onClick: onAsk })), /*#__PURE__*/
    React.createElement(Tooltip, { label: theme === 'dark' ? 'Paper theme' : 'Workbench theme', side: "bottom" }, /*#__PURE__*/
    React.createElement(IconButton, { icon: theme === 'dark' ? 'sun' : 'moon', label: "Toggle theme", onClick: onToggleTheme })
    ), /*#__PURE__*/
    React.createElement(IconButton, { icon: "settings", label: "Settings", onClick: onSettings }), /*#__PURE__*/
    React.createElement(IconButton, { icon: "user", label: "Account", onClick: onProfile })
    )
    ));

}

function ActivityRail({ view, askOpen, onView, onAsk }) {
  const items = [
  { id: 'workspace', icon: 'files', label: 'Files' },
  { id: 'search', icon: 'search', label: 'Search' },
  { id: 'graph', icon: 'network', label: 'Graph' },
  { id: 'projects', icon: 'users', label: 'Teams' },
  { id: 'buckets', icon: 'library', label: 'Wizards' },
  { id: 'hooks', icon: 'plug', label: 'Hooks' }];

  return (/*#__PURE__*/
    React.createElement("div", { style: shellS.rail },
    items.map((it) => /*#__PURE__*/
    React.createElement(Tooltip, { key: it.id, label: it.label, side: "right" }, /*#__PURE__*/
    React.createElement(IconButton, { icon: it.icon, label: it.label, size: "lg", active: view === it.id,
      onClick: () => onView(it.id) })
    )
    ), /*#__PURE__*/
    React.createElement("div", { style: { height: 1, width: 26, background: 'var(--divider)', margin: '6px 0' } }), /*#__PURE__*/
    React.createElement(Tooltip, { label: "Ask Lore", side: "right" }, /*#__PURE__*/
    React.createElement(IconButton, { icon: "sparkles", label: "Ask", size: "lg", variant: askOpen ? 'primary' : 'ghost', onClick: onAsk })
    ), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1 } }), /*#__PURE__*/
    React.createElement(Tooltip, { label: "Settings", side: "right" }, /*#__PURE__*/React.createElement(IconButton, { icon: "settings", label: "Settings", size: "lg", active: view === 'settings', onClick: () => onView('settings') }))
    ));

}

// VS Code-style file tree row — replaces FileTreeItem for tighter, denser layout.
const TREE_INDENT = 12; // px per depth level
// sectionName: the top-level ancestor folder's name (a node IS its own section
// at depth 0; children inherit it unchanged) — used to color-match the folder
// icon to the same Section color used in the knowledge graph.
function TreeNode({ node, activeNote, onOpen, onToggle, renamingId, onContextMenu, onRenameCommit, onRenameCancel, sectionName, theme }) {
  const [hover, setHover] = React.useState(false);
  const isFolder = node.kind === 'folder';
  const isActive = node.kind === 'note' && node.id === activeNote;
  const depth = node.depth || 0;
  const isRenaming = renamingId === node.id;
  const [renameValue, setRenameValue] = React.useState(node.name);
  const commitGuard = React.useRef(false);
  React.useEffect(() => {
    if (isRenaming) {setRenameValue(node.name);commitGuard.current = false;}
  }, [isRenaming, node.name]);

  return (/*#__PURE__*/
    React.createElement(React.Fragment, null, /*#__PURE__*/
    React.createElement("div", {
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      onClick: () => {if (isRenaming) return;isFolder ? onToggle(node.id) : onOpen(node.id);},
      onContextMenu: (ev) => {ev.preventDefault();ev.stopPropagation();if (onContextMenu) onContextMenu(node);},
      style: {
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
        userSelect: 'none'
      } },


    Array.from({ length: depth }).map((_, i) => /*#__PURE__*/
    React.createElement("span", { key: i, style: {
        position: 'absolute',
        left: i * TREE_INDENT + Math.floor(TREE_INDENT / 2),
        top: 0,
        bottom: 0,
        width: 1,
        background: 'rgba(255,255,255,0.07)',
        pointerEvents: 'none'
      } })
    ),

    isFolder ? /*#__PURE__*/
    React.createElement(Icon, { name: "chevron-right", size: 11, style: {
        color: 'var(--text-faint)',
        transform: node.open ? 'rotate(90deg)' : 'none',
        transition: 'transform 0.12s ease',
        flexShrink: 0
      } }) : /*#__PURE__*/

    React.createElement("span", { style: { width: 11, flexShrink: 0 } }), /*#__PURE__*/




    React.createElement(Icon, {
      name: isFolder ? node.open ? 'folder-open' : 'folder' : 'file-text',
      size: 13,
      style: {
        color: isActive ? 'var(--brand-fg)' :
        isFolder ? sectionName && window.LoreSectionColor(sectionName, theme) || 'var(--text-subtle)' :
        node.scope ? SH_scopeColor(node.scope) : 'var(--text-faint)',
        flexShrink: 0
      } }
    ),

    isRenaming ? /*#__PURE__*/
    React.createElement("input", {
      autoFocus: true,
      value: renameValue,
      onClick: (ev) => ev.stopPropagation(),
      onChange: (ev) => setRenameValue(ev.target.value),
      onKeyDown: (ev) => {
        if (ev.key === 'Enter') {ev.preventDefault();commitGuard.current = true;onRenameCommit(node, renameValue);} else
        if (ev.key === 'Escape') {ev.preventDefault();commitGuard.current = true;onRenameCancel(node);}
      },
      onBlur: () => {if (!commitGuard.current) onRenameCommit(node, renameValue);},
      style: {
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
        outline: 'none'
      } }
    ) : /*#__PURE__*/

    React.createElement("span", { style: {
        flex: 1,
        fontSize: 12.5,
        lineHeight: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: isActive ? 'var(--text-strong)' : 'var(--text-body)',
        fontWeight: isActive ? 600 : 400,
        letterSpacing: '0.01em'
      } },
    node.name
    ),


    node.scope === 'private' && /*#__PURE__*/React.createElement(Icon, { name: "lock", size: 10, style: { color: 'var(--text-faint)', flexShrink: 0 } }),
    node.scope === 'team' && /*#__PURE__*/React.createElement(Icon, { name: "users", size: 10, style: { color: 'var(--scope-team-fg)', flexShrink: 0 } }),
    node.scope === 'enterprise' && /*#__PURE__*/React.createElement(Icon, { name: "building-2", size: 10, style: { color: 'var(--scope-ent-fg)', flexShrink: 0 } })
    ),
    isFolder && node.open && node.children && node.children.map((c) => /*#__PURE__*/
    React.createElement(TreeNode, { key: c.id, node: c, activeNote: activeNote, onOpen: onOpen, onToggle: onToggle,
      renamingId: renamingId, onContextMenu: onContextMenu, onRenameCommit: onRenameCommit, onRenameCancel: onRenameCancel,
      sectionName: depth === 0 ? node.name : sectionName, theme: theme })
    )
    ));

}

function SH_baseName(p) {
  return String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || '');
}

function Sidebar({ tree, activeNote, onOpen, onToggle, workspace, bases, baseScopes, kbFilter, onToggleBase, onClearBases, wizard, onCreateNote, renamingId, onTreeContextMenu, onRenameCommit, onRenameCancel, roots, activeRoot, onSwitchRoot, discoveredLibraries, onOpenDiscovered, sectionProposals, onSectionApply, onSectionDismiss, onSectionUndo, onSectionPromote, theme }) {
  const legendScopes = SH_uniqScopes([workspace.scope, ...Object.values(baseScopes || {}), ...SH_collectScopes(tree)]);
  // Library up/down switcher — cycles across EVERY known library: configured
  // roots plus .lore-discovered ones, so a single-root user with other Lore
  // projects on disk can still arrow between them.
  const discRoots = (Array.isArray(discoveredLibraries) ? discoveredLibraries : []).
  map((d) => typeof d === 'string' ? d : d && d.root).filter(Boolean);
  const allLibs = [...new Set([...(Array.isArray(roots) ? roots : []), ...discRoots])];
  const openLib = (root) => {
    if (!root) return;
    if (typeof onOpenDiscovered === 'function') onOpenDiscovered(root); // loadTree(any root)
    else if (typeof onSwitchRoot === 'function' && roots.includes(root)) onSwitchRoot(roots.indexOf(root) <= roots.indexOf(activeRoot) ? -1 : 1);
  };
  const showLibrarySwitcher = allLibs.length > 1 && (typeof onOpenDiscovered === 'function' || typeof onSwitchRoot === 'function');
  let prevLibraryName = '',nextLibraryName = '',prevLib = null,nextLib = null;
  if (showLibrarySwitcher) {
    const idx = Math.max(0, allLibs.indexOf(activeRoot));
    prevLib = allLibs[(idx - 1 + allLibs.length) % allLibs.length];
    nextLib = allLibs[(idx + 1) % allLibs.length];
    prevLibraryName = SH_baseName(prevLib);
    nextLibraryName = SH_baseName(nextLib);
  }

  // Libraries discovered via `.lore` manifests but not currently configured/open —
  // surfaced in a small popover so a known library can be reopened with one click.
  const otherLibs = Array.isArray(discoveredLibraries) ? discoveredLibraries : [];
  const showOtherLibs = otherLibs.length > 0 && typeof onOpenDiscovered === 'function';

  // "Add group" inline form state — hooks must run before any early return.
  const [grpInput, setGrpInput] = React.useState(false);
  const [grpName, setGrpName] = React.useState('');
  const [grpStatus, setGrpStatus] = React.useState('');
  const [libsOpen, setLibsOpen] = React.useState(false);
  // Sections chip cloud collapses past this many — active selections + the
  // first few show inline; the rest expand on demand.
  const [chipsExpanded, setChipsExpanded] = React.useState(false);
  // Section proposal currently being applied/undone (disables its buttons).
  const [secBusy, setSecBusy] = React.useState(null);
  // Sections successfully promoted to a Personal Wizard this session — promote is
  // idempotent server-side, but once it succeeds swap the button for a badge so
  // the user isn't tempted to keep clicking. (Backend doesn't flag "is a wizard"
  // on the section row itself, so this is a lightweight, session-local record.)
  const [promoted, setPromoted] = React.useState(() => new Set());

  const handleAddGroup = async () => {
    const name = grpName.trim();
    if (!name) return;
    setGrpStatus('Creating…');
    try {
      const cfg = window.lore && window.lore.config && (await window.lore.config.get());
      const root = cfg && Array.isArray(cfg.roots) && cfg.roots[0] || null;
      if (!root) {setGrpStatus('Open a library first.');return;}
      const sep = root.includes('/') ? '/' : '\\';
      const path = root.replace(/[\\/]+$/, '') + sep + name + sep + '_index.md';
      const res = await window.lore.writeNote(path, '---\ntype: group\n---\n\n# ' + name + '\n\n');
      if (!res || res.ok === false) {setGrpStatus('Error: ' + (res && res.error || 'could not create group'));return;}
      setGrpName('');setGrpInput(false);setGrpStatus('');
      // vault:changed is already wired in wired-app.jsx → auto-refreshes tree + bases chips
    } catch (e) {setGrpStatus('Error: ' + (e && e.message || String(e)));}
  };

  // While viewing a Wizard, the sidebar shows the Wizard — NOT your personal files (scope isolation).
  if (wizard) {
    return (/*#__PURE__*/
      React.createElement("div", { style: shellS.sidebar }, /*#__PURE__*/
      React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--divider)' } }, /*#__PURE__*/
      React.createElement(Icon, { name: "library", size: 16, style: { color: 'var(--brand-fg)' } }), /*#__PURE__*/
      React.createElement("span", { style: { flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, wizard.name),
      wizard.scope && /*#__PURE__*/React.createElement(ScopeTag, { scope: wizard.scope, size: "sm", showLabel: false })
      ), /*#__PURE__*/
      React.createElement("div", { style: { flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 } },
      wizard.desc && /*#__PURE__*/React.createElement("div", { style: { fontSize: 12.5, color: 'var(--text-subtle)', lineHeight: 1.5 } }, wizard.desc),
      wizard.topics && wizard.topics.length > 0 && /*#__PURE__*/
      React.createElement("div", null, /*#__PURE__*/
      React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 } }, "Topics"), /*#__PURE__*/
      React.createElement("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 5 } }, wizard.topics.map((t) => /*#__PURE__*/React.createElement(Badge, { key: t, tone: "info" }, "#", t)))
      ),

      wizard.contributors && wizard.contributors.length > 0 && /*#__PURE__*/
      React.createElement("div", null, /*#__PURE__*/
      React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 } }, "Contributors"), /*#__PURE__*/
      React.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: 6 } }, wizard.contributors.map((m) => /*#__PURE__*/React.createElement("div", { key: m, style: { display: 'flex', alignItems: 'center', gap: 8 } }, /*#__PURE__*/React.createElement(Avatar, { name: m, size: 20 }), /*#__PURE__*/React.createElement("span", { style: { fontSize: 12.5, color: 'var(--text-body)' } }, m))))
      ), /*#__PURE__*/

      React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' } }, wizard.notes, " notes", wizard.recall != null ? ` · recall ${wizard.recall}` : '')
      ), /*#__PURE__*/
      React.createElement("div", { style: { padding: '9px 12px', borderTop: '1px solid var(--divider)', display: 'flex', alignItems: 'center', gap: 7 } }, /*#__PURE__*/
      React.createElement(Icon, { name: "eye-off", size: 12, style: { color: 'var(--text-faint)' } }), /*#__PURE__*/
      React.createElement("span", { style: { fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.4 } }, "Your personal library is hidden while viewing a Wizard.")
      )
      ));

  }
  const kbChip = (active, scope) => {
    const c = scope ? SH_scopeColor(scope) : null;
    return {
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 9px', borderRadius: 'var(--radius-full)', cursor: 'pointer',
      border: `1px solid ${active ? c || 'var(--brand-soft-border)' : 'var(--border)'}`,
      background: active ? 'var(--surface-raised)' : 'var(--surface-inset)',
      color: active ? c || 'var(--brand-fg)' : 'var(--text-muted)',
      fontFamily: 'var(--font-mono)', fontSize: 10.5, whiteSpace: 'nowrap'
    };
  };
  const allActive = !kbFilter || kbFilter.length === 0;
  return (/*#__PURE__*/
    React.createElement("div", { style: shellS.sidebar }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--divider)' } }, /*#__PURE__*/
    React.createElement(Icon, { name: "folder-open", size: 16, style: { color: 'var(--brand-fg)' } }), /*#__PURE__*/
    React.createElement("span", { style: { flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' } }, workspace.name),
    workspace.scope && /*#__PURE__*/React.createElement(ScopeTag, { scope: workspace.scope, size: "sm", showLabel: false }),
    showLibrarySwitcher && /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 1 } }, /*#__PURE__*/
    React.createElement(IconButton, { icon: "chevron-up", label: `Previous library — ${prevLibraryName}`, size: "sm", onClick: () => openLib(prevLib) }), /*#__PURE__*/
    React.createElement(IconButton, { icon: "chevron-down", label: `Next library — ${nextLibraryName}`, size: "sm", onClick: () => openLib(nextLib) })
    ),

    showOtherLibs && /*#__PURE__*/
    React.createElement("div", { style: { position: 'relative' } }, /*#__PURE__*/
    React.createElement(IconButton, { icon: "library", label: `Other libraries found (${otherLibs.length})`, size: "sm", onClick: () => setLibsOpen((o) => !o) }),
    libsOpen && /*#__PURE__*/
    React.createElement(React.Fragment, null, /*#__PURE__*/
    React.createElement("div", { style: { position: 'fixed', inset: 0, zIndex: 40 }, onClick: () => setLibsOpen(false) }), /*#__PURE__*/
    React.createElement("div", { style: { position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 41, width: 250, maxHeight: 300, overflowY: 'auto', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-xl)' } }, /*#__PURE__*/
    React.createElement("div", { style: { padding: '7px 10px', borderBottom: '1px solid var(--divider)', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em' } }, "Other libraries found"),
    otherLibs.map((d) => /*#__PURE__*/
    React.createElement("div", { key: d.root, onClick: () => {setLibsOpen(false);onOpenDiscovered(d.root);}, title: d.root,
      style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer' },
      onMouseEnter: (e) => e.currentTarget.style.background = 'var(--surface-hover)',
      onMouseLeave: (e) => e.currentTarget.style.background = 'transparent' }, /*#__PURE__*/
    React.createElement(Icon, { name: "library", size: 13, style: { color: 'var(--brand-fg)', flexShrink: 0 } }), /*#__PURE__*/
    React.createElement("div", { style: { minWidth: 0, flex: 1 } }, /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, d.name), /*#__PURE__*/
    React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 } },
    d.indexed && d.indexed.count != null ? `${d.indexed.count} notes · ` : '', d.root
    )
    )
    )
    )
    )
    )

    ), /*#__PURE__*/

    React.createElement(IconButton, { icon: "plus", label: "New note", size: "sm", onClick: onCreateNote })
    ), /*#__PURE__*/
    React.createElement("div", { style: { borderBottom: '1px solid var(--divider)', padding: '7px 10px' } }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 } }, /*#__PURE__*/
    React.createElement(Icon, { name: "layers", size: 11, style: { color: 'var(--text-faint)' } }), /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em' } }, "Sections ", allActive ? '· all' : `· ${kbFilter.length} selected`), /*#__PURE__*/
    React.createElement(HelpHint, { size: 13, tip: "Switch to one base, or click several to combine them. Filters the file tree AND the knowledge graph." }), /*#__PURE__*/
    React.createElement("button", { onClick: () => {setGrpInput(true);setGrpName('');setGrpStatus('');}, title: "Add a section",
      style: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-inset)', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 14, lineHeight: 1, flexShrink: 0 } }, "+")
    ),
    grpInput && /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 } }, /*#__PURE__*/
    React.createElement("input", { autoFocus: true, value: grpName, onChange: (e) => setGrpName(e.target.value),
      onKeyDown: (e) => {if (e.key === 'Enter') handleAddGroup();if (e.key === 'Escape') setGrpInput(false);},
      placeholder: "Group name\u2026",
      style: { flex: 1, padding: '4px 8px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-inset)', color: 'var(--text-strong)', fontFamily: 'var(--font-sans)', fontSize: 12, outline: 'none' } }), /*#__PURE__*/
    React.createElement("button", { onClick: handleAddGroup, style: { padding: '4px 9px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', background: 'var(--brand-soft-bg)', color: 'var(--brand-fg)', fontFamily: 'var(--font-sans)', fontSize: 11, cursor: 'pointer' } }, "Add"), /*#__PURE__*/
    React.createElement("button", { onClick: () => setGrpInput(false), style: { padding: '4px 9px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-faint)', fontFamily: 'var(--font-sans)', fontSize: 11, cursor: 'pointer' } }, "Cancel")
    ),

    grpStatus && /*#__PURE__*/React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--clay-400)', marginBottom: 4 } }, grpStatus),
    bases && bases.length > 0 && (() => {
      // Crowded libraries (15+ top-level folders) turned this into a
      // chip WALL eating half the sidebar. Collapse: actively-filtered
      // chips always show (a filter must never hide itself), then fill
      // to the cap; the rest sit behind "+N more".
      const CAP = 8;
      const active = kbFilter && kbFilter.length ? bases.filter((b) => kbFilter.includes(b)) : [];
      const rest = bases.filter((b) => !active.includes(b));
      const shown = chipsExpanded ? bases : [...active, ...rest].slice(0, CAP);
      const hidden = bases.length - shown.length;
      const chip = (b) => {
        const sc = baseScopes && baseScopes[b];
        return (/*#__PURE__*/
          React.createElement("button", { key: b, onClick: () => onToggleBase(b), style: kbChip(kbFilter && kbFilter.includes(b), sc) }, /*#__PURE__*/
          React.createElement("span", { style: { width: 7, height: 7, borderRadius: '50%', background: sc ? SH_scopeColor(sc) : 'var(--text-faint)', flexShrink: 0 } }), b
          ));

      };
      return (/*#__PURE__*/
        React.createElement("div", { style: { display: 'flex', gap: 5, flexWrap: 'wrap' } }, /*#__PURE__*/
        React.createElement("button", { onClick: onClearBases, style: { ...kbChip(allActive), borderColor: allActive ? 'var(--jade-500)' : 'var(--border)', background: allActive ? 'var(--surface-raised)' : 'var(--surface-inset)', color: allActive ? 'var(--jade-400)' : 'var(--text-muted)', fontWeight: 600 } }, "All"),
        shown.map(chip),
        (hidden > 0 || chipsExpanded) && /*#__PURE__*/
        React.createElement("button", { onClick: () => setChipsExpanded((v) => !v), style: { ...kbChip(false), color: 'var(--text-faint)' } },
        chipsExpanded ? 'less' : `+${hidden} more`
        )

        ));

    })(),
    (!bases || bases.length === 0) && !grpInput && /*#__PURE__*/
    React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', padding: '2px 0' } }, "No groups yet \u2014 click + to add one.")

    ),


    (() => {
      const visible = (sectionProposals || []).filter((s) => s.status !== 'dismissed');
      if (!visible.length) return null;
      const secBtn = (tone) => ({
        border: `1px solid ${tone === 'primary' ? 'var(--brand-soft-border)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-sm)', padding: '2px 8px', cursor: 'pointer',
        background: tone === 'primary' ? 'var(--brand-soft-bg)' : 'transparent',
        color: tone === 'primary' ? 'var(--brand-fg)' : 'var(--text-faint)',
        fontFamily: 'var(--font-sans)', fontSize: 10.5, whiteSpace: 'nowrap'
      });
      const run = async (id, fn) => {
        if (!fn || secBusy) return;
        setSecBusy(id);
        try {await fn(id);} finally {setSecBusy(null);}
      };
      const runPromote = async (id) => {
        if (!onSectionPromote || secBusy) return;
        setSecBusy(id);
        try {
          const r = await onSectionPromote(id);
          if (r && r.ok !== false) setPromoted((p) => new Set(p).add(id));
        } finally {setSecBusy(null);}
      };
      return (/*#__PURE__*/
        React.createElement("div", { style: { borderBottom: '1px solid var(--divider)', padding: '7px 10px' } }, /*#__PURE__*/
        React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 } }, /*#__PURE__*/
        React.createElement(Icon, { name: "folder-plus", size: 11, style: { color: 'var(--text-faint)' } }), /*#__PURE__*/
        React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em' } }, "Proposed sections"), /*#__PURE__*/
        React.createElement(HelpHint, { size: 13, tip: "Lore noticed groups of notes on the same topic and proposes a folder for each. Nothing is moved until you click Enable \u2014 and Undo puts every note back where it was." })
        ), /*#__PURE__*/
        React.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        visible.map((s) => {
          const busy = secBusy === s.id;
          const applied = s.status === 'applied';
          return (/*#__PURE__*/
            React.createElement("div", { key: s.id, style: { display: 'flex', alignItems: 'center', gap: 6 } }, /*#__PURE__*/
            React.createElement(Icon, { name: applied ? 'folder-check' : 'folder', size: 12, style: { color: applied ? 'var(--jade-400)' : 'var(--text-subtle)', flexShrink: 0 } }), /*#__PURE__*/
            React.createElement("span", { title: (s.notes || []).map((n) => n.title || n.id).join('\n'), style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5, color: 'var(--text-body)' } },
            s.name, /*#__PURE__*/
            React.createElement("span", { style: { color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontSize: 10 } }, " \xB7 ", (s.notes || []).length)
            ),
            applied ? /*#__PURE__*/
            React.createElement(React.Fragment, null,
            promoted.has(s.id) ? /*#__PURE__*/
            React.createElement(Badge, { tone: "success", dot: true }, "wizard") : /*#__PURE__*/

            React.createElement("button", { disabled: busy, onClick: () => runPromote(s.id), title: `Turn "${s.name}" into a Personal Wizard you can ask directly`, style: secBtn('primary') }, busy ? '…' : 'Promote'), /*#__PURE__*/

            React.createElement("button", { disabled: busy, onClick: () => run(s.id, onSectionUndo), title: "Move these notes back to their original locations", style: secBtn() }, busy ? '…' : 'Undo')
            ) : /*#__PURE__*/

            React.createElement(React.Fragment, null, /*#__PURE__*/
            React.createElement("button", { disabled: busy, onClick: () => run(s.id, onSectionApply), title: `Create a "${s.name}" folder and move these notes into it`, style: secBtn('primary') }, busy ? '…' : 'Enable'), /*#__PURE__*/
            React.createElement("button", { disabled: busy, onClick: () => run(s.id, onSectionDismiss), title: "Dismiss this proposal (it won't be suggested again)", style: secBtn() }, "\u2715")
            )

            ));

        })
        )
        ));

    })(), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1, overflowY: 'auto', padding: '4px 0' } },
    tree.length === 0 ? /*#__PURE__*/
    React.createElement("div", { style: { padding: '18px 14px', fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.5 } }, "No notes match the current filter."

    ) :
    tree.map((n) => /*#__PURE__*/
    React.createElement(TreeNode, { key: n.id, node: n, activeNote: activeNote, onOpen: onOpen, onToggle: onToggle,
      renamingId: renamingId, onContextMenu: onTreeContextMenu, onRenameCommit: onRenameCommit, onRenameCancel: onRenameCancel,
      sectionName: n.name, theme: theme })
    )
    ), /*#__PURE__*/
    React.createElement("div", { style: { padding: '9px 12px', borderTop: '1px solid var(--divider)', display: 'flex', flexDirection: 'column', gap: 7 } }, /*#__PURE__*/
    React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em' } }, "Scope legend"), /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', flexWrap: 'wrap', gap: '5px 12px' } },
    legendScopes.length ? legendScopes.map((sc) => /*#__PURE__*/
    React.createElement("span", { key: sc, style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)' } }, /*#__PURE__*/
    React.createElement(Icon, { name: SH_scopeIcon(sc), size: 11, style: { color: SH_scopeColor(sc) } }), SH_scopeLabel(sc)
    )
    ) : /*#__PURE__*/
    React.createElement("span", { style: { fontSize: 11, color: 'var(--text-faint)' } }, "No scope configured")

    ), /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 6, borderTop: '1px solid var(--divider)', paddingTop: 6 } }, /*#__PURE__*/
    React.createElement(Icon, { name: "file-text", size: 11, style: { color: 'var(--text-faint)' } }), /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' } }, workspace.indexedLabel ? `${workspace.indexedLabel} on disk` : 'no library')
    )
    )
    ));

}

function StatusBar() {
  return (/*#__PURE__*/
    React.createElement("div", { style: shellS.status }, /*#__PURE__*/
    React.createElement("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, /*#__PURE__*/React.createElement(Icon, { name: "circle-dot", size: 12 }), "status unavailable"), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1 } }), /*#__PURE__*/
    React.createElement("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, /*#__PURE__*/React.createElement(Icon, { name: "refresh-cw", size: 12 }), "not synced"), /*#__PURE__*/
    React.createElement("span", null, "Markdown")
    ));

}

Object.assign(window, { LoreTitlebar: Titlebar, LoreActivityRail: ActivityRail, LoreSidebar: Sidebar, LoreStatusBar: StatusBar });