/* global React */
// Lore desktop — Hybrid Wizards view (860px centered card grid + create tile)
// and the right-hand wizard chat drawer. Real data: wizards.personal.* and the
// catalog; creation uses the existing chat-driven LoreWizardBuilder
// (search-first → createFromNotes).
const wzNS = window.VaultDesignSystem_ffbf58;
const WzIcon = wzNS.Icon;

function WzButton({ icon, children, onClick, variant, disabled, style: extra }) {
  const [hover, setHover] = React.useState(false);
  const base = variant === 'amber-ghost' ?
  { background: hover ? 'rgba(217,154,43,0.2)' : 'var(--brand-soft-bg)', color: 'var(--brand-fg)', border: '1px solid var(--brand-soft-border)' } :
  { background: 'transparent', color: 'var(--text-primary)', border: `1px solid ${hover ? 'var(--border-strong)' : 'var(--border)'}` };
  return (/*#__PURE__*/
    React.createElement("button", { onClick: onClick, disabled: disabled,
      onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
      style: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 32,
        padding: '0 13px', borderRadius: 8, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
        fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', ...base, ...(extra || {})
      } },
    icon && /*#__PURE__*/React.createElement(WzIcon, { name: icon, size: 14 }),
    children
    ));

}

function WizardCard({ name, meta, teamBadge, onChat, extraAction }) {
  const [hover, setHover] = React.useState(false);
  return (/*#__PURE__*/
    React.createElement("div", { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
      style: {
        display: 'flex', flexDirection: 'column', gap: 12, padding: 18, borderRadius: 14,
        border: `1px solid ${hover ? 'var(--border-strong)' : 'var(--border)'}`,
        background: 'var(--surface-panel)', transition: 'border-color 100ms ease'
      } }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 11 } }, /*#__PURE__*/
    React.createElement("span", { style: { width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)' } }, /*#__PURE__*/
    React.createElement(WzIcon, { name: "wand-2", size: 17, style: { color: 'var(--brand-fg)' } })
    ), /*#__PURE__*/
    React.createElement("div", { style: { minWidth: 0, flex: 1 } }, /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 14, fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, name), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, meta)
    ),
    teamBadge && /*#__PURE__*/
    React.createElement("span", { style: { flexShrink: 0, fontSize: 10.5, fontWeight: 600, color: 'var(--place-team-fg)', background: 'var(--place-team-tint)', border: '1px solid var(--place-team-border)', borderRadius: 999, padding: '2px 9px' } }, "Team")

    ), /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', gap: 8 } },
    onChat && /*#__PURE__*/React.createElement(WzButton, { variant: "amber-ghost", icon: "sparkles", onClick: onChat, style: { flex: 1 } }, "Chat with it"),
    extraAction
    )
    ));

}

function CreateTile({ onClick }) {
  const [hover, setHover] = React.useState(false);
  return (/*#__PURE__*/
    React.createElement("button", { onClick: onClick,
      onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
      style: {
        minHeight: 122, borderRadius: 14, cursor: 'pointer', padding: 18,
        border: `1.5px dashed ${hover ? 'var(--brand-soft-border)' : 'var(--border-strong)'}`,
        background: hover ? 'var(--surface-hover)' : 'transparent',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
        color: hover ? 'var(--brand-fg)' : 'var(--text-subtle)', fontFamily: 'var(--font-sans)'
      } }, /*#__PURE__*/
    React.createElement(WzIcon, { name: "plus", size: 20 }), /*#__PURE__*/
    React.createElement("span", { style: { fontSize: 13, fontWeight: 600 } }, "Create one"), /*#__PURE__*/
    React.createElement("span", { style: { fontSize: 11.5, color: 'var(--text-faint)' } }, "e.g. \u201Ceverything about Northwind\u201D")
    ));

}

