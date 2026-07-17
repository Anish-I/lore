function _extends() {return _extends = Object.assign ? Object.assign.bind() : function (n) {for (var e = 1; e < arguments.length; e++) {var t = arguments[e];for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]);}return n;}, _extends.apply(null, arguments);} /* global React */
// Lore desktop — Ask panel (docked 392px, Hybrid design): cited recall chatbot,
// "FROM THESE PAGES" receipts card, About/Looking-in context chip composer.
const akNS = window.VaultDesignSystem_ffbf58;
const { Icon: AkIcon, IconButton: AkIconBtn, EvidenceRow, Kbd: AkKbd } = akNS;

// Render final answers as real Markdown (headings/lists/code/bold) — not a flat word blob.
const akMd = window.markdownit ? window.markdownit({ html: false, linkify: true, breaks: true }) : null;
if (typeof document !== 'undefined' && !document.getElementById('ak-md-style')) {
  const s = document.createElement('style');s.id = 'ak-md-style';
  s.textContent = `.ak-md{font-size:13.5px;line-height:1.62;color:var(--text-body)}.ak-md>:first-child{margin-top:0}.ak-md>:last-child{margin-bottom:0}.ak-md p{margin:0 0 9px}.ak-md h1,.ak-md h2,.ak-md h3,.ak-md h4{color:var(--text-strong);font-weight:600;line-height:1.3;margin:14px 0 6px}.ak-md h1{font-size:16px}.ak-md h2{font-size:15px}.ak-md h3{font-size:14px}.ak-md ul,.ak-md ol{margin:4px 0 9px;padding-left:20px}.ak-md li{margin:3px 0}.ak-md li>ul,.ak-md li>ol{margin:3px 0}.ak-md code{background:var(--surface-inset);border:1px solid var(--border);border-radius:4px;padding:1px 5px;font-family:var(--font-mono);font-size:12px}.ak-md pre{background:var(--surface-inset);border:1px solid var(--border);border-radius:var(--radius-md);padding:11px 13px;overflow-x:auto;margin:9px 0}.ak-md pre code{background:none;border:none;padding:0;font-size:12px}.ak-md strong{color:var(--text-strong);font-weight:600}.ak-md a{color:var(--brand-fg);text-decoration:none}.ak-md blockquote{border-left:3px solid var(--border-strong);margin:9px 0;padding:2px 0 2px 13px;color:var(--text-muted)}.ak-md hr{border:none;border-top:1px solid var(--divider);margin:12px 0}.ak-md table{border-collapse:collapse;margin:9px 0;font-size:12.5px}.ak-md th,.ak-md td{border:1px solid var(--border);padding:5px 9px;text-align:left}` +
  `.ak-ref{color:var(--brand-fg);border-bottom:1px dotted var(--brand-fg);cursor:help;}` +
  `.ak-caret{display:inline-block;width:7px;height:15px;background:var(--amber-400);vertical-align:-2px;margin-left:2px;animation:lore-caret 1s step-end infinite;}`;
  document.head.appendChild(s);
}
function akEscapeHtml(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// refs: [{title, preview}] — every "[Title]" the model cited becomes a marked
// span whose hover shows what that note actually says (the retrieved passage).
function AkMarkdown({ text, refs }) {
  if (!akMd) return /*#__PURE__*/React.createElement("span", { style: { whiteSpace: 'pre-wrap' } }, text);
  let html = akMd.render(String(text || ''));
  (refs || []).forEach((r) => {
    if (!r || !r.title) return;
    const esc = akEscapeHtml(r.title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const preview = akEscapeHtml((r.preview || '').replace(/\s+/g, ' ').trim());
    if (!preview) return;
    html = html.replace(new RegExp('\\[' + esc + '\\]', 'g'),
    `<span class="ak-ref" title="${preview}">${akEscapeHtml(r.title)}</span>`);
  });
  return /*#__PURE__*/React.createElement("div", { className: "ak-md", dangerouslySetInnerHTML: { __html: html } });
}

const akS = {
  panel: { width: 'var(--ask-width)', flexShrink: 0, background: 'var(--surface-panel)', borderLeft: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--divider)', flexShrink: 0 },
  scroll: { flex: 1, overflowY: 'auto', padding: '12px 14px 10px' },
  composerWrap: { position: 'relative', flexShrink: 0, padding: '10px 14px 14px' },
  scrim: { position: 'absolute', left: 0, right: 0, top: -22, height: 22, background: 'var(--scrim-to-panel)', pointerEvents: 'none' },
  composer: { border: '1px solid var(--border-field)', borderRadius: 12, background: 'var(--surface-canvas)', padding: 10 }
};

function akPlaceOf(scope) {
  const s = String(scope || '').toLowerCase();
  if (s === 'team') return 'team';
  if (s === 'company' || s === 'enterprise') return 'company';
  return 'my';
}

function AnswerRuns({ runs }) {
  return runs.map((r, i) => {
    if (r.mark) return /*#__PURE__*/React.createElement("mark", { key: i, style: { background: 'var(--highlight-bg)', color: 'var(--text-strong)', borderRadius: 2, padding: '0 2px' } }, r.x);
    return /*#__PURE__*/React.createElement("span", { key: i }, r.x);
  });
}

function Evidence({ rows }) {
  const [open, setOpen] = React.useState(false); // consolidated: opt-in detail
  const [showAll, setShowAll] = React.useState(false);
  return (/*#__PURE__*/
    React.createElement("div", { style: { borderTop: '1px solid var(--divider)' } }, /*#__PURE__*/
    React.createElement("button", { onClick: () => setOpen(!open), style: {
        width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
        border: 'none', background: 'transparent', cursor: 'pointer',
        fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)'
      } }, /*#__PURE__*/
    React.createElement(AkIcon, { name: "git-commit-horizontal", size: 12 }), /*#__PURE__*/
    React.createElement("span", null, "why retrieved \xB7 ", rows.length, " chunks"), /*#__PURE__*/
    React.createElement(AkIcon, { name: "chevron-down", size: 12, style: { marginLeft: 'auto', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform var(--dur-fast) var(--ease-out)' } })
    ),
    open && /*#__PURE__*/
    React.createElement("div", { style: { padding: '2px 4px 6px' } },
    (showAll ? rows : rows.slice(0, 4)).map((r) => /*#__PURE__*/React.createElement(EvidenceRow, _extends({ key: r.index }, r, { onOpen: () => {} }))),
    rows.length > 4 && /*#__PURE__*/
    React.createElement("button", { onClick: () => setShowAll((v) => !v), style: { border: 'none', background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10.5, padding: '4px 8px' } },
    showAll ? 'show less' : `show all ${rows.length}`
    )

    )

    ));

}

// "FROM THESE PAGES" receipts card — the answer's cited pages, clickable, with
// place labels. Right-click a private row to push that note to the team.
function CitationSources({ citations, evidence, onCiteScope, onOpenCitation }) {
  const list = citations || [];
  const [expanded, setExpanded] = React.useState(false);
  const meta = window.LorePlaceMeta || {};
  const seen = new Set();
  const unique = list.filter((c) => {
    if (!c || !c.note_id || seen.has(c.note_id)) return false;
    seen.add(c.note_id);
    return true;
  });
  if (!unique.length && !(evidence && evidence.length)) return null;
  const visible = expanded ? unique : unique.slice(0, 5);
  const hidden = unique.length - visible.length;
  return (/*#__PURE__*/
    React.createElement("div", { style: { margin: '6px 0 10px 34px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-base)', overflow: 'hidden' } },
    unique.length > 0 && /*#__PURE__*/
    React.createElement("div", { style: { padding: '9px 12px 4px', fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.07em', color: 'var(--text-faint)' } }, "FROM THESE PAGES"),

    visible.map((c) => {
      const pm = meta[akPlaceOf(c.scope)] || meta.my || {};
      return (/*#__PURE__*/
        React.createElement("div", { key: c.note_id,
          onClick: () => onOpenCitation && onOpenCitation(c),
          title: `${c.preview ? String(c.preview).replace(/\s+/g, ' ').trim() : c.heading_path || c.title || ''}${onCiteScope && akPlaceOf(c.scope) === 'my' ? '\n\n(right-click to push to your team)' : ''}`,
          onContextMenu: (e) => {
            e.preventDefault();
            if (!onCiteScope || akPlaceOf(c.scope) !== 'my') return;
            if (window.confirm(`Push “${c.title}” to your team?`)) onCiteScope(c, 'team');
          },
          style: { display: 'flex', alignItems: 'center', gap: 9, padding: '7px 12px', cursor: onOpenCitation ? 'pointer' : 'default' },
          onMouseEnter: (e) => e.currentTarget.style.background = 'var(--surface-hover)',
          onMouseLeave: (e) => e.currentTarget.style.background = 'transparent' }, /*#__PURE__*/
        React.createElement(AkIcon, { name: pm.icon || 'lock', size: 13, style: { color: pm.fg || 'var(--text-faint)', flexShrink: 0 } }), /*#__PURE__*/
        React.createElement("span", { style: { flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, c.title || c.note_id), /*#__PURE__*/
        React.createElement("span", { style: { fontSize: 10.5, color: pm.fg || 'var(--text-faint)', flexShrink: 0 } }, pm.label || ''), /*#__PURE__*/
        React.createElement(AkIcon, { name: "arrow-up-right", size: 12, style: { color: 'var(--text-faint)', flexShrink: 0 } })
        ));

    }),
    hidden > 0 && /*#__PURE__*/
    React.createElement("button", { onClick: () => setExpanded(true), style: { display: 'block', padding: '4px 12px 8px', border: 'none', background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10.5 } }, "+", hidden, " more"),

    evidence && evidence.length > 0 && /*#__PURE__*/React.createElement(Evidence, { rows: evidence })
    ));

}

function AskHistoryDrawer({ threads, onResume, onDelete, onClose }) {
  const ago = (iso) => {
    const d = Date.parse(iso);
    if (Number.isNaN(d)) return '';
    const s = Math.max(0, Math.round((Date.now() - d) / 1000));
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  };
  return (/*#__PURE__*/
    React.createElement(React.Fragment, null, /*#__PURE__*/
    React.createElement("div", { style: { position: 'fixed', inset: 0, zIndex: 40 }, onClick: onClose }), /*#__PURE__*/
    React.createElement("div", { style: { position: 'absolute', top: 'calc(100% + 4px)', right: 8, zIndex: 41, width: 280, maxHeight: 340, overflowY: 'auto', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-xl)' } }, /*#__PURE__*/
    React.createElement("div", { style: { padding: '7px 10px', borderBottom: '1px solid var(--divider)', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em' } }, "Past conversations"),
    threads === null && /*#__PURE__*/React.createElement("div", { style: { padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' } }, "Loading\u2026"),
    Array.isArray(threads) && threads.length === 0 && /*#__PURE__*/
    React.createElement("div", { style: { padding: '12px 12px', fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.5 } }, "No saved conversations yet \u2014 ask something and it lands here."),

    (threads || []).map((t) => /*#__PURE__*/
    React.createElement("div", { key: t.thread_id, onClick: () => {onClose();onResume(t.thread_id);},
      style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer' },
      onMouseEnter: (e) => e.currentTarget.style.background = 'var(--surface-hover)',
      onMouseLeave: (e) => e.currentTarget.style.background = 'transparent' }, /*#__PURE__*/
    React.createElement(AkIcon, { name: "message-circle", size: 13, style: { color: 'var(--brand-fg)', flexShrink: 0 } }), /*#__PURE__*/
    React.createElement("div", { style: { minWidth: 0, flex: 1 } }, /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 12.5, color: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t.title), /*#__PURE__*/
    React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', marginTop: 1 } }, t.count, " turn", t.count === 1 ? '' : 's', t.updated_at ? ` · ${ago(t.updated_at)}` : '')
    ), /*#__PURE__*/
    React.createElement("span", { onClick: (e) => {e.stopPropagation();onDelete(t.thread_id);}, title: "Delete this conversation",
      style: { display: 'inline-flex', padding: 3, borderRadius: 3, color: 'var(--text-faint)', cursor: 'pointer' },
      onMouseEnter: (e) => {e.currentTarget.style.color = 'var(--clay-400)';},
      onMouseLeave: (e) => {e.currentTarget.style.color = 'var(--text-faint)';} }, /*#__PURE__*/
    React.createElement(AkIcon, { name: "trash-2", size: 12 })
    )
    )
    )
    )
    ));

}

// User bubble (right, mockup radius) and answer row (sparkles avatar + content).
function AkUserBubble({ children }) {
  return (/*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', justifyContent: 'flex-end', margin: '10px 0' } }, /*#__PURE__*/
    React.createElement("div", { style: {
        maxWidth: '85%', padding: '9px 13px', background: 'var(--obsidian-720)',
        borderRadius: '12px 12px 3px 12px', color: 'var(--text-strong)', fontSize: 13.5, lineHeight: 1.5,
        border: '1px solid var(--border-subtle)'
      } }, children)
    ));

}
function AkAnswerRow({ children, streaming }) {
  return (/*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', gap: 10, margin: '12px 0', animation: 'lore-fade-in 160ms ease' } }, /*#__PURE__*/
    React.createElement("span", { style: { width: 24, height: 24, flexShrink: 0, marginTop: 2, borderRadius: 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)' } }, /*#__PURE__*/
    React.createElement(AkIcon, { name: "sparkles", size: 13, style: { color: 'var(--brand-fg)' } })
    ), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: 1.62, color: 'var(--text-body)' } },
    children,
    streaming && /*#__PURE__*/React.createElement("span", { className: "ak-caret" })
    )
    ));

}

function AskPanel({ messages, asking, suggestions, onSend, onClose, source, onSource, sourceOptions, identityReady, onSetup,
  threads, onLoadThreads, onResumeThread, onDeleteThread, onNewChat, onCiteScope, onOpenCitation, providers, defaultProvider,
  ctx, onClearCtx, scopeChip, inline }) {
  const [draft, setDraft] = React.useState('');
  // Answering engine = the user's own subscriptions/key (same providers as
  // Settings -> AI provider), defaulting to their Settings choice. 'local' is
  // the on-device fallback (Ollama) and always offered.
  const AK_PROVIDERS = [
  { id: 'claude', label: 'Claude (your subscription)' },
  { id: 'codex', label: 'Codex (your subscription)' },
  { id: 'byok', label: 'Your API key' },
  { id: 'local', label: 'On-device (fallback)' }];

  const available = AK_PROVIDERS.filter((p) => p.id === 'local' || providers && providers[p.id]);
  const [model, setModel] = React.useState(null); // provider id; null until defaulted
  const provider = model || (available.some((p) => p.id === defaultProvider) ? defaultProvider : available[0] && available[0].id);
  const providerLabel = (AK_PROVIDERS.find((p) => p.id === provider) || {}).label || provider || 'auto';
  const [cog, setCog] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const akSel = { width: '100%', marginTop: 4, padding: '5px 7px', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-strong)', fontFamily: 'var(--font-mono)', fontSize: 11.5, outline: 'none' };
  const scrollRef = React.useRef(null);
  React.useEffect(() => {if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;}, [messages, asking]);
  const send = (q) => {const v = (q ?? draft).trim();if (!v || asking || !identityReady) return;setDraft('');onSend(v, null, provider === 'local' ? null : provider);};
  const openHistory = () => {
    setHistoryOpen((o) => {
      const next = !o;
      if (next && onLoadThreads) onLoadThreads();
      return next;
    });
  };

  // Inline mode: the home area's MAIN chat — full width on the canvas, content
  // centered in a reading column, with visible History + Model buttons.
  const panelStyle = inline ?
  { flex: 1, minWidth: 0, background: 'var(--surface-canvas)', display: 'flex', flexDirection: 'column' } :
  akS.panel;
  const colStyle = inline ? { maxWidth: 760, width: '100%', margin: '0 auto' } : { width: '100%' };
  const modelBtn = /*#__PURE__*/
  React.createElement("div", { style: { position: 'relative' } }, /*#__PURE__*/
  React.createElement("button", { onClick: () => setCog((c) => !c), title: "Choose the answering model & source",
    style: { display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 8, background: cog ? 'var(--surface-raised)' : 'transparent', color: 'var(--text-body)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 12 } }, /*#__PURE__*/
  React.createElement(AkIcon, { name: "cpu", size: 13, style: { color: 'var(--brand-fg)' } }), /*#__PURE__*/
  React.createElement("span", { style: { maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, providerLabel), /*#__PURE__*/
  React.createElement(AkIcon, { name: "chevron-down", size: 12, style: { color: 'var(--text-faint)' } })
  ),
  cog && /*#__PURE__*/
  React.createElement(React.Fragment, null, /*#__PURE__*/
  React.createElement("div", { onClick: () => setCog(false), style: { position: 'fixed', inset: 0, zIndex: 40 } }), /*#__PURE__*/
  React.createElement("div", { style: { position: 'absolute', top: 'calc(100% + 4px)', right: 0, width: 232, padding: 11, background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', zIndex: 41, display: 'flex', flexDirection: 'column', gap: 10 } }, /*#__PURE__*/
  React.createElement("label", { style: { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)' } }, "Model", /*#__PURE__*/
  React.createElement("select", { value: provider, onChange: (e) => setModel(e.target.value), style: akSel },
  available.map((m) => /*#__PURE__*/React.createElement("option", { key: m.id, value: m.id }, m.label))
  )
  ), /*#__PURE__*/
  React.createElement("label", { style: { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)' } }, "Source", /*#__PURE__*/
  React.createElement("select", { value: source || 'all', onChange: (e) => onSource && onSource(e.target.value), style: akSel },
  (sourceOptions && sourceOptions.length ? sourceOptions : [{ value: 'all', label: 'All configured' }]).map((o) => /*#__PURE__*/React.createElement("option", { key: o.value, value: o.value }, o.label))
  )
  )
  )
  )

  );


  return (/*#__PURE__*/
    React.createElement("div", { style: panelStyle }, /*#__PURE__*/
    React.createElement("div", { style: { ...akS.header, position: 'relative', ...(inline ? { padding: '10px 20px' } : {}) } },
    inline && onClose && /*#__PURE__*/
    React.createElement("button", { onClick: onClose, title: "Back to your pages",
      style: { display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-body)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 12, flexShrink: 0 } }, /*#__PURE__*/
    React.createElement(AkIcon, { name: "arrow-left", size: 14 }), "Pages"
    ), /*#__PURE__*/

    React.createElement("span", { style: { width: 30, height: 30, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)', flexShrink: 0 } }, /*#__PURE__*/
    React.createElement(AkIcon, { name: "sparkles", size: 16, style: { color: 'var(--brand-fg)' } })
    ), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' } }, "Ask Lore"), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 11, color: 'var(--text-faint)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, "Answers only from your pages \u2014 with receipts")
    ),
    inline && modelBtn,
    onNewChat && messages.length > 0 && /*#__PURE__*/React.createElement(AkIconBtn, { icon: "plus", label: "New conversation", size: "sm", onClick: onNewChat }),
    onResumeThread && (inline ? /*#__PURE__*/
    React.createElement("button", { onClick: openHistory, title: "Past conversations", style: { display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-body)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 12 } }, /*#__PURE__*/React.createElement(AkIcon, { name: "history", size: 13 }), "History") : /*#__PURE__*/
    React.createElement(AkIconBtn, { icon: "history", label: "Past conversations", size: "sm", onClick: openHistory })),
    !inline && onClose && /*#__PURE__*/React.createElement(AkIconBtn, { icon: "x", label: "Close Ask", size: "sm", onClick: onClose }),
    historyOpen && /*#__PURE__*/
    React.createElement(AskHistoryDrawer, { threads: threads, onClose: () => setHistoryOpen(false),
      onResume: onResumeThread, onDelete: (id) => {if (onDeleteThread) onDeleteThread(id);} })

    ), /*#__PURE__*/

    React.createElement("div", { style: akS.scroll, ref: scrollRef }, /*#__PURE__*/
    React.createElement("div", { style: colStyle },
    messages.length === 0 && /*#__PURE__*/
    React.createElement("div", { style: { padding: '20px 6px' } }, /*#__PURE__*/
    React.createElement("img", { src: "design/assets/sprites/lore-familiar.png", alt: "", "aria-hidden": "true",
      style: { display: 'block', width: 120, height: 120, margin: '0 auto 10px', objectFit: 'contain', filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.28))', pointerEvents: 'none', userSelect: 'none' } }), /*#__PURE__*/
    React.createElement("p", { style: { fontSize: 15.5, fontWeight: 600, color: 'var(--text-strong)', margin: '0 0 4px', textAlign: 'center' } },
    ctx ? ctx.section ? `Ask within ${ctx.title}` : `Ask about “${ctx.title}”` : 'Ask across your pages.'
    ), /*#__PURE__*/
    React.createElement("p", { style: { fontSize: 12.5, color: 'var(--text-subtle)', margin: '0 0 16px', lineHeight: 1.5, textAlign: 'center' } }, "Answers are drawn only from pages you can see, and every claim is cited."),
    !identityReady && /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 10, padding: 12, marginBottom: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface-inset)', textAlign: 'left' } }, /*#__PURE__*/
    React.createElement(AkIcon, { name: "alert-circle", size: 15, style: { color: 'var(--brand-fg)', flexShrink: 0 } }), /*#__PURE__*/
    React.createElement("span", { style: { flex: 1, fontSize: 12.5, color: 'var(--text-body)', lineHeight: 1.45 } }, "Finish setup before asking Lore."), /*#__PURE__*/
    React.createElement("button", { onClick: onSetup, style: { border: '1px solid var(--border)', background: 'var(--surface-raised)', color: 'var(--text-body)', borderRadius: 'var(--radius-sm)', padding: '5px 9px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11 } }, "Configure")
    ), /*#__PURE__*/

    React.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: 7 } },
    (suggestions || []).slice(0, 3).map((s) => /*#__PURE__*/
    React.createElement("button", { key: s, onClick: () => send(s), disabled: !identityReady || asking, style: {
        textAlign: 'left', display: 'flex', alignItems: 'center', gap: 9, padding: '8px 13px',
        border: '1px solid var(--border)', background: 'var(--surface-base)', borderRadius: 999,
        color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', fontSize: 12.5, cursor: identityReady ? 'pointer' : 'not-allowed', opacity: identityReady ? 1 : 0.5
      } }, /*#__PURE__*/
    React.createElement(AkIcon, { name: "message-circle-question", size: 13, style: { color: 'var(--text-faint)', flexShrink: 0 } }), /*#__PURE__*/
    React.createElement("span", { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s)
    )
    )
    )
    ),




    messages.map((m, i) =>
    m.role === 'user' ? /*#__PURE__*/
    React.createElement(AkUserBubble, { key: i }, m.text) : /*#__PURE__*/

    React.createElement("div", { key: i }, /*#__PURE__*/
    React.createElement(AkAnswerRow, { streaming: m.streaming },
    m.streaming ? /*#__PURE__*/
    React.createElement(AnswerRuns, { runs: m.shown || m.runs || [] }) : /*#__PURE__*/
    React.createElement(AkMarkdown, { text: m.text || (m.shown || m.runs || []).map((r) => r.x).join(''), refs: m.citations })
    ),
    !m.streaming && m.scopes && /*#__PURE__*/
    React.createElement("div", { style: { margin: '-6px 0 6px 34px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)' } }, m.scopes),

    !m.streaming && /*#__PURE__*/
    React.createElement(CitationSources, { citations: m.citations, evidence: m.evidence, onCiteScope: onCiteScope, onOpenCitation: onOpenCitation }),

    !m.streaming && m.conflicts && m.conflicts.length > 0 && /*#__PURE__*/
    React.createElement("div", { style: { margin: '0 0 10px 34px', display: 'flex', flexDirection: 'column', gap: 5 } },
    m.conflicts.slice(0, 3).map((cf, ci) => /*#__PURE__*/
    React.createElement("div", { key: ci, style: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 10px', borderRadius: 9, border: '1px solid var(--warning-border)', background: 'var(--warning-bg)' } }, /*#__PURE__*/
    React.createElement(AkIcon, { name: "alert-triangle", size: 13, style: { color: 'var(--warning-fg)', flexShrink: 0, marginTop: 1 } }), /*#__PURE__*/
    React.createElement("span", { style: { fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-body)', minWidth: 0 } }, "Sources disagree:",
    ' ', /*#__PURE__*/
    React.createElement("span", { onClick: () => onOpenCitation && onOpenCitation({ note_id: cf.a_id, title: cf.a_title }), style: { color: 'var(--warning-fg)', fontWeight: 600, cursor: onOpenCitation ? 'pointer' : 'default' } }, cf.a_title),
    ' ', "contradicts", ' ', /*#__PURE__*/
    React.createElement("span", { onClick: () => onOpenCitation && onOpenCitation({ note_id: cf.b_id, title: cf.b_title }), style: { color: 'var(--warning-fg)', fontWeight: 600, cursor: onOpenCitation ? 'pointer' : 'default' } }, cf.b_title),
    cf.evidence ? /*#__PURE__*/React.createElement("span", { style: { color: 'var(--text-subtle)' } }, " \u2014 \u201C", cf.evidence.slice(0, 160), "\u201D") : null
    )
    )
    )
    )

    )

    ),
    ctx && ctx.section && messages.length > 0 && !asking && (suggestions || []).length > 0 && /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 6, margin: '2px 0 12px 34px' } },
    (suggestions || []).slice(0, 4).map((s) => /*#__PURE__*/
    React.createElement("button", { key: s, onClick: () => send(s), style: {
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px',
        border: '1px solid var(--border)', background: 'var(--surface-base)', borderRadius: 999,
        color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', fontSize: 12, cursor: 'pointer'
      } }, /*#__PURE__*/
    React.createElement(AkIcon, { name: "corner-down-right", size: 12, style: { color: 'var(--text-faint)', flexShrink: 0 } }), /*#__PURE__*/
    React.createElement("span", { style: { maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s)
    )
    )
    )

    )
    ), /*#__PURE__*/

    React.createElement("div", { style: akS.composerWrap }, /*#__PURE__*/
    React.createElement("div", { style: akS.scrim }), /*#__PURE__*/
    React.createElement("div", { style: inline ? { ...akS.composer, maxWidth: 760, margin: '0 auto' } : akS.composer }, /*#__PURE__*/
    React.createElement("textarea", {
      value: draft, onChange: (e) => setDraft(e.target.value), rows: 2,
      onKeyDown: (e) => {if (e.key === 'Enter' && !e.shiftKey) {e.preventDefault();send();}},
      "aria-label": "Ask Lore question",
      placeholder: identityReady ? ctx ? ctx.section ? `Ask within ${ctx.title}…` : `Ask about “${ctx.title}”…` : 'Ask anything about your pages…' : 'Finish setup to ask Lore…',
      style: { width: '100%', resize: 'none', border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--font-sans)', fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-strong)' } }
    ), /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 7, marginTop: 6, position: 'relative', minWidth: 0 } },

    ctx ? /*#__PURE__*/
    React.createElement("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, padding: '3px 9px', borderRadius: 999, border: '1px solid var(--brand-soft-border)', background: 'var(--brand-soft-bg)', color: 'var(--brand-fg)', fontSize: 11 } }, /*#__PURE__*/
    React.createElement(AkIcon, { name: ctx.section ? 'folder-open' : 'file-text', size: 11, style: { flexShrink: 0 } }), /*#__PURE__*/
    React.createElement("span", { style: { maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, ctx.section ? 'Section' : 'About', ": ", ctx.title),
    onClearCtx && /*#__PURE__*/
    React.createElement("span", { onClick: onClearCtx, title: "Clear page context", style: { display: 'inline-flex', cursor: 'pointer', opacity: 0.7 } }, /*#__PURE__*/
    React.createElement(AkIcon, { name: "x", size: 11 })
    )

    ) :
    scopeChip ? /*#__PURE__*/
    React.createElement("button", { onClick: scopeChip.onCycle || undefined, title: scopeChip.onCycle ? 'Switch where Lore looks' : undefined,
      style: { display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, padding: '3px 9px', borderRadius: 999, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, cursor: scopeChip.onCycle ? 'pointer' : 'default', fontFamily: 'var(--font-sans)' } }, /*#__PURE__*/
    React.createElement(AkIcon, { name: "telescope", size: 11, style: { flexShrink: 0 } }), /*#__PURE__*/
    React.createElement("span", { style: { maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, "Looking in: ", scopeChip.label)
    ) :
    null,
    !inline && /*#__PURE__*/
    React.createElement("button", { onClick: () => setCog((c) => !c), title: "Model, source & citations", style: { display: 'inline-flex', alignItems: 'center', gap: 5, height: 24, padding: '0 8px', border: '1px solid var(--border)', borderRadius: 999, background: cog ? 'var(--surface-raised)' : 'transparent', color: 'var(--text-faint)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10 } }, /*#__PURE__*/
    React.createElement(AkIcon, { name: "sliders-horizontal", size: 11 })
    ), /*#__PURE__*/

    React.createElement("div", { style: { flex: 1 } }), /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)', flexShrink: 0 } }, /*#__PURE__*/React.createElement(AkKbd, null, "\u21B5")), /*#__PURE__*/
    React.createElement("button", { onClick: () => send(), disabled: asking || !identityReady || !draft.trim(), "aria-label": "Send question", style: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, flexShrink: 0,
        border: 'none', borderRadius: 9, cursor: asking || !identityReady || !draft.trim() ? 'not-allowed' : 'pointer',
        background: 'var(--brand-bg)', color: 'var(--text-onbrand)', opacity: asking || !identityReady || !draft.trim() ? 0.5 : 1
      } }, /*#__PURE__*/React.createElement(AkIcon, { name: "arrow-up", size: 16 })),

    !inline && cog && /*#__PURE__*/
    React.createElement("div", { style: { position: 'absolute', bottom: 32, left: 0, width: 232, padding: 11, background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', zIndex: 20, display: 'flex', flexDirection: 'column', gap: 10 } }, /*#__PURE__*/
    React.createElement("label", { style: { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)' } }, "Model", /*#__PURE__*/
    React.createElement("select", { value: provider, onChange: (e) => setModel(e.target.value), style: akSel },
    available.map((m) => /*#__PURE__*/React.createElement("option", { key: m.id, value: m.id }, m.label))
    )
    ), /*#__PURE__*/
    React.createElement("label", { style: { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)' } }, "Source", /*#__PURE__*/
    React.createElement("select", { value: source || 'all', onChange: (e) => onSource && onSource(e.target.value), style: akSel },
    (sourceOptions && sourceOptions.length ? sourceOptions : [{ value: 'all', label: 'All configured' }]).map((o) => /*#__PURE__*/React.createElement("option", { key: o.value, value: o.value }, o.label))
    )
    )
    )

    )
    )
    )
    ));

}

window.LoreAskPanel = AskPanel;