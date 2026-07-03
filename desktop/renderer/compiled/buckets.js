/* global React */
// Lore desktop - Buckets: shared knowledge collections pooled across libraries
const bkNS = window.VaultDesignSystem_ffbf58;
const { Icon: BkIcon, Card: BkCard, ScopeTag: BkScope, Avatar: BkAvatar, Badge: BkBadge, Button: BkButton, Tabs: BkTabs } = bkNS;

const bkS = {
  wrap: { flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--surface-canvas)' },
  head: { display: 'flex', alignItems: 'center', gap: 12, padding: '22px 28px 0' },
  body: { padding: '18px 28px 60px', maxWidth: 1040, margin: '0 auto' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }
};

function Recall({ value }) {
  return (/*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 7 } }, /*#__PURE__*/
    React.createElement("div", { style: { width: 54, height: 5, borderRadius: 'var(--radius-full)', background: 'var(--surface-inset)', overflow: 'hidden' } }, /*#__PURE__*/
    React.createElement("div", { style: { width: value * 100 + '%', height: '100%', background: 'var(--jade-500)', borderRadius: 'var(--radius-full)' } })
    ), /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' } }, "recall ", value.toFixed(2))
    ));

}

function BucketCard({ b, onOpen }) {
  return (/*#__PURE__*/
    React.createElement(BkCard, { interactive: true, onClick: () => onOpen && onOpen(b), style: { display: 'flex', flexDirection: 'column', gap: 11 } }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 10 } }, /*#__PURE__*/
    React.createElement("span", { style: { width: 32, height: 32, borderRadius: 'var(--radius-md)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)' } }, /*#__PURE__*/
    React.createElement(BkIcon, { name: "library", size: 17, style: { color: 'var(--brand-fg)' } })
    ), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 14.5, fontWeight: 600, color: 'var(--text-strong)' } }, b.name), /*#__PURE__*/
    React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)', marginTop: 1 } }, b.group, " \xB7 ", b.notes, " notes")
    ), /*#__PURE__*/
    React.createElement(BkScope, { scope: b.scope, size: "sm", showLabel: false })
    ), /*#__PURE__*/
    React.createElement("p", { style: { margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)', minHeight: 38 } }, b.desc), /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 5 } },
    b.topics.map((t) => /*#__PURE__*/React.createElement(BkBadge, { key: t, tone: "info" }, "#", t))
    ), /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 } }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex' } },
    b.contributors.slice(0, 4).map((m, i) => /*#__PURE__*/
    React.createElement("div", { key: m, style: { marginLeft: i ? -7 : 0, border: '2px solid var(--surface-panel)', borderRadius: '50%' } }, /*#__PURE__*/React.createElement(BkAvatar, { name: m, size: 22 }))
    ),
    b.contributors.length > 4 && /*#__PURE__*/React.createElement("span", { style: { marginLeft: 4, alignSelf: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' } }, "+", b.contributors.length - 4)
    ), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1 } }), /*#__PURE__*/
    React.createElement(Recall, { value: b.recall })
    )
    ));

}

function BkStars({ value, onRate }) {
  const [hover, setHover] = React.useState(0);
  return (/*#__PURE__*/
    React.createElement("span", { style: { display: 'inline-flex', gap: 1 } },
    [1, 2, 3, 4, 5].map((s) => /*#__PURE__*/
    React.createElement("span", { key: s, onMouseEnter: () => onRate && setHover(s), onMouseLeave: () => setHover(0), onClick: (e) => {e.stopPropagation();onRate && onRate(s);},
      style: { cursor: onRate ? 'pointer' : 'default', display: 'inline-flex', color: (hover || value) >= s ? 'var(--amber-400)' : 'var(--text-faint)' } }, /*#__PURE__*/
    React.createElement(BkIcon, { name: "star", size: 13 })
    )
    )
    ));

}

