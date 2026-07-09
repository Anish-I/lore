/* global React */
// Lore desktop — center editor (reading view) + right context pane
const edNS = window.VaultDesignSystem_ffbf58;
const { Icon: EdIcon, IconButton: EdIconBtn, WikiLink, ScopeTag: EdScope, Tabs: EdTabs, Avatar: EdAvatar, Badge: EdBadge, ScopePicker, Tooltip: EdTip } = edNS;

const edS = {
  center: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface-canvas)' },
  tabbar: { display: 'flex', alignItems: 'center', flexWrap: 'nowrap', overflow: 'hidden', height: 38, background: 'var(--surface-base)', borderBottom: '1px solid var(--border-subtle)', paddingRight: 8, flexShrink: 0 },
  tab: (on) => ({
    display: 'flex', alignItems: 'center', gap: 7, height: '100%', padding: '0 14px',
    minWidth: 0, flexShrink: 1,
    borderRight: '1px solid var(--border-subtle)', cursor: 'pointer',
    background: on ? 'var(--surface-canvas)' : 'transparent',
    color: on ? 'var(--text-strong)' : 'var(--text-subtle)', fontSize: 13,
    boxShadow: on ? 'inset 0 2px 0 var(--brand-bg)' : 'none'
  }),
  toolbar: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 18px', borderBottom: '1px solid var(--divider)', flexShrink: 0 },
  scroll: { flex: 1, overflowY: 'auto', padding: '40px 0 120px' },
  col: { maxWidth: 700, width: '100%', margin: '0 auto', padding: '0 44px', boxSizing: 'border-box' },
  context: { width: 'var(--context-width)', flexShrink: 0, background: 'var(--surface-panel)', borderLeft: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column' }
};

// Reading-view image: resolves a stored `assets/…` path to a data: URL (CSP-safe)
// and renders it. Absolute http/data URLs render directly.
function EdImg({ src, alt }) {
  const [url, setUrl] = React.useState(/^(https?:|data:|blob:)/.test(src || '') ? src : null);
  React.useEffect(() => {
    if (url || !src || !(window.lore && window.lore.assetDataUrl)) return;
    let live = true;
    window.lore.assetDataUrl(src).then((u) => {if (live && u) setUrl(u);}).catch(() => {});
    return () => {live = false;};
  }, [src]);
  if (!url) return /*#__PURE__*/React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-faint)' } }, "\uD83D\uDDBC ", alt || src);
  return /*#__PURE__*/React.createElement("img", { src: url, alt: alt || '', style: { display: 'block', maxWidth: '100%', borderRadius: 'var(--radius-md)', margin: '10px 0' } });
}

function Runs({ runs, onOpen }) {
  return runs.map((r, i) => {
    if (r.img) return /*#__PURE__*/React.createElement(EdImg, { key: i, src: r.img, alt: r.x });
    if (r.link) return /*#__PURE__*/React.createElement(WikiLink, { key: i, onClick: () => onOpen && onOpen(r.link) }, r.x);
    if (r.mark) return /*#__PURE__*/React.createElement("mark", { key: i, style: { background: 'var(--highlight-bg)', color: 'var(--text-strong)', borderRadius: 2, padding: '0 2px' } }, r.x);
    if (r.code) return /*#__PURE__*/React.createElement("code", { key: i, style: { fontFamily: 'var(--font-mono)', fontSize: '0.86em', background: 'var(--surface-inset)', padding: '0.1em 0.35em', borderRadius: 'var(--radius-sm)' } }, r.x);
    return /*#__PURE__*/React.createElement("span", { key: i }, r.x);
  });
}