// Right drawer — chat with one wizard, answers only from its pages.
function WizardChatDrawer({ wizard, onClose }) {
  const [messages, setMessages] = React.useState([]);
  const [draft, setDraft] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [asking, setAsking] = React.useState(false);
  const scrollRef = React.useRef(null);
  React.useEffect(() => {if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;}, [messages, asking]);
  React.useEffect(() => {
    let live = true;
    setLoading(true);
    (async () => {
      try {
        const r = window.lore?.wizards?.personal?.history ?
        await window.lore.wizards.personal.history(wizard.id) : { messages: [] };
        if (live) setMessages(r && r.messages || []);
      } catch {if (live) setMessages([]);}
      if (live) setLoading(false);
    })();
    const onKey = (e) => {if (e.key === 'Escape') onClose();};
    window.addEventListener('keydown', onKey);
    return () => {live = false;window.removeEventListener('keydown', onKey);};
  }, [wizard.id, onClose]);

  const send = async () => {
    const q = draft.trim();
    if (!q || asking) return;
    setDraft('');
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setAsking(true);
    try {
      const r = window.lore?.wizards?.personal?.ask ?
      await window.lore.wizards.personal.ask(wizard.id, q) : { error: 'wizard ask unavailable' };
      setMessages((m) => [...m, { role: 'assistant', text: r.answer || r.error || '(no answer)', sources: r.citations }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: 'Error: ' + (e && e.message || String(e)) }]);
    }
    setAsking(false);
  };

  return (/*#__PURE__*/
    React.createElement("div", { style: { position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end' } }, /*#__PURE__*/
    React.createElement("div", { onClick: onClose, style: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' } }), /*#__PURE__*/
    React.createElement("div", { style: {
        position: 'relative', height: '100%', width: 392, background: 'var(--surface-panel)',
        borderLeft: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-drawer)',
        display: 'flex', flexDirection: 'column', animation: 'lore-fade-in 160ms ease'
      } }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--divider)', flexShrink: 0 } }, /*#__PURE__*/
    React.createElement("span", { style: { width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)' } }, /*#__PURE__*/
    React.createElement(WzIcon, { name: "wand-2", size: 15, style: { color: 'var(--brand-fg)' } })
    ), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 14, fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, wizard.name), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 11, color: 'var(--text-faint)', marginTop: 1 } }, "Answers only from this Wizard\u2019s ", wizard.note_count != null ? `${wizard.note_count} ` : '', "pages")
    ), /*#__PURE__*/
    React.createElement("button", { onClick: onClose, "aria-label": "Close wizard chat", style: { border: 'none', background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer', display: 'inline-flex', padding: 4 } }, /*#__PURE__*/
    React.createElement(WzIcon, { name: "x", size: 16 })
    )
    ), /*#__PURE__*/
    React.createElement("div", { ref: scrollRef, style: { flex: 1, overflowY: 'auto', padding: '12px 14px' } },
    loading && /*#__PURE__*/React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)', padding: 8 } }, "loading history\u2026"),
    !loading && messages.length === 0 && /*#__PURE__*/
    React.createElement("div", { style: { padding: '26px 10px', textAlign: 'center' } }, /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 14.5, fontWeight: 600, color: 'var(--text-strong)', marginBottom: 4 } }, "Ask ", wizard.name, " anything."), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 12.5, color: 'var(--text-subtle)', lineHeight: 1.5 } }, "It only knows the pages inside it \u2014 answers come with citations.")
    ),

    messages.map((m, i) =>
    m.role === 'user' ? /*#__PURE__*/
    React.createElement("div", { key: i, style: { display: 'flex', justifyContent: 'flex-end', margin: '10px 0' } }, /*#__PURE__*/
    React.createElement("div", { style: { maxWidth: '85%', padding: '9px 13px', background: 'var(--obsidian-720)', borderRadius: '12px 12px 3px 12px', color: 'var(--text-strong)', fontSize: 13.5, lineHeight: 1.5, border: '1px solid var(--border-subtle)' } }, m.text)
    ) : /*#__PURE__*/
    React.createElement("div", { key: i, style: { display: 'flex', gap: 10, margin: '12px 0' } }, /*#__PURE__*/
    React.createElement("span", { style: { width: 24, height: 24, flexShrink: 0, marginTop: 2, borderRadius: 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)' } }, /*#__PURE__*/
    React.createElement(WzIcon, { name: "wand-2", size: 12, style: { color: 'var(--brand-fg)' } })
    ), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-body)', whiteSpace: 'pre-wrap' } }, m.text)
    )
    ),
    asking && /*#__PURE__*/React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)', padding: '4px 0 4px 34px' } }, "thinking\u2026")
    ), /*#__PURE__*/
    React.createElement("div", { style: { padding: '10px 14px 14px', flexShrink: 0 } }, /*#__PURE__*/
    React.createElement("div", { style: { border: '1px solid var(--border-field)', borderRadius: 12, background: 'var(--surface-canvas)', padding: 10 } }, /*#__PURE__*/
    React.createElement("textarea", { value: draft, onChange: (e) => setDraft(e.target.value), rows: 2,
      onKeyDown: (e) => {if (e.key === 'Enter' && !e.shiftKey) {e.preventDefault();send();}},
      "aria-label": `Ask ${wizard.name}`, placeholder: `Ask ${wizard.name}…`,
      style: { width: '100%', resize: 'none', border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--font-sans)', fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-strong)' } }), /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 6 } }, /*#__PURE__*/
    React.createElement("button", { onClick: send, disabled: asking || !draft.trim(), "aria-label": "Send", style: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34,
        border: 'none', borderRadius: 9, cursor: asking || !draft.trim() ? 'not-allowed' : 'pointer',
        background: 'var(--brand-bg)', color: 'var(--text-onbrand)', opacity: asking || !draft.trim() ? 0.5 : 1
      } }, /*#__PURE__*/React.createElement(WzIcon, { name: "arrow-up", size: 15 }))
    )
    )
    )
    )
    ));

}

