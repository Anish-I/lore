/* global React */
// Lore desktop — Hybrid shell (Redesign C): Places bar, Ribbon, Section rail,
// Avatar menu, Toast. Replaces the old Titlebar/ActivityRail/Sidebar chrome.
const sh2NS = window.VaultDesignSystem_ffbf58;
const Sh2Icon = sh2NS.Icon;
const sh2IsMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

// Reusable "?" help hint with an instant custom tooltip (native title is
// unreliable in Electron). On window so other ui-kit files (buckets/projects/
// hooks) can reuse it — moved here from the retired shell.jsx.
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

// Place metadata — the single source of truth for the My Notes / Team / Company
// triad. Colors resolve through the --place-* tokens so both themes work.
// Shared on window for home-grid / page-view / ask / move-dialog.
const sh2Places = {
  my: {
    id: 'my', label: 'My Notes', icon: 'lock',
    fg: 'var(--place-my-fg)', solid: 'var(--place-my-solid)', tint: 'var(--place-my-tint)',
    border: 'var(--place-my-border)', onSolid: 'var(--place-my-on-solid)',
    hint: 'Only you can see My Notes', subHint: 'Move a page to share it',
    footer: 'Private. Nothing here leaves this computer.'
  },
  team: {
    id: 'team', label: 'Team', icon: 'users',
    fg: 'var(--place-team-fg)', solid: 'var(--place-team-solid)', tint: 'var(--place-team-tint)',
    border: 'var(--place-team-border)', onSolid: 'var(--place-team-on-solid)',
    hint: 'Team pages are shared with your teammates', subHint: 'Everyone on the team can read them',
    footer: 'Shared with your team. Teammates can read these pages.'
  },
  company: {
    id: 'company', label: 'Company', icon: 'building-2',
    fg: 'var(--place-company-fg)', solid: 'var(--place-company-solid)', tint: 'var(--place-company-tint)',
    border: 'var(--place-company-border)', onSolid: 'var(--place-company-on-solid)',
    hint: 'Company pages are visible to everyone', subHint: 'The whole company can read them',
    footer: 'Visible to everyone at your company.'
  }
};
window.LorePlaceMeta = sh2Places;