function Block({ b, note, onOpen, accent }) {
  const ac = accent || 'var(--brand-fg)';
  if (b.t === 'h1') return /*#__PURE__*/React.createElement("h1", { style: { fontFamily: 'var(--type-reading-font)', fontSize: 27, fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.01em', margin: '0 0 14px', color: 'var(--text-strong)' } }, b.s);
  if (b.t === 'meta') return (/*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 26px', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)' } }, /*#__PURE__*/
    React.createElement(EdScope, { scope: note.scope, size: "sm" }), /*#__PURE__*/
    React.createElement("span", null, note.owner), /*#__PURE__*/React.createElement("span", null, "\xB7 updated ", note.updated), /*#__PURE__*/
    React.createElement("span", { style: { color: 'var(--link-fg)' } }, note.tags.map((t) => '#' + t).join('  '))
    ));

  if (b.t === 'h2') return /*#__PURE__*/React.createElement("h2", { style: { fontFamily: 'var(--type-reading-font)', fontSize: 17, fontWeight: 600, margin: '28px 0 10px', color: 'var(--text-strong)' } }, b.s);
  if (b.t === 'h3') return /*#__PURE__*/React.createElement("h3", { style: { fontFamily: 'var(--type-reading-font)', fontSize: 15, fontWeight: 600, margin: '22px 0 8px', color: 'var(--text-strong)' } }, b.s);
  if (b.t === 'quote') return /*#__PURE__*/React.createElement("blockquote", { style: { margin: '18px 0', padding: '8px 16px', borderLeft: `3px solid ${ac}`, background: 'var(--surface-hover)', borderRadius: '0 8px 8px 0', color: 'var(--text-body)', fontFamily: 'var(--type-reading-font)', fontSize: 14, lineHeight: 1.65 } }, b.runs ? /*#__PURE__*/React.createElement(Runs, { runs: b.runs, onOpen: onOpen }) : b.s);
  if (b.t === 'code') return /*#__PURE__*/React.createElement("pre", { style: { margin: '16px 0', padding: '12px 14px', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflowX: 'auto', fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-body)' } }, b.s);
  if (b.t === 'li') return (/*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', gap: 10, margin: '5px 0', fontFamily: 'var(--type-reading-font)', fontSize: 14.5, lineHeight: 1.6, color: 'var(--text-body)' } }, /*#__PURE__*/
    React.createElement("span", { style: { color: ac, marginTop: 1 } }, "\u2022"), /*#__PURE__*/
    React.createElement("span", null, b.runs ? /*#__PURE__*/React.createElement(Runs, { runs: b.runs, onOpen: onOpen }) : b.s)
    ));

  return /*#__PURE__*/React.createElement("p", { style: { fontFamily: 'var(--type-reading-font)', fontSize: 14.5, lineHeight: 1.7, margin: '0 0 14px', color: 'var(--text-body)' } }, b.runs ? /*#__PURE__*/React.createElement(Runs, { runs: b.runs, onOpen: onOpen }) : b.s);
}

// Overflow: past ED_TAB_MAX open tabs, the strip shows the first ED_TAB_SHOW pills
// (plus the active tab, pulled forward even when it sits beyond them) and folds the
// rest into an "N more…" dropdown — endless VS-Code-style pill rows got confusing.
const ED_TAB_MAX = 6,ED_TAB_SHOW = 5;

function TabStrip({ tabs, activeId, onTab, onCloseTab, onCloseOthers, onTogglePane }) {
  const all = tabs || [];
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [hoverTab, setHoverTab] = React.useState(null); // reveals the per-tab "close others" icon
  let visible = all,hidden = [];
  if (all.length > ED_TAB_MAX) {
    visible = all.slice(0, ED_TAB_SHOW);
    hidden = all.slice(ED_TAB_SHOW);
    const active = hidden.find((t) => t.id === activeId);
    if (active) {
      visible = [...visible, active];
      hidden = hidden.filter((t) => t.id !== activeId);
    }
  }
  return (/*#__PURE__*/
    React.createElement("div", { style: edS.tabbar },
    visible.map((t) => {
      const on = t.id === activeId;
      return (/*#__PURE__*/
        React.createElement("div", { key: t.id, style: edS.tab(on), onClick: () => onTab && onTab(t.id), title: t.title,
          onMouseEnter: () => setHoverTab(t.id), onMouseLeave: () => setHoverTab((h) => h === t.id ? null : h) }, /*#__PURE__*/
        React.createElement(EdIcon, { name: t.kind === 'bucket' ? 'library' : 'file-text', size: 13, style: { color: on ? 'var(--brand-fg)' : 'var(--text-faint)' } }), /*#__PURE__*/
        React.createElement("span", { style: { maxWidth: 150, minWidth: 18, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t.title),
        onCloseOthers && all.length > 1 && /*#__PURE__*/
        React.createElement("span", { onClick: (e) => {e.stopPropagation();onCloseOthers(t.id);}, title: "Close other tabs",
          style: { display: 'inline-flex', marginLeft: 2, opacity: 0.55, borderRadius: 3, visibility: hoverTab === t.id ? 'visible' : 'hidden' },
          onMouseEnter: (e) => {e.currentTarget.style.opacity = 1;e.currentTarget.style.background = 'var(--surface-hover)';},
          onMouseLeave: (e) => {e.currentTarget.style.opacity = 0.55;e.currentTarget.style.background = 'transparent';} }, /*#__PURE__*/
        React.createElement(EdIcon, { name: "copy-x", size: 12 })
        ), /*#__PURE__*/

        React.createElement("span", { onClick: (e) => {e.stopPropagation();onCloseTab && onCloseTab(t.id);}, style: { display: 'inline-flex', marginLeft: 2, opacity: 0.55, borderRadius: 3 },
          onMouseEnter: (e) => {e.currentTarget.style.opacity = 1;e.currentTarget.style.background = 'var(--surface-hover)';},
          onMouseLeave: (e) => {e.currentTarget.style.opacity = 0.55;e.currentTarget.style.background = 'transparent';} }, /*#__PURE__*/
        React.createElement(EdIcon, { name: "x", size: 12 })
        )
        ));

    }),
    hidden.length > 0 && /*#__PURE__*/
    React.createElement("div", { style: { position: 'relative', height: '100%' } }, /*#__PURE__*/
    React.createElement("div", { onClick: () => setMoreOpen((o) => !o), title: `${hidden.length} more open tab${hidden.length !== 1 ? 's' : ''}`,
      style: { display: 'flex', alignItems: 'center', gap: 5, height: '100%', padding: '0 12px', borderRight: '1px solid var(--border-subtle)', cursor: 'pointer', color: 'var(--text-subtle)', fontSize: 12, whiteSpace: 'nowrap' } },
    hidden.length, " more\u2026", /*#__PURE__*/
    React.createElement(EdIcon, { name: "chevron-down", size: 12, style: { color: 'var(--text-faint)' } })
    ),
    moreOpen && /*#__PURE__*/
    React.createElement(React.Fragment, null, /*#__PURE__*/
    React.createElement("div", { style: { position: 'fixed', inset: 0, zIndex: 40 }, onClick: () => setMoreOpen(false) }), /*#__PURE__*/
    React.createElement("div", { style: { position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 41, minWidth: 200, maxWidth: 280, maxHeight: 320, overflowY: 'auto', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-xl)', padding: 4 } },
    hidden.map((t) => /*#__PURE__*/
    React.createElement("div", { key: t.id, onClick: () => {setMoreOpen(false);onTab && onTab(t.id);}, title: t.title,
      style: { display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 12.5, color: 'var(--text-body)' },
      onMouseEnter: (e) => e.currentTarget.style.background = 'var(--surface-hover)',
      onMouseLeave: (e) => e.currentTarget.style.background = 'transparent' }, /*#__PURE__*/
    React.createElement(EdIcon, { name: t.kind === 'bucket' ? 'library' : 'file-text', size: 13, style: { color: 'var(--text-faint)' } }), /*#__PURE__*/
    React.createElement("span", { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t.title), /*#__PURE__*/
    React.createElement("span", { onClick: (e) => {e.stopPropagation();onCloseTab && onCloseTab(t.id);}, style: { display: 'inline-flex', opacity: 0.55, borderRadius: 3 },
      onMouseEnter: (e) => {e.currentTarget.style.opacity = 1;e.currentTarget.style.background = 'var(--surface-hover)';},
      onMouseLeave: (e) => {e.currentTarget.style.opacity = 0.55;e.currentTarget.style.background = 'transparent';} }, /*#__PURE__*/
    React.createElement(EdIcon, { name: "x", size: 12 })
    )
    )
    )
    )
    )

    ), /*#__PURE__*/

    React.createElement("div", { style: { flex: 1 } }), /*#__PURE__*/
    React.createElement(EdIconBtn, { icon: "panel-right-close", label: "Toggle context pane", size: "sm", onClick: onTogglePane })
    ));

}

function BucketBody({ bucket: b, onOpen }) {
  return (/*#__PURE__*/
    React.createElement("div", { style: edS.scroll }, /*#__PURE__*/
    React.createElement("div", { style: { maxWidth: 760, margin: '0 auto', padding: '0 36px' } }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 } }, /*#__PURE__*/
    React.createElement("span", { style: { width: 44, height: 44, borderRadius: 'var(--radius-md)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)' } }, /*#__PURE__*/
    React.createElement(EdIcon, { name: "library", size: 22, style: { color: 'var(--brand-fg)' } })
    ), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1 } }, /*#__PURE__*/
    React.createElement("h1", { style: { fontFamily: 'var(--font-serif)', fontSize: 'var(--text-3xl)', fontWeight: 600, color: 'var(--text-strong)', margin: 0 } }, b.name), /*#__PURE__*/
    React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)', marginTop: 4 } }, b.group, " \xB7 ", b.notes, " notes \xB7 recall ", b.recall.toFixed(2))
    ), /*#__PURE__*/
    React.createElement(EdScope, { scope: b.scope })
    ), /*#__PURE__*/
    React.createElement("p", { style: { fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', lineHeight: 1.6, color: 'var(--text-body)', margin: '0 0 18px' } }, b.desc), /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 18 } },
    b.topics.map((t) => /*#__PURE__*/React.createElement(EdBadge, { key: t, tone: "info" }, "#", t))
    ), /*#__PURE__*/
    React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-subtle)', marginBottom: 8 } }, "contributors"), /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 } },
    b.contributors.map((m) => /*#__PURE__*/React.createElement("div", { key: m, style: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 4px', border: '1px solid var(--border)', borderRadius: 'var(--radius-full)' } }, /*#__PURE__*/React.createElement(EdAvatar, { name: m, size: 20 }), /*#__PURE__*/React.createElement("span", { style: { fontSize: 12.5, color: 'var(--text-muted)' } }, m)))
    ), /*#__PURE__*/
    React.createElement("button", { onClick: () => onOpen && onOpen(), style: { display: 'inline-flex', alignItems: 'center', gap: 8, height: 36, padding: '0 16px', border: '1px solid var(--brand-soft-border)', background: 'var(--brand-soft-bg)', color: 'var(--brand-fg)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600 } }, /*#__PURE__*/
    React.createElement(EdIcon, { name: "sparkles", size: 15 }), "Ask this bucket"
    )
    )
    ));

}

// Confidentiality picker: the note's real "who can see this" control. Maps the
// internal scope value to plain business words (Private / Team / Company) and
// persists the change via onSetScope (rewrites frontmatter + reindex). Any scope
// that isn't team/company reads as Private (a solo library's purpose scope like
// "engineering" is just "your private notes").
const VIS_LEVELS = [
{ id: 'private', label: 'Private', icon: 'lock', hint: 'Only you' },
{ id: 'team', label: 'Team', icon: 'users', hint: 'Your team can see it' },
{ id: 'company', label: 'Company', icon: 'building-2', hint: 'Everyone in your org' }];

function visOf(scope) {
  const s = String(scope || '').toLowerCase();
  return s === 'team' || s === 'company' || s === 'enterprise' ? s === 'enterprise' ? 'company' : s : 'private';
}
function VisibilityControl({ note, onSetScope }) {
  const [open, setOpen] = React.useState(false);
  const cur = visOf(note && note.scope);
  const active = VIS_LEVELS.find((v) => v.id === cur) || VIS_LEVELS[0];
  if (!onSetScope) return null;
  return (/*#__PURE__*/
    React.createElement("div", { style: { position: 'relative' } }, /*#__PURE__*/
    React.createElement("button", { onClick: () => setOpen((o) => !o), title: "Change who can see this note",
      style: { display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-inset)', color: 'var(--text-body)', fontFamily: 'var(--font-sans)', fontSize: 12, cursor: 'pointer' } }, /*#__PURE__*/
    React.createElement(EdIcon, { name: active.icon, size: 13, style: { color: cur === 'private' ? 'var(--text-faint)' : 'var(--brand-fg)' } }), active.label, /*#__PURE__*/
    React.createElement(EdIcon, { name: "chevron-down", size: 12, style: { color: 'var(--text-faint)' } })
    ),
    open && /*#__PURE__*/
    React.createElement(React.Fragment, null, /*#__PURE__*/
    React.createElement("div", { onClick: () => setOpen(false), style: { position: 'fixed', inset: 0, zIndex: 40 } }), /*#__PURE__*/
    React.createElement("div", { style: { position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 41, minWidth: 190, background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-xl)', padding: 4 } },
    VIS_LEVELS.map((v) => /*#__PURE__*/
    React.createElement("div", { key: v.id, onClick: async () => {
        setOpen(false);
        if (v.id === cur) return;
        await onSetScope(v.id);
      }, style: { display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', background: v.id === cur ? 'var(--surface-hover)' : 'transparent' },
      onMouseEnter: (e) => e.currentTarget.style.background = 'var(--surface-hover)',
      onMouseLeave: (e) => e.currentTarget.style.background = v.id === cur ? 'var(--surface-hover)' : 'transparent' }, /*#__PURE__*/
    React.createElement(EdIcon, { name: v.icon, size: 14, style: { color: v.id === 'private' ? 'var(--text-faint)' : 'var(--brand-fg)', flexShrink: 0 } }), /*#__PURE__*/
    React.createElement("div", { style: { minWidth: 0 } }, /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 12.5, color: 'var(--text-strong)', fontWeight: v.id === cur ? 600 : 400 } }, v.label), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 10.5, color: 'var(--text-faint)' } }, v.hint)
    )
    )
    )
    )
    )

    ));

}

// Split a note's YAML frontmatter (preserved byte-for-byte) from its body.
function edSplitFrontmatter(raw) {
  const m = String(raw || '').match(/^(---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?)/);
  return m ? { fm: m[1], body: String(raw).slice(m[1].length) } : { fm: '', body: String(raw || '') };
}

// One toolbar button (Word-style). Uses onMouseDown preventDefault so clicking it
// never steals the caret/selection from the editor (execCommand needs it live).
function EdTbBtn({ icon, label, active, onClick, text }) {
  const [hover, setHover] = React.useState(false);
  return (/*#__PURE__*/
    React.createElement("button", { title: label, "aria-label": label,
      onMouseDown: (e) => e.preventDefault(), onClick: onClick,
      onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
      style: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 30, height: 30, padding: text ? '0 8px' : 0,
        borderRadius: 7, border: '1px solid transparent', cursor: 'pointer',
        background: active ? 'var(--brand-soft-bg)' : hover ? 'var(--surface-hover)' : 'transparent',
        color: active ? 'var(--brand-fg)' : 'var(--text-body)',
        fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 600
      } },
    icon ? /*#__PURE__*/React.createElement(EdIcon, { name: icon, size: 16 }) : text
    ));

}
const edTbSep = () => /*#__PURE__*/React.createElement("span", { style: { width: 1, height: 20, background: 'var(--divider)', margin: '0 3px', flexShrink: 0 } });

// Word-like WYSIWYG editor. Renders the note body as rich HTML (markdown-it),
// edits it in a contentEditable with a formatting toolbar, and serializes back to
// clean Markdown on save (frontmatter preserved, wikilinks/tags intact). A
// "source" toggle exposes the raw markdown as a safety valve.
function WysiwygEditor({ note, onExit, accent }) {
  const ref = React.useRef(null);
  const [showSource, setShowSource] = React.useState(false);
  const [blockTag, setBlockTag] = React.useState('P'); // current block format (for toolbar active state)
  const bodyRef = React.useRef(edSplitFrontmatter(note.raw).body);
  const fmRef = React.useRef(edSplitFrontmatter(note.raw).fm);
  const [source, setSource] = React.useState(bodyRef.current);
  // Serialized form of the loaded content — the WYSIWYG normalizes markdown
  // (e.g. `*item` → `- item`), so we compare against THIS, not the raw file, to
  // decide "did the user actually change anything". Prevents rewriting (and
  // churning the git history of) notes the user merely opened in edit mode.
  const baselineRef = React.useRef(null);

  const resolveImages = React.useCallback((el) => {
    el.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || '';
      img.style.maxWidth = '100%';
      if (/^(https?:|data:|blob:)/.test(src)) return;
      img.dataset.rel = src;
      if (window.lore && window.lore.assetDataUrl) {
        window.lore.assetDataUrl(src).then((u) => {if (u) img.src = u;}).catch(() => {});
      }
    });
  }, []);

  // Render the body HTML into the editable whenever we (re)enter rich mode.
  React.useEffect(() => {
    if (showSource) return;
    const el = ref.current;if (!el) return;
    try {document.execCommand('styleWithCSS', false, false);} catch {/* tag-based marks */}
    el.innerHTML = window.markdownToHtmlBody(bodyRef.current);
    resolveImages(el);
    // Baseline = the loaded content as our serializer would emit it, so a no-op
    // open→close doesn't count as an edit.
    if (baselineRef.current === null) baselineRef.current = window.htmlToMarkdown(el);
    el.focus();
    const sel = window.getSelection();
    if (sel && el.lastChild) {const r = document.createRange();r.selectNodeContents(el);r.collapse(false);sel.removeAllRanges();sel.addRange(r);}
  }, [showSource, resolveImages]);

  const currentBody = () => showSource ? source : window.htmlToMarkdown(ref.current || '');
  const save = () => {
    const body = currentBody();
    if (baselineRef.current !== null && body === baselineRef.current) return; // unchanged — don't rewrite
    baselineRef.current = body;
    if (note.onEdit) note.onEdit((fmRef.current || '') + body);
  };
  const commitExit = () => {save();onExit && onExit();};

  const exec = (cmd, val) => {document.execCommand(cmd, false, val);if (ref.current) ref.current.focus();syncBlock();};
  const fmt = (tag) => {document.execCommand('formatBlock', false, tag);if (ref.current) ref.current.focus();syncBlock();};
  const syncBlock = () => {
    try {
      const b = document.queryCommandValue('formatBlock');
      setBlockTag(b ? String(b).toUpperCase() : 'P');
    } catch {/* ignore */}
  };
  const insertLink = () => {const url = window.prompt('Link URL (https://…):');if (url) exec('createLink', url.trim());};
  const insertImage = async () => {
    if (!window.lore || !window.lore.addImage) return;
    try {
      const r = await window.lore.addImage();
      if (r && r.ok) {
        if (ref.current) ref.current.focus();
        document.execCommand('insertHTML', false, `<img src="${r.dataUrl}" data-rel="${r.rel}" alt="" style="max-width:100%" />`);
      }
    } catch {/* cancelled or no library */}
  };
  const toggleSource = () => {
    if (!showSource) {bodyRef.current = window.htmlToMarkdown(ref.current || '');setSource(bodyRef.current);} else
    {bodyRef.current = source;}
    setShowSource((s) => !s);
  };

  const isH = (t) => blockTag === t;
  return (/*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 },
      onBlur: (e) => {if (!e.currentTarget.contains(e.relatedTarget)) commitExit();},
      onKeyDown: (e) => {if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 's') {e.preventDefault();commitExit();}} }, /*#__PURE__*/

    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', padding: '7px 44px', borderBottom: '1px solid var(--divider)', background: 'var(--surface-base)', position: 'sticky', top: 0, zIndex: 5 } },
    !showSource && /*#__PURE__*/
    React.createElement(React.Fragment, null, /*#__PURE__*/
    React.createElement(EdTbBtn, { icon: "bold", label: "Bold (Ctrl+B)", onClick: () => exec('bold') }), /*#__PURE__*/
    React.createElement(EdTbBtn, { icon: "italic", label: "Italic (Ctrl+I)", onClick: () => exec('italic') }), /*#__PURE__*/
    React.createElement(EdTbBtn, { icon: "strikethrough", label: "Strikethrough", onClick: () => exec('strikeThrough') }),
    edTbSep(), /*#__PURE__*/
    React.createElement(EdTbBtn, { text: "H1", label: "Heading 1", active: isH('H1'), onClick: () => fmt('H1') }), /*#__PURE__*/
    React.createElement(EdTbBtn, { text: "H2", label: "Heading 2", active: isH('H2'), onClick: () => fmt('H2') }), /*#__PURE__*/
    React.createElement(EdTbBtn, { text: "H3", label: "Heading 3", active: isH('H3'), onClick: () => fmt('H3') }), /*#__PURE__*/
    React.createElement(EdTbBtn, { icon: "pilcrow", label: "Normal text", active: isH('P') || isH('DIV'), onClick: () => fmt('P') }),
    edTbSep(), /*#__PURE__*/
    React.createElement(EdTbBtn, { icon: "list", label: "Bulleted list", onClick: () => exec('insertUnorderedList') }), /*#__PURE__*/
    React.createElement(EdTbBtn, { icon: "list-ordered", label: "Numbered list", onClick: () => exec('insertOrderedList') }), /*#__PURE__*/
    React.createElement(EdTbBtn, { icon: "quote", label: "Quote", active: isH('BLOCKQUOTE'), onClick: () => fmt('BLOCKQUOTE') }), /*#__PURE__*/
    React.createElement(EdTbBtn, { icon: "code", label: "Code block", active: isH('PRE'), onClick: () => fmt('PRE') }),
    edTbSep(), /*#__PURE__*/
    React.createElement(EdTbBtn, { icon: "link", label: "Insert link", onClick: insertLink }), /*#__PURE__*/
    React.createElement(EdTbBtn, { icon: "image", label: "Insert image", onClick: insertImage }), /*#__PURE__*/
    React.createElement(EdTbBtn, { icon: "remove-formatting", label: "Clear formatting", onClick: () => exec('removeFormat') })
    ), /*#__PURE__*/

    React.createElement("div", { style: { flex: 1 } }), /*#__PURE__*/
    React.createElement(EdTbBtn, { icon: showSource ? 'eye' : 'code-2', label: showSource ? 'Rich view' : 'Markdown source', active: showSource, onClick: toggleSource }), /*#__PURE__*/
    React.createElement(EdTbBtn, { text: "Done", label: "Save & close (Ctrl+S)", onClick: commitExit })
    ), /*#__PURE__*/

    React.createElement("div", { style: { flex: 1, overflowY: 'auto' } },
    showSource ? /*#__PURE__*/
    React.createElement("div", { style: edS.col }, /*#__PURE__*/
    React.createElement("textarea", { autoFocus: true, value: source, onChange: (e) => {setSource(e.target.value);bodyRef.current = e.target.value;},
      style: { display: 'block', width: '100%', minHeight: 'calc(100vh - 340px)', resize: 'none', border: 'none', background: 'transparent', color: 'var(--text-body)', fontFamily: 'var(--font-mono)', fontSize: 14, lineHeight: 1.8, padding: 0, outline: 'none', boxSizing: 'border-box', caretColor: 'var(--amber-400)' } })
    ) : /*#__PURE__*/

    React.createElement("div", { className: "ak-md", ref: ref, contentEditable: true, suppressContentEditableWarning: true,
      onKeyUp: syncBlock, onMouseUp: syncBlock,
      style: { ...edS.col, minHeight: 'calc(100vh - 320px)', outline: 'none', caretColor: accent || 'var(--amber-400)', paddingTop: 24, paddingBottom: 120 } })

    )
    ));

}