function WizardStoreCard({ w, onInstall, onRate, onUninstall }) {
  const [busy, setBusy] = React.useState(false);
  const [unbusy, setUnbusy] = React.useState(false);
  return (/*#__PURE__*/
    React.createElement(BkCard, { style: { display: 'flex', flexDirection: 'column', gap: 10 } }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 10 } }, /*#__PURE__*/
    React.createElement("span", { style: { width: 32, height: 32, borderRadius: 'var(--radius-md)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)' } }, /*#__PURE__*/
    React.createElement(BkIcon, { name: "sparkles", size: 16, style: { color: 'var(--brand-fg)' } })
    ), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 14.5, fontWeight: 600, color: 'var(--text-strong)' } }, w.name), /*#__PURE__*/
    React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' } }, w.author, " \xB7 ", w.noteCount, " notes")
    ), /*#__PURE__*/
    React.createElement(BkScope, { scope: w.scope, size: "sm", showLabel: false })
    ), /*#__PURE__*/
    React.createElement("p", { style: { margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)', minHeight: 38 } }, w.desc), /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 5 } }, (w.topics || []).slice(0, 4).map((t) => /*#__PURE__*/React.createElement(BkBadge, { key: t, tone: "info" }, "#", t))), /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 } }, /*#__PURE__*/
    React.createElement(BkStars, { value: w.myRating || Math.round(w.rating || 0), onRate: (s) => onRate(w.id, s) }), /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' } }, w.rating, " \xB7 ", (w.installs || 0).toLocaleString()), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1 } }),
    w.installed ? /*#__PURE__*/
    React.createElement("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } }, /*#__PURE__*/
    React.createElement(BkBadge, { tone: "success", dot: true }, "installed"), /*#__PURE__*/
    React.createElement(BkButton, { variant: "secondary", size: "sm", icon: unbusy ? 'loader' : 'trash', onClick: async () => {setUnbusy(true);await onUninstall(w.id);setUnbusy(false);} }, unbusy ? 'Removing…' : 'Uninstall')
    ) : /*#__PURE__*/
    React.createElement(BkButton, { variant: "primary", size: "sm", icon: busy ? 'loader' : 'download', onClick: async () => {setBusy(true);await onInstall(w.id);setBusy(false);} }, busy ? 'Installing…' : 'Install')
    )
    ));

}