function sh2Initials(nameOrEmail) {
  const s = String(nameOrEmail || '').trim();
  if (!s) return '?';
  const base = s.includes('@') ? s.split('@')[0] : s;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

function PlaceTab({ meta, active, count, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (/*#__PURE__*/
    React.createElement("button", { onClick: onClick,
      onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
      style: {
        display: 'inline-flex', alignItems: 'center', gap: 8, height: 38, padding: '0 16px',
        borderRadius: 10, cursor: 'pointer', WebkitAppRegion: 'no-drag',
        border: `1px solid ${active ? meta.border : 'transparent'}`,
        background: active ? meta.tint : hover ? 'var(--surface-hover)' : 'transparent',
        color: active ? meta.fg : 'var(--text-muted)',
        fontFamily: 'var(--font-sans)', fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap'
      } }, /*#__PURE__*/
    React.createElement(Sh2Icon, { name: meta.icon, size: 16 }), /*#__PURE__*/
    React.createElement("span", null, meta.label),
    count != null && /*#__PURE__*/
    React.createElement("span", { style: {
        padding: '1px 8px', borderRadius: 999, fontSize: 11.5, fontWeight: 600,
        background: 'rgba(127,127,127,0.18)', color: active ? meta.fg : 'var(--text-subtle)'
      } }, count)

    ));

}

function AvatarMenu({ authUser, theme, onToggleTheme, onSettings, onHooks, onManageTeam, onSignIn, onSignOut, ownerName }) {
  const [open, setOpen] = React.useState(false);
  const who = authUser && (authUser.email || authUser.user_id) || ownerName || null;
  const row = (icon, label, onClick, sub) => /*#__PURE__*/
  React.createElement("div", { key: label, onClick: () => {setOpen(false);if (onClick) onClick();},
    style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', borderRadius: 8 },
    onMouseEnter: (e) => e.currentTarget.style.background = 'var(--surface-hover)',
    onMouseLeave: (e) => e.currentTarget.style.background = 'transparent' }, /*#__PURE__*/
  React.createElement(Sh2Icon, { name: icon, size: 15, style: { color: 'var(--text-subtle)', flexShrink: 0 } }), /*#__PURE__*/
  React.createElement("div", { style: { minWidth: 0, flex: 1 } }, /*#__PURE__*/
  React.createElement("div", { style: { fontSize: 13, color: 'var(--text-body)' } }, label),
  sub && /*#__PURE__*/React.createElement("div", { style: { fontSize: 11, color: 'var(--text-faint)', marginTop: 1 } }, sub)
  )
  );

  return (/*#__PURE__*/
    React.createElement("div", { style: { position: 'relative', WebkitAppRegion: 'no-drag' } }, /*#__PURE__*/
    React.createElement("button", { onClick: () => setOpen((o) => !o), "aria-label": "Account menu", style: {
        width: 30, height: 30, borderRadius: '50%', border: 'none', cursor: 'pointer',
        background: 'var(--amber-600)', color: '#1c1408',
        fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 700,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
      } }, sh2Initials(who || 'Lore')),
    open && /*#__PURE__*/
    React.createElement(React.Fragment, null, /*#__PURE__*/
    React.createElement("div", { style: { position: 'fixed', inset: 0, zIndex: 60 }, onClick: () => setOpen(false) }), /*#__PURE__*/
    React.createElement("div", { style: {
        position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 61, width: 250,
        background: 'var(--surface-overlay)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', padding: 6,
        animation: 'lore-fade-in 140ms ease'
      } }, /*#__PURE__*/
    React.createElement("div", { style: { padding: '9px 12px 10px', borderBottom: '1px solid var(--divider)', marginBottom: 4 } }, /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 13, fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, who || 'Not signed in'), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 11, color: 'var(--text-faint)', marginTop: 2 } }, authUser ? 'Signed in' : 'Sign in to use teams')
    ),
    row(theme === 'dark' ? 'sun' : 'moon', theme === 'dark' ? 'Light theme' : 'Dark theme', onToggleTheme),
    row('settings', 'Settings', onSettings),
    onHooks && row('plug', 'Capture hooks', onHooks, 'AI-tool sessions → your library'),
    onManageTeam && row('users', 'Manage team', onManageTeam), /*#__PURE__*/
    React.createElement("div", { style: { height: 1, background: 'var(--divider)', margin: '4px 0' } }),
    authUser ?
    row('log-out', 'Sign out', onSignOut) :
    row('log-in', 'Sign in', onSignIn)
    )
    )

    ));

}

// Top "Places" bar — brand block, centered place tabs, search + avatar.
function PlacesBar({ place, onPlace, counts, onSearch, theme, onToggleTheme, authUser, ownerName,
  onSettings, onHooks, onManageTeam, onSignIn, onSignOut }) {
  return (/*#__PURE__*/
    React.createElement("div", { style: {
        height: 'var(--places-height)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 16,
        padding: '0 16px', background: 'var(--surface-base)', borderBottom: '1px solid var(--border-subtle)',
        WebkitUserSelect: 'none', WebkitAppRegion: 'drag'
      } },
    sh2IsMac && /*#__PURE__*/React.createElement("div", { style: { width: 64, flexShrink: 0 } }), /*#__PURE__*/
    React.createElement("div", { style: { width: 170, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 9 } }, /*#__PURE__*/
    React.createElement("img", { src: "design/assets/logo/logomark.svg", alt: "", draggable: false, style: { width: 22, height: 22 } }), /*#__PURE__*/
    React.createElement("span", { style: { fontSize: 15.5, fontWeight: 700, color: 'var(--text-strong)', letterSpacing: '-0.01em' } }, "Lore")
    ), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1, display: 'flex', justifyContent: 'center', gap: 6, minWidth: 0 } },
    ['my', 'team', 'company'].map((id) => /*#__PURE__*/
    React.createElement(PlaceTab, { key: id, meta: sh2Places[id], active: place === id,
      count: counts ? counts[id] : null, onClick: () => onPlace(id) })
    )
    ), /*#__PURE__*/
    React.createElement("div", { style: { width: 270, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 } }, /*#__PURE__*/
    React.createElement("button", { onClick: onSearch, "aria-label": "Search pages", style: {
        display: 'inline-flex', alignItems: 'center', gap: 8, height: 32, minWidth: 150, padding: '0 10px',
        background: 'var(--surface-canvas)', border: '1px solid var(--border)', borderRadius: 8,
        color: 'var(--text-subtle)', fontFamily: 'var(--font-sans)', fontSize: 12.5, cursor: 'pointer',
        WebkitAppRegion: 'no-drag'
      } }, /*#__PURE__*/
    React.createElement(Sh2Icon, { name: "search", size: 14 }), /*#__PURE__*/
    React.createElement("span", { style: { flex: 1, textAlign: 'left' } }, "Search"), /*#__PURE__*/
    React.createElement("span", { style: { fontSize: 10.5, color: 'var(--text-faint)', border: '1px solid var(--border)', borderRadius: 5, padding: '1px 5px' } }, sh2IsMac ? '⌘K' : 'Ctrl K')
    ), /*#__PURE__*/
    React.createElement(AvatarMenu, { authUser: authUser, ownerName: ownerName, theme: theme, onToggleTheme: onToggleTheme,
      onSettings: onSettings, onHooks: onHooks, onManageTeam: onManageTeam, onSignIn: onSignIn, onSignOut: onSignOut })
    )
    ));

}