function Editor({ note, bucket, tabs, activeId, onTab, onCloseTab, onCloseOthers, onTogglePane, mode, onMode, onOpen, scope, onScope, scopeOptions, onSetScope, hideTabs, hideToolbar, accent, footer }) {
  if (bucket) {
    return (/*#__PURE__*/
      React.createElement("div", { style: edS.center },
      !hideTabs && /*#__PURE__*/React.createElement(TabStrip, { tabs: tabs, activeId: activeId, onTab: onTab, onCloseTab: onCloseTab, onCloseOthers: onCloseOthers, onTogglePane: onTogglePane }), /*#__PURE__*/
      React.createElement(BucketBody, { bucket: bucket, onOpen: onOpen })
      ));

  }
  return (/*#__PURE__*/
    React.createElement("div", { style: edS.center },
    !hideTabs && /*#__PURE__*/React.createElement(TabStrip, { tabs: tabs, activeId: activeId, onTab: onTab, onCloseTab: onCloseTab, onCloseOthers: onCloseOthers, onTogglePane: onTogglePane }),
    !hideToolbar && /*#__PURE__*/
    React.createElement("div", { style: edS.toolbar }, /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' } }, note.path || note.title + '.md'), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1 } }),
    note.tags && note.tags.length > 0 && /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '46%' } },
    note.tags.slice(0, 6).map((t) => /*#__PURE__*/React.createElement(EdBadge, { key: t, tone: "info" }, "#", t)),
    note.tags.length > 6 && /*#__PURE__*/React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' } }, "+", note.tags.length - 6)
    ), /*#__PURE__*/




    React.createElement(VisibilityControl, { note: note, onSetScope: onSetScope }),
    mode === 'edit' && /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)', whiteSpace: 'nowrap' } }, "editing \xB7 click away or \u2318S to save")

    ),





    mode === 'edit' ? /*#__PURE__*/
    React.createElement(WysiwygEditor, { note: note, accent: accent, onExit: () => onMode && onMode('read') }) : /*#__PURE__*/
    React.createElement("div", { style: edS.scroll }, /*#__PURE__*/
    React.createElement("div", { style: edS.col, onClick: () => onMode && onMode('edit'), title: "Click to edit" }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 18px', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)' } }, /*#__PURE__*/
    React.createElement("span", { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, note.path || note.title + '.md'),
    note.updated && /*#__PURE__*/React.createElement("span", { style: { flexShrink: 0 } }, "\xB7 updated ", note.updated)
    ),
    note.body.map((b, i) => /*#__PURE__*/React.createElement(Block, { key: i, b: b, note: note, onOpen: onOpen, accent: accent })),
    footer
    )
    )
    ));

}