function WizardStore({ onChanged }) {
  const [catalog, setCatalog] = React.useState(null);
  const [q, setQ] = React.useState('');
  const [cat, setCat] = React.useState('all');
  const [shown, setShown] = React.useState(40);
  const [kindTab, setKindTab] = React.useState('all');
  const load = React.useCallback(async () => {
    if (!window.lore || !window.lore.wizards || !window.lore.wizards.catalog) {setCatalog([]);return;}
    try {setCatalog(await window.lore.wizards.catalog());} catch {setCatalog([]);}
  }, []);
  React.useEffect(() => {load();}, [load]);
  const install = async (id) => {try {await window.lore.wizards.install(id);} catch {/* */}await load();if (onChanged) onChanged();};
  const rate = async (id, s) => {try {await window.lore.wizards.rate(id, s);} catch {/* */}load();};
  const uninstall = async (id) => {try {await window.lore.wizards.uninstall(id);} catch {/* */}await load();if (onChanged) onChanged();};
  if (catalog === null) return /*#__PURE__*/React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-faint)', padding: '24px 0' } }, "Loading knowledge bases\u2026");
  if (!catalog.length) return null;

  const catOf = (w) => w.kind === 'wizard' ? 'featured' : w.topics && w.topics[0] || 'tool';
  const cats = ['all', 'featured', 'skill', 'mcp', 'marketplace'];
  const ql = q.trim().toLowerCase();

  // Kind-level tab counts (from full catalog, unaffected by search)
  const installedCount = catalog.filter((w) => !!w.installed).length;
  const tabCounts = {
    all: catalog.length,
    bases: catalog.filter((w) => w.kind === 'wizard').length,
    tools: catalog.filter((w) => w.kind === 'tool').length,
    installed: installedCount
  };
  const storeTabs = [
  { value: 'all', label: 'All', count: tabCounts.all },
  { value: 'bases', label: 'Bases', count: tabCounts.bases },
  { value: 'tools', label: 'Tools', count: tabCounts.tools }];

  if (installedCount > 0) storeTabs.push({ value: 'installed', label: 'Installed', count: installedCount });

  // Kind tab pre-filter, then category chip + search filter
  const kindFiltered = catalog.filter((w) => {
    if (kindTab === 'bases') return w.kind === 'wizard';
    if (kindTab === 'tools') return w.kind === 'tool';
    if (kindTab === 'installed') return !!w.installed;
    return true;
  });
  const filtered = kindFiltered.filter((w) => {
    if (cat !== 'all' && catOf(w) !== cat) return false;
    if (!ql) return true;
    return (w.name + ' ' + (w.desc || '') + ' ' + (w.topics || []).join(' ')).toLowerCase().includes(ql);
  }).sort((a, b) => (b.kind === 'wizard') - (a.kind === 'wizard') || (b.installs || 0) - (a.installs || 0));
  const visible = filtered.slice(0, shown);
  const chip = (active) => ({ padding: '4px 11px', borderRadius: 'var(--radius-full)', cursor: 'pointer', border: `1px solid ${active ? 'var(--brand-soft-border)' : 'var(--border)'}`, background: active ? 'var(--brand-soft-bg)' : 'var(--surface-inset)', color: active ? 'var(--brand-fg)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'capitalize' });

  return (/*#__PURE__*/
    React.createElement("div", { style: { marginTop: 28 } }, /*#__PURE__*/
    React.createElement("h2", { style: { fontFamily: 'var(--font-serif)', fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-strong)', margin: '0 0 3px' } }, "Discover knowledge bases & tools"), /*#__PURE__*/
    React.createElement("p", { style: { fontSize: 12.5, color: 'var(--text-subtle)', margin: '0 0 10px' } }, catalog.length.toLocaleString(), " available \u2014 curated knowledge bases + tools sourced from the web. Install to add into your library."), /*#__PURE__*/
    React.createElement("div", { style: { marginBottom: 12 } }, /*#__PURE__*/
    React.createElement(BkTabs, { value: kindTab, onChange: (v) => {setKindTab(v);setCat('all');setShown(40);}, tabs: storeTabs })
    ), /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' } }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 7, flex: '1 1 220px', minWidth: 200, padding: '0 10px', height: 32, background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' } }, /*#__PURE__*/
    React.createElement(BkIcon, { name: "search", size: 14, style: { color: 'var(--text-faint)' } }), /*#__PURE__*/
    React.createElement("input", { value: q, onChange: (e) => {setQ(e.target.value);setShown(40);}, placeholder: "Search wizards & tools\u2026", style: { flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-strong)', fontFamily: 'var(--font-sans)', fontSize: 13 } })
    ),
    cats.map((c) => /*#__PURE__*/React.createElement("button", { key: c, onClick: () => {setCat(c);setShown(40);}, style: chip(cat === c) }, c))
    ), /*#__PURE__*/
    React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)', margin: '0 2px 8px' } }, filtered.length.toLocaleString(), " result", filtered.length !== 1 ? 's' : '', filtered.length > shown ? ` · showing ${shown}` : ''), /*#__PURE__*/
    React.createElement("div", { style: bkS.grid },
    visible.map((w) => /*#__PURE__*/React.createElement(WizardStoreCard, { key: w.id, w: w, onInstall: install, onRate: rate, onUninstall: uninstall }))
    ),
    filtered.length > shown && /*#__PURE__*/
    React.createElement("button", { onClick: () => setShown((s) => s + 60), style: { marginTop: 14, width: '100%', padding: '10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-inset)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12 } }, "Show more \xB7 ",
    (filtered.length - shown).toLocaleString(), " more"
    )

    ));

}

// --- Personal Wizards: an APPLIED Section promoted to a scoped RAG assistant ---
// (via the sidebar's "Promote" button on an applied section — see shell.jsx).
// Nothing here moves files; this just lists + asks the already-promoted wizards.
const { AskMessage: BkAskMessage, CitationChip: BkCitationChip } = bkNS;

function PersonalWizardCard({ w, onAsk }) {
  return (/*#__PURE__*/
    React.createElement(BkCard, { style: { display: 'flex', flexDirection: 'column', gap: 10 } }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 10 } }, /*#__PURE__*/
    React.createElement("span", { style: { width: 32, height: 32, borderRadius: 'var(--radius-md)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)' } }, /*#__PURE__*/
    React.createElement(BkIcon, { name: "wand-2", size: 16, style: { color: 'var(--brand-fg)' } })
    ), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 14.5, fontWeight: 600, color: 'var(--text-strong)' } }, w.name), /*#__PURE__*/
    React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' } }, w.note_count, " note", w.note_count === 1 ? '' : 's', w.folder ? ` · ${w.folder.split('/').pop()}` : '')
    )
    ),
    w.topic && w.topic !== w.name && /*#__PURE__*/React.createElement("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 5 } }, /*#__PURE__*/React.createElement(BkBadge, { tone: "info" }, "#", w.topic)), /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', marginTop: 2 } }, /*#__PURE__*/
    React.createElement("div", { style: { flex: 1 } }), /*#__PURE__*/
    React.createElement(BkButton, { variant: "primary", size: "sm", icon: "sparkles", onClick: () => onAsk(w) }, "Ask")
    )
    ));

}