function RibbonTile({ icon, label, onClick, active, disabled, activeColor, title }) {
  const [hover, setHover] = React.useState(false);
  return (/*#__PURE__*/
    React.createElement("button", { onClick: disabled ? undefined : onClick, title: title || label, disabled: disabled,
      onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
      style: {
        width: 64, height: 54, borderRadius: 8, border: '1px solid transparent',
        display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
        background: active ? 'var(--brand-soft-bg)' : hover && !disabled ? 'rgba(127,127,127,0.10)' : 'transparent',
        borderColor: active ? 'var(--brand-soft-border)' : 'transparent',
        color: active ? 'var(--brand-fg)' : 'var(--text-body)',
        fontFamily: 'var(--font-sans)'
      } }, /*#__PURE__*/
    React.createElement(Sh2Icon, { name: icon, size: 19 }), /*#__PURE__*/
    React.createElement("span", { style: { fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap' } }, label)
    ));

}

// Office-style ribbon: Go | Create | Understand | Share groups + contextual place hint.
function Ribbon({ place, askOpen, mapOpen, wizardsOpen, canMove, onHome, onSearch, onSettings, onRefresh, refreshing,
  onNewPage, onAddFiles, onToggleAsk, onMap, onWizards, onMove }) {
  const meta = sh2Places[place] || sh2Places.my;
  const group = (caption, tiles, last) => /*#__PURE__*/
  React.createElement("div", { style: {
      display: 'flex', flexDirection: 'column', gap: 2, padding: '0 12px 0 0', marginRight: 12,
      borderRight: last ? 'none' : '1px solid var(--divider)'
    } }, /*#__PURE__*/
  React.createElement("div", { style: { display: 'flex', gap: 4 } }, tiles), /*#__PURE__*/
  React.createElement("div", { style: { fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.04em', textAlign: 'center' } }, caption)
  );

  return (/*#__PURE__*/
    React.createElement("div", { style: {
        flexShrink: 0, display: 'flex', alignItems: 'center', padding: '8px 16px',
        background: 'var(--surface-panel)', borderBottom: '1px solid var(--border-subtle)'
      } },
    group('Go', [/*#__PURE__*/
    React.createElement(RibbonTile, { key: "home", icon: "house", label: "Home", onClick: onHome, title: "Back to your pages" }), /*#__PURE__*/
    React.createElement(RibbonTile, { key: "search", icon: "search", label: "Search", onClick: onSearch, title: "Search pages (Ctrl/\u2318K)" })]
    ),
    group('Create', [/*#__PURE__*/
    React.createElement(RibbonTile, { key: "new", icon: "file-plus-2", label: "New page", onClick: onNewPage }), /*#__PURE__*/
    React.createElement(RibbonTile, { key: "add", icon: "upload", label: "Add files", onClick: onAddFiles })]
    ),
    group('Understand', [/*#__PURE__*/
    React.createElement(RibbonTile, { key: "ask", icon: "sparkles", label: "Ask Lore", onClick: onToggleAsk, active: askOpen }), /*#__PURE__*/
    React.createElement(RibbonTile, { key: "map", icon: "waypoints", label: "Map", onClick: onMap, active: mapOpen }), /*#__PURE__*/
    React.createElement(RibbonTile, { key: "wiz", icon: "wand-2", label: "Wizards", onClick: onWizards, active: wizardsOpen })]
    ),
    group('Share', [/*#__PURE__*/
    React.createElement(RibbonTile, { key: "move", icon: "corner-up-right", label: "Move\u2026", onClick: onMove, disabled: !canMove,
      title: canMove ? 'Move this page to another place' : 'Open a page first' })]
    ),
    group('Library', [/*#__PURE__*/
    React.createElement(RibbonTile, { key: "refresh", icon: "refresh-cw", label: refreshing ? 'Syncing…' : 'Refresh', onClick: onRefresh,
      disabled: refreshing, title: "Re-scan your library for new/changed pages" }), /*#__PURE__*/
    React.createElement(RibbonTile, { key: "set", icon: "settings", label: "Settings", onClick: onSettings, title: "Open settings" })],
    true), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1 } }), /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, minWidth: 0 } }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'inline-flex', alignItems: 'center', gap: 6, color: meta.fg, fontSize: 12, fontWeight: 500 } }, /*#__PURE__*/
    React.createElement(Sh2Icon, { name: meta.icon, size: 13 }), /*#__PURE__*/
    React.createElement("span", { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, meta.hint)
    ), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 11, color: 'var(--text-faint)' } }, meta.subHint)
    )
    ));

}