// Small free-form (force-directed) "local graph" of a note's connections (center = this note).
// Nodes are draggable — dragging pins a node to the pointer and reheats the
// simulation, so the layout physically reacts (push/settle) like the main graph.
// `cameFromPath`: when set, the node the user just navigated FROM (via a backlink
// click) is ringed in a distinct color — a breadcrumb so clicking "back" is legible.
function EdMiniGraph({ connections, onOpen, centerLabel, cameFromPath }) {
  const [hover, setHover] = React.useState(null);
  const [, tickRender] = React.useReducer((x) => (x + 1) % 1e9, 0);
  const dataRef = React.useRef({ nodes: [], links: [] });
  const simRef = React.useRef(null);
  const svgRef = React.useRef(null);
  const draggingRef = React.useRef(null);
  const movedRef = React.useRef(false);
  const W = 120,H = 112,cx = 60,cy = 52;
  const colOf = (k) => k === 'tag' ? 'var(--amber-400)' : k === 'folder' ? 'var(--jade-500)' : 'var(--azure-500)';
  const items = connections.slice(0, 18);

  React.useEffect(() => {
    const d3 = window.d3;if (!d3) return;
    const center = { nid: '__self', fx: cx, fy: cy };
    const ns = items.map((c, i) => ({ ...c, nid: c.id || 'n' + i, x: cx + (i % 2 ? 1 : -1) * (8 + i), y: cy + (i % 3 - 1) * (8 + i) }));
    const nodes = [center, ...ns];
    const links = ns.map((c) => ({ source: '__self', target: c.nid }));
    dataRef.current = { nodes, links };
    const sim = d3.forceSimulation(nodes).
    force('charge', d3.forceManyBody().strength(-34)).
    force('link', d3.forceLink(links).id((d) => d.nid).distance(20).strength(0.75)).
    force('collide', d3.forceCollide(6.5)).
    force('x', d3.forceX(cx).strength(0.05)).
    force('y', d3.forceY(cy).strength(0.05)).
    alpha(1).alphaDecay(0.045);
    sim.on('tick', tickRender);
    simRef.current = sim;
    return () => {sim.on('tick', null);sim.stop();simRef.current = null;};
  }, [connections]);

  const { nodes, links } = dataRef.current;
  const byId = {};nodes.forEach((n) => {byId[n.nid] = n;});
  const clampX = (v) => Math.max(5, Math.min(W - 5, v));
  const clampY = (v) => Math.max(5, Math.min(H - 12, v));
  const self = byId['__self'];
  const hov = hover ? byId[hover] : null;

  // Convert a pointer event's client coords to the SVG's local viewBox space.
  const toLocal = (clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return { x: cx, y: cy };
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: cx, y: cy };
    return { x: (clientX - rect.left) / rect.width * W, y: (clientY - rect.top) / rect.height * H };
  };

  const startDrag = (n) => (e) => {
    e.stopPropagation();
    try {e.currentTarget.setPointerCapture(e.pointerId);} catch {/* not supported */}
    draggingRef.current = n.nid;
    movedRef.current = false;
    if (simRef.current) simRef.current.alphaTarget(0.5).restart();
    const p = toLocal(e.clientX, e.clientY);
    n.fx = p.x;n.fy = p.y;
    tickRender();
  };
  const onDrag = (n) => (e) => {
    if (draggingRef.current !== n.nid) return;
    movedRef.current = true;
    const p = toLocal(e.clientX, e.clientY);
    n.fx = p.x;n.fy = p.y;
    tickRender();
  };
  const endDrag = (n) => (e) => {
    if (draggingRef.current !== n.nid) return;
    draggingRef.current = null;
    n.fx = null;n.fy = null; // release back into the simulation instead of staying pinned
    if (simRef.current) simRef.current.alphaTarget(0);
    if (!movedRef.current) onOpen(n.path); // a click, not a drag
  };

  return (/*#__PURE__*/
    React.createElement("svg", { ref: svgRef, viewBox: "0 0 120 112", style: { width: '100%', height: 168, display: 'block', touchAction: 'none' } },
    links.map((l, i) => {
      const tid = l.target && l.target.nid || l.target;
      const a = self,b = byId[tid];
      if (!a || !b || a.x == null || b.x == null) return null;
      const lit = hover === tid;
      return /*#__PURE__*/React.createElement("line", { key: i, x1: clampX(a.x), y1: clampY(a.y), x2: clampX(b.x), y2: clampY(b.y),
        stroke: lit ? colOf(b.kind) : 'var(--border-strong)', strokeWidth: lit ? 1.2 : 0.55, opacity: hover && !lit ? 0.22 : 0.8 });
    }),
    nodes.filter((n) => n.nid !== '__self').map((n) => {
      if (n.x == null) return null;
      const lit = hover === n.nid;
      const isTrail = cameFromPath && n.path && String(n.path).toLowerCase() === String(cameFromPath).toLowerCase();
      return /*#__PURE__*/React.createElement("circle", { key: n.nid, cx: clampX(n.x), cy: clampY(n.y), r: lit ? 5.6 : isTrail ? 5.2 : 4, fill: colOf(n.kind),
        stroke: isTrail ? 'var(--brand-fg)' : 'var(--surface-panel)', strokeWidth: isTrail ? 1.6 : 0.6,
        opacity: hover && !lit ? 0.4 : 1, style: { cursor: 'grab' },
        onMouseEnter: () => setHover(n.nid), onMouseLeave: () => setHover((h) => h === n.nid ? null : h),
        onPointerDown: startDrag(n), onPointerMove: onDrag(n), onPointerUp: endDrag(n), onPointerCancel: endDrag(n) });
    }),
    self && self.x != null && /*#__PURE__*/React.createElement("circle", { cx: clampX(self.x), cy: clampY(self.y), r: 6.5, fill: "var(--brand-fg)", stroke: "var(--surface-panel)", strokeWidth: 1 }), /*#__PURE__*/
    React.createElement("text", { x: cx, y: 107, textAnchor: "middle", style: { fontFamily: 'var(--font-sans)', fontSize: 6.4, fontWeight: 600, fill: 'var(--text-strong)', pointerEvents: 'none' } },
    (hov ? hov.label : centerLabel || 'this note').slice(0, 32)
    )
    ));

}