function PersonalWizardsSection({ onAsk }) {
  const [wizards, setWizards] = React.useState(null);
  const load = React.useCallback(async () => {
    if (!window.lore || !window.lore.wizards || !window.lore.wizards.personal || !window.lore.wizards.personal.list) {setWizards([]);return;}
    try {
      const r = await window.lore.wizards.personal.list();
      setWizards(r && r.wizards || []);
    } catch {setWizards([]);}
  }, []);
  React.useEffect(() => {load();}, [load]);
  if (wizards === null) return null;
  if (!wizards.length) {
    return (/*#__PURE__*/
      React.createElement("div", { style: { marginTop: 28 } }, /*#__PURE__*/
      React.createElement("h2", { style: { fontFamily: 'var(--font-serif)', fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-strong)', margin: '0 0 3px' } }, "Personal"), /*#__PURE__*/
      React.createElement("p", { style: { fontSize: 12.5, color: 'var(--text-subtle)', margin: 0 } }, "Promote an applied Section (sidebar \u2192 Proposed sections \u2192 Promote) to turn it into a wizard you can ask directly.")
      ));

  }
  return (/*#__PURE__*/
    React.createElement("div", { style: { marginTop: 28 } }, /*#__PURE__*/
    React.createElement("h2", { style: { fontFamily: 'var(--font-serif)', fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-strong)', margin: '0 0 3px' } }, "Personal"), /*#__PURE__*/
    React.createElement("p", { style: { fontSize: 12.5, color: 'var(--text-subtle)', margin: '0 0 10px' } }, "Wizards built from your own knowledge base \u2014 promoted Sections, scoped to only their own notes."), /*#__PURE__*/
    React.createElement("div", { style: bkS.grid },
    wizards.map((w) => /*#__PURE__*/React.createElement(PersonalWizardCard, { key: w.id, w: w, onAsk: onAsk }))
    )
    ));

}

// --- MCP servers + AI-tool hooks: informational status only (install flows live
// in Settings/Hooks views already) — just visibility of what's currently connected.
function McpSkillsRow({ name, connected }) {
  return (/*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: '1px solid var(--divider)' } }, /*#__PURE__*/
    React.createElement(BkIcon, { name: connected ? 'plug-zap' : 'plug', size: 14, style: { color: connected ? 'var(--jade-400)' : 'var(--text-faint)' } }), /*#__PURE__*/
    React.createElement("span", { style: { flex: 1, fontSize: 13, color: 'var(--text-body)' } }, name), /*#__PURE__*/
    React.createElement(BkBadge, { tone: connected ? 'success' : 'neutral', dot: true }, connected ? 'Connected' : 'Not connected')
    ));

}

function McpSkillsList() {
  const [mcp, setMcp] = React.useState(null);
  const [hooks, setHooks] = React.useState(null);
  React.useEffect(() => {
    (async () => {
      try {setMcp(window.lore && window.lore.mcp && window.lore.mcp.detectTools ? await window.lore.mcp.detectTools() : {});} catch {setMcp({});}
      try {setHooks(window.lore && window.lore.hooks && window.lore.hooks.detect ? await window.lore.hooks.detect() : []);} catch {setHooks([]);}
    })();
  }, []);
  if (mcp === null || hooks === null) return null;
  const mcpRows = [
  { name: 'Claude Code MCP', connected: !!(mcp.claude && mcp.claude.installed) },
  { name: 'Codex MCP', connected: !!(mcp.codex && mcp.codex.installed) }];

  const hookRows = (hooks || []).map((h) => ({ name: h.name || h.id, connected: !!h.installed }));
  return (/*#__PURE__*/
    React.createElement("div", { style: { marginTop: 28 } }, /*#__PURE__*/
    React.createElement("h2", { style: { fontFamily: 'var(--font-serif)', fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-strong)', margin: '0 0 3px' } }, "MCP & skills"), /*#__PURE__*/
    React.createElement("p", { style: { fontSize: 12.5, color: 'var(--text-subtle)', margin: '0 0 10px' } }, "What's currently connected \u2014 manage installs from Settings / Hooks."), /*#__PURE__*/
    React.createElement(BkCard, { style: { padding: 0, overflow: 'hidden' } },
    [...mcpRows, ...hookRows].map((r, i, arr) => /*#__PURE__*/
    React.createElement("div", { key: r.name, style: i === arr.length - 1 ? { borderBottom: 'none' } : undefined }, /*#__PURE__*/
    React.createElement(McpSkillsRow, { name: r.name, connected: r.connected })
    )
    )
    )
    ));

}

// --- Dedicated per-wizard chat: separate component/state from the shared Ask
// panel — history is persisted server-side (personal_wizard_chats), scoped to
// only this wizard's notes. Docked overlay, closes on scrim click or ✕.
function PersonalWizardChat({ wizard, onClose }) {
  const [messages, setMessages] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [draft, setDraft] = React.useState('');
  const [asking, setAsking] = React.useState(false);
  const scrollRef = React.useRef(null);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    (async () => {
      try {
        const r = window.lore && window.lore.wizards && window.lore.wizards.personal && window.lore.wizards.personal.history ?
        await window.lore.wizards.personal.history(wizard.id) : { messages: [] };
        if (live) setMessages(r && r.messages || []);
      } catch {if (live) setMessages([]);}
      if (live) setLoading(false);
    })();
    return () => {live = false;};
  }, [wizard.id]);

  React.useEffect(() => {if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;}, [messages, asking]);

  const send = async () => {
    const q = draft.trim();
    if (!q || asking) return;
    setDraft('');
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setAsking(true);
    try {
      const r = window.lore && window.lore.wizards && window.lore.wizards.personal && window.lore.wizards.personal.ask ?
      await window.lore.wizards.personal.ask(wizard.id, q) : { error: 'wizard ask unavailable' };
      setMessages((m) => [...m, { role: 'assistant', text: r.answer || r.error || '(no answer)', sources: r.citations }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: 'Error: ' + (e && e.message || String(e)) }]);
    }
    setAsking(false);
  };

  return (/*#__PURE__*/
    React.createElement("div", { style: { position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end' } }, /*#__PURE__*/
    React.createElement("div", { onClick: onClose, style: { position: 'absolute', inset: 0, background: 'var(--scrim-bg, rgba(0,0,0,0.35))' } }), /*#__PURE__*/
    React.createElement("div", { style: { position: 'relative', width: 'var(--ask-width, 380px)', height: '100%', background: 'var(--surface-panel)', borderLeft: '1px solid var(--border-strong)', boxShadow: 'var(--shadow-xl)', display: 'flex', flexDirection: 'column' } }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--divider)', flexShrink: 0 } }, /*#__PURE__*/
    React.createElement("span", { style: { width: 24, height: 24, borderRadius: 'var(--radius-sm)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)' } }, /*#__PURE__*/
    React.createElement(BkIcon, { name: "wand-2", size: 14, style: { color: 'var(--brand-fg)' } })
    ), /*#__PURE__*/
    React.createElement("span", { style: { flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, "Ask ", wizard.name), /*#__PURE__*/
    React.createElement("button", { onClick: onClose, "aria-label": "Close wizard chat", style: { border: 'none', background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer', display: 'inline-flex', padding: 4 } }, /*#__PURE__*/
    React.createElement(BkIcon, { name: "x", size: 16 })
    )
    ), /*#__PURE__*/

    React.createElement("div", { ref: scrollRef, style: { flex: 1, overflowY: 'auto', padding: '8px 14px 10px' } },
    !loading && messages.length === 0 && /*#__PURE__*/
    React.createElement("div", { style: { padding: '24px 6px', textAlign: 'center' } }, /*#__PURE__*/
    React.createElement("p", { style: { fontFamily: 'var(--font-serif)', fontSize: 16, color: 'var(--text-body)', margin: '0 0 4px' } }, "Ask ", wizard.name, "."), /*#__PURE__*/
    React.createElement("p", { style: { fontSize: 12.5, color: 'var(--text-subtle)', margin: 0, lineHeight: 1.5 } }, "Answers are drawn only from this wizard's ", wizard.note_count, " note", wizard.note_count === 1 ? '' : 's', ".")
    ),

    loading && /*#__PURE__*/React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-faint)', padding: '12px 0' } }, "Loading chat\u2026"),
    messages.map((m, i) =>
    m.role === 'user' ? /*#__PURE__*/
    React.createElement(BkAskMessage, { key: i, role: "user" }, m.text) : /*#__PURE__*/

    React.createElement("div", { key: i }, /*#__PURE__*/
    React.createElement(BkAskMessage, { role: "answer", sources: m.sources ? m.sources.length : undefined }, /*#__PURE__*/
    React.createElement("span", { style: { whiteSpace: 'pre-wrap' } }, m.text)
    ),
    m.sources && m.sources.length > 0 && /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 5, margin: '4px 0 4px 36px' } },
    m.sources.map((c, ci) => /*#__PURE__*/React.createElement(BkCitationChip, { key: ci, index: ci + 1, note: c.heading_path || c.note_id }))
    )

    )

    ),
    asking && /*#__PURE__*/React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)', padding: '4px 0 4px 36px' } }, "thinking\u2026")
    ), /*#__PURE__*/

    React.createElement("div", { style: { padding: '10px 12px 12px', borderTop: '1px solid var(--divider)', flexShrink: 0 } }, /*#__PURE__*/
    React.createElement("div", { style: { border: '1px solid var(--border-field)', borderRadius: 'var(--radius-md)', background: 'var(--surface-inset)', padding: 10 } }, /*#__PURE__*/
    React.createElement("textarea", {
      value: draft, onChange: (e) => setDraft(e.target.value), rows: 2,
      onKeyDown: (e) => {if (e.key === 'Enter' && !e.shiftKey) {e.preventDefault();send();}},
      "aria-label": `Ask ${wizard.name}`,
      placeholder: `Ask ${wizard.name}…`,
      style: { width: '100%', resize: 'none', border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--font-sans)', fontSize: 14, lineHeight: 1.5, color: 'var(--text-strong)' } }
    ), /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 6 } }, /*#__PURE__*/
    React.createElement("button", { onClick: send, disabled: asking || !draft.trim(), "aria-label": "Send question", style: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36,
        border: 'none', borderRadius: 'var(--radius-sm)', cursor: asking || !draft.trim() ? 'not-allowed' : 'pointer',
        background: 'var(--brand-bg)', color: 'var(--text-onbrand)', opacity: asking || !draft.trim() ? 0.5 : 1
      } }, /*#__PURE__*/React.createElement(BkIcon, { name: "arrow-up", size: 15 }))
    )
    )
    )
    )
    ));

}