function RailRow({ icon, chipColor, label, count, active, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (/*#__PURE__*/
    React.createElement("button", { onClick: onClick,
      onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
      style: {
        display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 10px',
        borderRadius: 8, border: 'none', cursor: 'pointer', textAlign: 'left',
        background: active ? 'var(--surface-selected)' : hover ? 'var(--surface-hover)' : 'transparent',
        color: active ? 'var(--text-strong)' : 'var(--text-body)',
        fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: active ? 600 : 400
      } },
    icon ? /*#__PURE__*/
    React.createElement(Sh2Icon, { name: icon, size: 14, style: { color: active ? 'var(--brand-fg)' : 'var(--text-subtle)', flexShrink: 0 } }) : /*#__PURE__*/
    React.createElement("span", { style: { width: 10, height: 10, borderRadius: 3, background: chipColor || 'var(--text-faint)', flexShrink: 0 } }), /*#__PURE__*/
    React.createElement("span", { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label),
    count != null && /*#__PURE__*/React.createElement("span", { style: { fontSize: 11, color: 'var(--text-faint)' } }, count)
    ));

}

// Hover "⋯" menu on a section row → move the WHOLE folder to Team/Company/Private.
function SectionMoveMenu({ name, onMove, busy }) {
  const [open, setOpen] = React.useState(false);
  const targets = [
  { id: 'team', label: 'Team', icon: 'users' },
  { id: 'company', label: 'Company', icon: 'building-2' },
  { id: 'my', label: 'Private', icon: 'lock' }];

  return (/*#__PURE__*/
    React.createElement("span", { style: { position: 'relative', flexShrink: 0, display: 'inline-flex' }, onClick: (e) => e.stopPropagation() }, /*#__PURE__*/
    React.createElement("button", { onClick: (e) => {e.stopPropagation();setOpen((o) => !o);}, disabled: busy,
      "aria-label": `Move the ${name} section`, title: `Move everything in “${name}” to another place`,
      style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 5, border: 'none', background: open ? 'var(--surface-active)' : 'transparent', color: 'var(--text-faint)', cursor: busy ? 'wait' : 'pointer' },
      onMouseEnter: (e) => e.currentTarget.style.background = 'var(--surface-active)',
      onMouseLeave: (e) => e.currentTarget.style.background = open ? 'var(--surface-active)' : 'transparent' }, /*#__PURE__*/
    React.createElement(Sh2Icon, { name: busy ? 'loader' : 'more-horizontal', size: 14 })
    ),
    open && /*#__PURE__*/
    React.createElement(React.Fragment, null, /*#__PURE__*/
    React.createElement("div", { onClick: (e) => {e.stopPropagation();setOpen(false);}, style: { position: 'fixed', inset: 0, zIndex: 60 } }), /*#__PURE__*/
    React.createElement("div", { style: { position: 'absolute', top: '100%', right: 0, marginTop: 3, zIndex: 61, minWidth: 156, background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 8, boxShadow: 'var(--shadow-lg)', padding: 4 } }, /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 9.5, color: 'var(--text-faint)', padding: '4px 8px 3px', textTransform: 'uppercase', letterSpacing: '0.05em' } }, "Move section to"),
    targets.map((t) => /*#__PURE__*/
    React.createElement("div", { key: t.id, onClick: (e) => {e.stopPropagation();setOpen(false);onMove(t.id);},
      style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12.5, color: 'var(--text-body)' },
      onMouseEnter: (e) => e.currentTarget.style.background = 'var(--surface-hover)',
      onMouseLeave: (e) => e.currentTarget.style.background = 'transparent' }, /*#__PURE__*/
    React.createElement(Sh2Icon, { name: t.icon, size: 13, style: { color: 'var(--text-subtle)' } }), t.label
    )
    )
    )
    )

    ));

}