function ContextPane({ note, onAsk, connections, onOpenNote, cameFromId, onHide }) {
  const [tab, setTab] = React.useState('backlinks');
  const conns = connections || [];
  return (/*#__PURE__*/
    React.createElement("div", { style: edS.context }, /*#__PURE__*/



    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px 0', justifyContent: 'flex-end' } }, /*#__PURE__*/
    React.createElement(EdIconBtn, { icon: "sparkles", label: "Chat about this note", size: "sm", onClick: onAsk }), /*#__PURE__*/
    React.createElement(EdIconBtn, { icon: "panel-right-close", label: "Hide pane", size: "sm", onClick: onHide })
    ), /*#__PURE__*/
    React.createElement("div", { style: { padding: '0 12px' } }, /*#__PURE__*/
    React.createElement(EdTabs, { value: tab, onChange: setTab, tabs: [
      { value: 'backlinks', label: 'Mentioned in', count: conns.length },
      { value: 'outline', label: 'Outline' }] }
    )
    ), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1, overflowY: 'auto', padding: 12 } },
    tab === 'backlinks' && (conns.length === 0 ? /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 12.5, color: 'var(--text-faint)', padding: '8px 8px', lineHeight: 1.5 } }, "No connections yet. Add a ", /*#__PURE__*/React.createElement("code", null, "[[wikilink]]"), " or tag and refresh.") : /*#__PURE__*/
    React.createElement(React.Fragment, null, /*#__PURE__*/
    React.createElement("div", { style: { background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', marginBottom: 10 } }, /*#__PURE__*/
    React.createElement(EdMiniGraph, { connections: conns, centerLabel: note.title, onOpen: (p) => onOpenNote && onOpenNote(p), cameFromPath: cameFromId })
    ), /*#__PURE__*/
    React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)', margin: '0 4px 6px' } }, conns.length, " connection", conns.length !== 1 ? 's' : '', " \xB7 click to open"),
    conns.map((c, i) => {
      const meta = c.kind === 'folder' ? { lbl: 'Same folder', sub: 'sits in the same folder', icon: 'folder', col: 'var(--jade-500)' } :
      c.kind === 'tag' ? { lbl: 'Shared tag', sub: 'shares a #tag', icon: 'hash', col: 'var(--amber-400)' } :
      c.dir === 'in' ? { lbl: 'Mentions this', sub: 'links to this note', icon: 'corner-down-left', col: 'var(--azure-500)' } :
      { lbl: 'Outgoing link', sub: 'this note links to it', icon: 'corner-up-right', col: 'var(--azure-500)' };
      return (/*#__PURE__*/
        React.createElement("div", { key: c.id || i, onClick: () => onOpenNote && onOpenNote(c.path), title: meta.sub, style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 9px', borderRadius: 'var(--radius-sm)', cursor: 'pointer' },
          onMouseEnter: (e) => e.currentTarget.style.background = 'var(--surface-hover)',
          onMouseLeave: (e) => e.currentTarget.style.background = 'transparent' }, /*#__PURE__*/
        React.createElement("span", { style: { width: 26, height: 26, flexShrink: 0, borderRadius: 'var(--radius-sm)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-inset)', border: '1px solid var(--border)' } }, /*#__PURE__*/
        React.createElement(EdIcon, { name: meta.icon, size: 13, style: { color: meta.col } })
        ), /*#__PURE__*/
        React.createElement("div", { style: { minWidth: 0, flex: 1 } }, /*#__PURE__*/
        React.createElement("div", { style: { fontSize: 13, fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, c.label), /*#__PURE__*/
        React.createElement("div", { style: { fontSize: 11, color: 'var(--text-faint)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 5 } }, /*#__PURE__*/
        React.createElement("span", { style: { width: 6, height: 6, borderRadius: '50%', background: meta.col, flexShrink: 0 } }), meta.lbl
        )
        ), /*#__PURE__*/
        React.createElement(EdIcon, { name: "arrow-up-right", size: 13, style: { color: 'var(--text-faint)', flexShrink: 0 } })
        ));

    })
    )),

    tab === 'outline' && note.outline.map((h, i) => /*#__PURE__*/
    React.createElement("div", { key: i, style: { padding: '6px 8px', paddingLeft: 8 + (i === 0 ? 0 : 14), fontSize: 13, color: i === 0 ? 'var(--text-strong)' : 'var(--text-muted)', fontWeight: i === 0 ? 600 : 400, cursor: 'pointer' } }, h)
    )
    ), /*#__PURE__*/
    React.createElement("div", { style: { padding: 12, borderTop: '1px solid var(--divider)' } }, /*#__PURE__*/
    React.createElement("button", { onClick: onAsk, style: {
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        height: 34, border: '1px solid var(--brand-soft-border)', background: 'var(--brand-soft-bg)',
        color: 'var(--brand-fg)', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
        fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600
      } }, /*#__PURE__*/
    React.createElement(EdIcon, { name: "sparkles", size: 15 }), "Ask about this note"
    )
    )
    ));

}