function BucketsView({ buckets, onAsk, onOpen, onChanged }) {
  const [tab, setTab] = React.useState('all');
  const [chatWizard, setChatWizard] = React.useState(null); // personal wizard whose dedicated chat is open
  const scopes = React.useMemo(() => {
    const out = [],seen = new Set();
    for (const b of buckets || []) {
      const s = b.scope ? String(b.scope).trim() : '';
      if (!s) continue;
      const key = s.toLowerCase();
      if (!seen.has(key)) {seen.add(key);out.push(s);}
    }
    return out;
  }, [buckets]);
  const shown = tab === 'all' ? buckets : buckets.filter((b) => b.scope === tab);
  const tabs = [{ value: 'all', label: 'All', count: buckets.length }, ...scopes.map((s) => ({ value: s, label: s }))];
  return (/*#__PURE__*/
    React.createElement("div", { style: bkS.wrap }, /*#__PURE__*/
    React.createElement("div", { style: bkS.head }, /*#__PURE__*/
    React.createElement("div", null, /*#__PURE__*/
    React.createElement("h1", { style: { fontFamily: 'var(--font-serif)', fontSize: 'var(--text-3xl)', fontWeight: 600, color: 'var(--text-strong)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 } }, /*#__PURE__*/
    React.createElement("img", { src: "design/assets/sprites/codex-tome.png", alt: "", style: { width: 28, height: 28, objectFit: 'contain', verticalAlign: 'middle' }, onError: (e) => {e.target.style.display = 'none';} }), "Wizards",

    window.LoreHelpHint && /*#__PURE__*/React.createElement(window.LoreHelpHint, { size: 16, tip: "A Wizard is a knowledge base \u2014 a curated collection of notes pooled together that you can ask across (e.g. a Security playbook or Trading strategies). A note can live in many Wizards at once, unlike a folder, which it only sits in one of." })
    ), /*#__PURE__*/
    React.createElement("p", { style: { fontSize: 13, color: 'var(--text-subtle)', margin: '4px 0 0' } }, "Knowledge bases \u2014 curated collections you pool notes into and ask across.")
    ), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1 } }), /*#__PURE__*/
    React.createElement(BkButton, { variant: "secondary", icon: "sparkles", onClick: onAsk }, "Ask all wizards"), /*#__PURE__*/
    React.createElement(BkButton, { variant: "primary", icon: "plus" }, "New wizard")
    ), /*#__PURE__*/
    React.createElement("div", { style: bkS.body }, /*#__PURE__*/
    React.createElement("div", { style: { marginBottom: 18 } }, /*#__PURE__*/
    React.createElement(BkTabs, { value: tab, onChange: setTab, tabs: tabs })
    ), /*#__PURE__*/
    React.createElement("div", { style: bkS.grid },
    shown.map((b) => /*#__PURE__*/React.createElement(BucketCard, { key: b.id, b: b, onOpen: () => onOpen && onOpen(b) }))
    ), /*#__PURE__*/
    React.createElement(WizardStore, { onChanged: onChanged }), /*#__PURE__*/
    React.createElement(PersonalWizardsSection, { onAsk: setChatWizard }), /*#__PURE__*/
    React.createElement(McpSkillsList, null)
    ),
    chatWizard && /*#__PURE__*/React.createElement(PersonalWizardChat, { wizard: chatWizard, onClose: () => setChatWizard(null) })
    ));

}

window.LoreBucketsView = BucketsView;