// A section row: folder chip + name + (count, replaced by the move menu on hover).
function SectionRow({ name, count, color, active, onSelect, onMove, busy }) {
  const [hover, setHover] = React.useState(false);
  return (/*#__PURE__*/
    React.createElement("div", { onClick: onSelect, onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
      style: {
        display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 10px',
        borderRadius: 8, cursor: 'pointer', textAlign: 'left',
        background: active ? 'var(--surface-selected)' : hover ? 'var(--surface-hover)' : 'transparent',
        color: active ? 'var(--text-strong)' : 'var(--text-body)',
        fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: active ? 600 : 400
      } }, /*#__PURE__*/
    React.createElement("span", { style: { width: 10, height: 10, borderRadius: 3, background: color || 'var(--text-faint)', flexShrink: 0 } }), /*#__PURE__*/
    React.createElement("span", { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, name),
    hover || busy ? /*#__PURE__*/
    React.createElement(SectionMoveMenu, { name: name, onMove: onMove, busy: busy }) :
    count != null && /*#__PURE__*/React.createElement("span", { style: { fontSize: 11, color: 'var(--text-faint)' } }, count)
    ));

}

// One of the two top-level sidebar tabs (Pages / Wizards). Greys out + blocks
// clicks when disabled (e.g. Wizards with zero wizards).
function SidebarTab({ icon, label, count, active, disabled, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (/*#__PURE__*/
    React.createElement("button", { onClick: disabled ? undefined : onClick, disabled: disabled,
      title: disabled ? 'No wizards yet — create one to enable this' : label,
      onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
      style: {
        flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        height: 32, borderRadius: 8, cursor: disabled ? 'default' : 'pointer',
        border: `1px solid ${active ? 'var(--brand-soft-border)' : 'transparent'}`,
        background: active ? 'var(--brand-soft-bg)' : hover && !disabled ? 'var(--surface-hover)' : 'transparent',
        color: disabled ? 'var(--text-faint)' : active ? 'var(--brand-fg)' : 'var(--text-body)',
        opacity: disabled ? 0.5 : 1,
        fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: active ? 600 : 500
      } }, /*#__PURE__*/
    React.createElement(Sh2Icon, { name: icon, size: 14 }), /*#__PURE__*/
    React.createElement("span", null, label),
    count != null && count > 0 && /*#__PURE__*/
    React.createElement("span", { style: { fontSize: 10.5, color: active ? 'var(--brand-fg)' : 'var(--text-faint)', background: 'rgba(127,127,127,0.16)', borderRadius: 999, padding: '0 6px' } }, count)

    ));

}

// Left section rail — Pages/Wizards tabs on top, then (in Pages mode) "Home" +
// one row per top-level folder in this place.
function SectionRail({ sections, allCount, active, onSelect, place, theme, view, onPages, onWizards, wizardCount, onMoveSection, sectionMoveBusy }) {
  const meta = sh2Places[place] || sh2Places.my;
  const onWizardsView = view === 'wizards';
  return (/*#__PURE__*/
    React.createElement("div", { style: {
        width: 'var(--sections-width)', flexShrink: 0, display: 'flex', flexDirection: 'column',
        background: 'var(--surface-panel)', borderRight: '1px solid var(--border-subtle)',
        padding: '14px 8px 10px'
      } }, /*#__PURE__*/

    React.createElement("div", { style: { display: 'flex', gap: 4, marginBottom: 10, padding: '0 2px' } }, /*#__PURE__*/
    React.createElement(SidebarTab, { icon: "files", label: "Pages", active: !onWizardsView, onClick: onPages }), /*#__PURE__*/
    React.createElement(SidebarTab, { icon: "wand-2", label: "Wizards", count: wizardCount, active: onWizardsView,
      disabled: !wizardCount, onClick: onWizards })
    ), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 } },
    onWizardsView ? /*#__PURE__*/
    React.createElement("div", { style: { padding: '4px 8px', fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.5 } },
    wizardCount, " wizard", wizardCount === 1 ? '' : 's', ". Chat with a bundle of pages, or install more from the marketplace."
    ) : /*#__PURE__*/

    React.createElement(React.Fragment, null, /*#__PURE__*/
    React.createElement(RailRow, { icon: "house", label: "Home", count: allCount,
      active: !active || active === 'all', onClick: () => onSelect('all') }),
    (sections || []).map((s) => /*#__PURE__*/
    React.createElement(SectionRow, { key: s.name, name: s.name, count: s.count,
      color: window.LoreSectionColor ? window.LoreSectionColor(s.name, theme) : null,
      active: active === s.name, onSelect: () => onSelect(s.name),
      busy: sectionMoveBusy === s.name,
      onMove: (target) => onMoveSection && onMoveSection(s.name, target) })
    )
    )

    ), /*#__PURE__*/
    React.createElement("div", { style: { padding: '10px 10px 2px', borderTop: '1px solid var(--divider)', display: 'flex', gap: 7, alignItems: 'flex-start' } }, /*#__PURE__*/
    React.createElement(Sh2Icon, { name: meta.icon, size: 12, style: { color: meta.fg, flexShrink: 0, marginTop: 1 } }), /*#__PURE__*/
    React.createElement("span", { style: { fontSize: 10.5, color: 'var(--text-faint)', lineHeight: 1.45 } }, meta.footer)
    )
    ));

}

// Bottom-center toast pill — parent owns the message + timeout (flash helper).
function Toast({ toast }) {
  if (!toast) return null;
  return (/*#__PURE__*/
    React.createElement("div", { style: {
        position: 'absolute', bottom: 46, left: 0, right: 0, display: 'flex', justifyContent: 'center',
        pointerEvents: 'none', zIndex: 70
      } }, /*#__PURE__*/
    React.createElement("div", { style: {
        display: 'inline-flex', alignItems: 'center', gap: 9, padding: '10px 16px',
        background: 'var(--surface-overlay)', border: '1px solid var(--border)', borderRadius: 10,
        boxShadow: 'var(--shadow-popover)', color: 'var(--text-body)', fontSize: 13,
        fontFamily: 'var(--font-sans)', animation: 'lore-fade-in 160ms ease'
      } }, /*#__PURE__*/
    React.createElement(Sh2Icon, { name: "check", size: 15, style: { color: 'var(--success-fg)' } }), /*#__PURE__*/
    React.createElement("span", null, toast)
    )
    ));

}

Object.assign(window, {
  LorePlacesBar: PlacesBar,
  LoreRibbon: Ribbon,
  LoreSectionRail: SectionRail,
  LoreToast: Toast
});