// Floating local-graph card — the same EdMiniGraph as the context pane, but
// floated over the editor ("in the notebook"). Collapsible; hidden when the note
// has no connections. Positioned by its parent (an absolute-in-relative container).
function FloatingGraph({ note, connections, onOpenNote, cameFromId }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const conns = connections || [];
  if (!note || conns.length === 0) return null;
  return (/*#__PURE__*/
    React.createElement("div", { style: {
        position: 'absolute', right: 16, bottom: 16, zIndex: 20,
        width: collapsed ? 'auto' : 210,
        background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)', overflow: 'hidden'
      } }, /*#__PURE__*/
    React.createElement("div", { onClick: () => setCollapsed((c) => !c),
      style: { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 9px', cursor: 'pointer',
        borderBottom: collapsed ? 'none' : '1px solid var(--divider)' } }, /*#__PURE__*/
    React.createElement(EdIcon, { name: "network", size: 13, style: { color: 'var(--brand-fg)' } }), /*#__PURE__*/
    React.createElement("span", { style: { flex: 1, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' } },
    conns.length, " connection", conns.length !== 1 ? 's' : ''
    ), /*#__PURE__*/
    React.createElement(EdIcon, { name: collapsed ? 'chevron-up' : 'chevron-down', size: 13, style: { color: 'var(--text-faint)' } })
    ),
    !collapsed && /*#__PURE__*/
    React.createElement("div", { style: { padding: 6 } }, /*#__PURE__*/
    React.createElement(EdMiniGraph, { connections: conns, centerLabel: note.title, onOpen: (p) => onOpenNote && onOpenNote(p), cameFromPath: cameFromId }), /*#__PURE__*/
    React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--text-faint)', textAlign: 'center', marginTop: 2 } }, "click a node to open")
    )

    ));

}

Object.assign(window, { LoreEditor: Editor, LoreContextPane: ContextPane, LoreFloatingGraph: FloatingGraph });