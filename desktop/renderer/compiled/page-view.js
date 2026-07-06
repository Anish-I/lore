/* global React */
// Lore desktop — Hybrid open-page view: header chrome (back / Lives in / Chat /
// Move) around the LoreEditor reading column, plus the Related-pages pill row.
const pvNS = window.VaultDesignSystem_ffbf58;
const PvIcon = pvNS.Icon;

function pvScopePlace(scope) {
  const s = String(scope || '').toLowerCase();
  if (s === 'team') return 'team';
  if (s === 'company' || s === 'enterprise') return 'company';
  return 'my';
}

function PvPill({ children, onClick, title, dotColor }) {
  const [hover, setHover] = React.useState(false);
  return (/*#__PURE__*/
    React.createElement("button", { onClick: onClick, title: title,
      onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
      style: {
        display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 13px', borderRadius: 999,
        border: `1px solid ${hover ? 'var(--border-strong)' : 'var(--border)'}`,
        background: 'var(--surface-panel)', cursor: 'pointer',
        color: 'var(--text-body)', fontFamily: 'var(--font-sans)', fontSize: 12.5
      } },
    dotColor && /*#__PURE__*/React.createElement("span", { style: { width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 } }), /*#__PURE__*/
    React.createElement("span", { style: { maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, children)
    ));

}

// Related-pages strip — rendered inside the editor's reading column (footer prop).
function RelatedPages({ connections, onOpen }) {
  const conns = (connections || []).filter((c) => c.path);
  if (!conns.length) return null;
  const meta = window.LorePlaceMeta;
  const tipOf = (c) => c.kind === 'tag' ? 'Covers the same topic' : c.kind === 'folder' ? 'Sits in the same folder' : 'Linked pages';
  return (/*#__PURE__*/
    React.createElement("div", { style: { marginTop: 34, paddingTop: 18, borderTop: '1px solid var(--divider)' }, onClick: (e) => e.stopPropagation() }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 } }, /*#__PURE__*/
    React.createElement(PvIcon, { name: "link-2", size: 14, style: { color: 'var(--text-subtle)' } }), /*#__PURE__*/
    React.createElement("span", { style: { fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' } }, "Related pages"), /*#__PURE__*/
    React.createElement("span", { style: { fontSize: 11.5, color: 'var(--text-faint)' } }, "linked or on the same topic")
    ), /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 7, paddingTop: 8 } },
    conns.slice(0, 14).map((c, i) => /*#__PURE__*/
    React.createElement(PvPill, { key: c.id || i, title: tipOf(c), onClick: () => onOpen(c.path),
      dotColor: (meta[pvScopePlace(c.scope)] || meta.my).fg },
    c.label
    )
    )
    )
    ));

}

function PageView({ note, editor, place, mode, connections, onBack, onChatAbout, onMove }) {
  const meta = window.LorePlaceMeta[pvScopePlace(note && note.scope)] || window.LorePlaceMeta.my;
  const placeMeta = window.LorePlaceMeta[place] || meta;
  const [hoverBack, setHoverBack] = React.useState(false);
  return (/*#__PURE__*/
    React.createElement("div", { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface-canvas)' } }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 26px', borderBottom: '1px solid var(--divider)', flexShrink: 0 } }, /*#__PURE__*/
    React.createElement("button", { onClick: onBack,
      onMouseEnter: () => setHoverBack(true), onMouseLeave: () => setHoverBack(false),
      style: {
        display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
        cursor: 'pointer', padding: 0, fontFamily: 'var(--font-sans)', fontSize: 12.5,
        color: hoverBack ? 'var(--text-strong)' : 'var(--text-subtle)'
      } }, /*#__PURE__*/
    React.createElement(PvIcon, { name: "arrow-left", size: 14 }), "All ",
    placeMeta.label, " pages"
    ),
    mode === 'edit' && /*#__PURE__*/
    React.createElement("span", { style: { fontSize: 11.5, color: 'var(--text-faint)' } }, "Editing \u2014 click away to save"), /*#__PURE__*/

    React.createElement("div", { style: { flex: 1 } }), /*#__PURE__*/
    React.createElement("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, color: meta.fg } }, /*#__PURE__*/
    React.createElement(PvIcon, { name: meta.icon, size: 13 }), "Lives in ",
    meta.label
    ), /*#__PURE__*/
    React.createElement("button", { onClick: onChatAbout, style: {
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 13px', borderRadius: 8,
        border: '1px solid var(--brand-soft-border)', background: 'var(--brand-soft-bg)', cursor: 'pointer',
        color: 'var(--brand-fg)', fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 600
      } }, /*#__PURE__*/
    React.createElement(PvIcon, { name: "sparkles", size: 13 }), "Chat about this"
    ), /*#__PURE__*/
    React.createElement("button", { onClick: onMove, style: {
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 13px', borderRadius: 8,
        border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer',
        color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 500
      } }, /*#__PURE__*/
    React.createElement(PvIcon, { name: "corner-up-right", size: 13 }), "Move\u2026"
    )
    ), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1, minHeight: 0, display: 'flex' } },
    editor
    )
    ));

}

Object.assign(window, { LorePageView: PageView, LoreRelatedPages: RelatedPages });