function WizardsView({ onBack, backLabel, scopes, onChanged, place, teamName }) {
  const [personal, setPersonal] = React.useState(null);
  const [catalog, setCatalog] = React.useState([]);
  const [chatWizard, setChatWizard] = React.useState(null);
  const [builderOpen, setBuilderOpen] = React.useState(false);
  const [installBusy, setInstallBusy] = React.useState(null);
  const [hoverBack, setHoverBack] = React.useState(false);

  const loadPersonal = React.useCallback(async () => {
    if (!window.lore?.wizards?.personal?.list) {setPersonal([]);return;}
    try {
      const r = await window.lore.wizards.personal.list();
      setPersonal(r && r.wizards || []);
    } catch {setPersonal([]);}
  }, []);
  const loadCatalog = React.useCallback(async () => {
    if (!window.lore?.wizards?.catalog) {setCatalog([]);return;}
    try {setCatalog((await window.lore.wizards.catalog()) || []);} catch {setCatalog([]);}
  }, []);
  React.useEffect(() => {loadPersonal();loadCatalog();}, [loadPersonal, loadCatalog]);

  const install = async (id) => {
    setInstallBusy(id);
    try {await window.lore.wizards.install(id);} catch {/* stays uninstalled */}
    await Promise.all([loadCatalog(), loadPersonal()]);
    if (onChanged) onChanged();
    setInstallBusy(null);
  };

  const Builder = window.LoreWizardBuilder;
  const kbCatalog = (catalog || []).filter((w) => w.kind === 'wizard' && !w.installed);

  // Group personal wizards by the scope of the pages they wrap, so shared
  // wizards surface under Team/Company headings the same way pages do.
  const wzScope = (w) => w.scope === 'team' ? 'team' : w.scope === 'company' || w.scope === 'enterprise' ? 'company' : 'my';
  const groups = { my: [], team: [], company: [] };
  for (const w of personal || []) groups[wzScope(w)].push(w);
  const teamHeading = teamName ? `Team ${teamName} wizards` : 'Team wizards';

  // A titled block of wizard cards (used for Your/Team/Company sections).
  const Section = ({ icon, tint, border, fg, title, subtitle, children }) => /*#__PURE__*/
  React.createElement(React.Fragment, null, /*#__PURE__*/
  React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 9, margin: '30px 0 4px' } }, /*#__PURE__*/
  React.createElement("span", { style: { width: 26, height: 26, borderRadius: 8, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: tint || 'var(--brand-soft-bg)', border: `1px solid ${border || 'var(--brand-soft-border)'}` } }, /*#__PURE__*/
  React.createElement(WzIcon, { name: icon, size: 14, style: { color: fg || 'var(--brand-fg)' } })
  ), /*#__PURE__*/
  React.createElement("h2", { style: { fontSize: 15, fontWeight: 600, color: 'var(--text-strong)', margin: 0 } }, title)
  ),
  subtitle && /*#__PURE__*/React.createElement("p", { style: { fontSize: 12, color: 'var(--text-faint)', margin: '0 0 14px' } }, subtitle), /*#__PURE__*/
  React.createElement("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 } }, children)
  );


  return (/*#__PURE__*/
    React.createElement("div", { style: { flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--surface-canvas)' } }, /*#__PURE__*/
    React.createElement("div", { style: { maxWidth: 860, margin: '0 auto', padding: '26px 30px 80px' } }, /*#__PURE__*/
    React.createElement("button", { onClick: onBack,
      onMouseEnter: () => setHoverBack(true), onMouseLeave: () => setHoverBack(false),
      style: { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 14, fontFamily: 'var(--font-sans)', fontSize: 12.5, color: hoverBack ? 'var(--text-strong)' : 'var(--text-subtle)' } }, /*#__PURE__*/
    React.createElement(WzIcon, { name: "arrow-left", size: 14 }), "Back to ",
    backLabel || 'your pages'
    ), /*#__PURE__*/
    React.createElement("h1", { style: { fontSize: 23, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text-strong)', margin: '0 0 6px' } }, "Wizards"), /*#__PURE__*/
    React.createElement("p", { style: { fontSize: 13, color: 'var(--text-subtle)', margin: '0 0 20px', lineHeight: 1.55, maxWidth: 560 } }, "A Wizard is a bundle of pages you can chat with \u2014 its answers come only from what\u2019s inside it. Pages stay where they are; a Wizard is a view over them."

    ), /*#__PURE__*/


    React.createElement("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 } },
    groups.my.map((w) => /*#__PURE__*/
    React.createElement(WizardCard, { key: w.id, name: w.name,
      meta: `${w.note_count != null ? w.note_count : '—'} page${w.note_count === 1 ? '' : 's'} inside${w.folder ? ` · ${String(w.folder).split(/[\\/]/).pop()}` : ''}`,
      onChat: () => setChatWizard(w) })
    ), /*#__PURE__*/
    React.createElement(CreateTile, { onClick: () => setBuilderOpen(true) })
    ),
    personal === null && /*#__PURE__*/
    React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)', marginTop: 14 } }, "loading wizards\u2026"),


    groups.team.length > 0 && /*#__PURE__*/
    React.createElement(Section, { icon: "users", tint: "var(--place-team-tint)", border: "var(--place-team-border)", fg: "var(--place-team-fg)",
      title: teamHeading, subtitle: "Shared with your team \u2014 everyone on the team can chat with these." },
    groups.team.map((w) => /*#__PURE__*/
    React.createElement(WizardCard, { key: w.id, name: w.name,
      meta: `${w.note_count != null ? w.note_count : '—'} page${w.note_count === 1 ? '' : 's'} inside`,
      teamBadge: true, onChat: () => setChatWizard(w) })
    )
    ),


    groups.company.length > 0 && /*#__PURE__*/
    React.createElement(Section, { icon: "building-2", tint: "var(--place-company-tint)", border: "var(--place-company-border)", fg: "var(--place-company-fg)",
      title: "Company wizards", subtitle: "Visible to everyone at your company." },
    groups.company.map((w) => /*#__PURE__*/
    React.createElement(WizardCard, { key: w.id, name: w.name,
      meta: `${w.note_count != null ? w.note_count : '—'} page${w.note_count === 1 ? '' : 's'} inside`,
      onChat: () => setChatWizard(w) })
    )
    ), /*#__PURE__*/



    React.createElement(Section, { icon: "store", title: "Marketplace",
      subtitle: kbCatalog.length > 0 ? 'Ready-made knowledge packs — install one and chat with it like your own.' : 'You’ve installed everything available right now. New packs show up here.' },
    kbCatalog.map((w) => /*#__PURE__*/
    React.createElement(WizardCard, { key: w.id, name: w.name,
      meta: w.desc || `${(w.noteTitles || []).length || w.noteCount || '—'} pages`,
      onChat: null,
      extraAction: /*#__PURE__*/
      React.createElement(WzButton, { icon: "download", onClick: () => install(w.id), disabled: installBusy === w.id, style: { flex: 1 } },
      installBusy === w.id ? 'Installing…' : 'Install'
      ) }
    )
    )
    )
    ),

    chatWizard && /*#__PURE__*/React.createElement(WizardChatDrawer, { wizard: chatWizard, onClose: () => setChatWizard(null) }),
    builderOpen && Builder && /*#__PURE__*/
    React.createElement(Builder, { scopes: scopes, onClose: () => setBuilderOpen(false),
      onCreated: (w) => {setBuilderOpen(false);loadPersonal();if (onChanged) onChanged();if (w) setChatWizard(w);} })

    ));

}

Object.assign(window, { LoreWizardsView: WizardsView, LoreWizardChatDrawer: WizardChatDrawer });