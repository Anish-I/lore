/* global React */
// Lore desktop - Wizards view: the store, split into two clear halves.
//   Knowledge bases — bundles of lore notes: your Personal wizards, shared
//     collections, and curated catalog packs. Chat without installing (preview),
//     or create your own by DESCRIBING it (wizard-builder.jsx, the primary flow).
//   Tools — plugins that connect external data/capabilities INTO Lore: MCP
//     servers, agent skills, marketplace integrations. Connected ones show
//     status; catalog ones install.
// Clicking a card's title opens an inline DETAIL view (no router — same
// conditional-render pattern as the rest of the app).
const bkNS = window.VaultDesignSystem_ffbf58;
const { Icon: BkIcon, Card: BkCard, ScopeTag: BkScope, Avatar: BkAvatar, Badge: BkBadge, Button: BkButton, Tabs: BkTabs } = bkNS;

const bkS = {
  wrap: { flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--surface-canvas)' },
  head: { display: 'flex', alignItems: 'center', gap: 12, padding: '22px 28px 0' },
  body: { padding: '18px 28px 60px', maxWidth: 1040, margin: '0 auto' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 },
  h2: { fontFamily: 'var(--font-serif)', fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-strong)', margin: '0 0 3px' },
  sub: { fontSize: 12.5, color: 'var(--text-subtle)', margin: '0 0 10px' },
  cardIcon: { width: 32, height: 32, borderRadius: 'var(--radius-md)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)' },
  // Card titles open the detail view — underline on hover says "clickable".
  titleLink: { fontSize: 14.5, fontWeight: 600, color: 'var(--text-strong)', cursor: 'pointer', textDecoration: 'none' },
  chip: (active) => ({ padding: '4px 11px', borderRadius: 'var(--radius-full)', cursor: 'pointer', border: `1px solid ${active ? 'var(--brand-soft-border)' : 'var(--border)'}`, background: active ? 'var(--brand-soft-bg)' : 'var(--surface-inset)', color: active ? 'var(--brand-fg)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'capitalize' }),
};

function Recall({ value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <div style={{ width: 54, height: 5, borderRadius: 'var(--radius-full)', background: 'var(--surface-inset)', overflow: 'hidden' }}>
        <div style={{ width: (value * 100) + '%', height: '100%', background: 'var(--jade-500)', borderRadius: 'var(--radius-full)' }} />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}>recall {value.toFixed(2)}</span>
    </div>
  );
}

function BucketCard({ b, onOpen }) {
  return (
    <BkCard interactive onClick={() => onOpen && onOpen(b)} style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={bkS.cardIcon}><BkIcon name="library" size={17} style={{ color: 'var(--brand-fg)' }} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--text-strong)' }}>{b.name}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)', marginTop: 1 }}>{b.group} · {b.notes} notes</div>
        </div>
        <BkScope scope={b.scope} size="sm" showLabel={false} />
      </div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)', minHeight: 38 }}>{b.desc}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {b.topics.map((t) => <BkBadge key={t} tone="info">#{t}</BkBadge>)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
        <div style={{ display: 'flex' }}>
          {b.contributors.slice(0, 4).map((m, i) => (
            <div key={m} style={{ marginLeft: i ? -7 : 0, border: '2px solid var(--surface-panel)', borderRadius: '50%' }}><BkAvatar name={m} size={22} /></div>
          ))}
          {b.contributors.length > 4 && <span style={{ marginLeft: 4, alignSelf: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>+{b.contributors.length - 4}</span>}
        </div>
        <div style={{ flex: 1 }} />
        <Recall value={b.recall} />
      </div>
    </BkCard>
  );
}

function BkStars({ value, onRate }) {
  const [hover, setHover] = React.useState(0);
  return (
    <span style={{ display: 'inline-flex', gap: 1 }}>
      {[1, 2, 3, 4, 5].map((s) => (
        <span key={s} onMouseEnter={() => onRate && setHover(s)} onMouseLeave={() => setHover(0)} onClick={(e) => { e.stopPropagation(); onRate && onRate(s); }}
          style={{ cursor: onRate ? 'pointer' : 'default', display: 'inline-flex', color: (hover || value) >= s ? 'var(--amber-400)' : 'var(--text-faint)' }}>
          <BkIcon name="star" size={13} />
        </span>
      ))}
    </span>
  );
}

// Shared Install / Uninstall action pair (card footers + the detail view).
function InstallActions({ w, onInstall, onUninstall }) {
  const [busy, setBusy] = React.useState(false);
  const [unbusy, setUnbusy] = React.useState(false);
  return w.installed
    ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <BkBadge tone="success" dot>installed</BkBadge>
        <BkButton variant="secondary" size="sm" icon={unbusy ? 'loader' : 'trash'} onClick={async () => { setUnbusy(true); await onUninstall(w.id); setUnbusy(false); }}>{unbusy ? 'Removing…' : 'Uninstall'}</BkButton>
      </span>
    : <BkButton variant="primary" size="sm" icon={busy ? 'loader' : 'download'} onClick={async () => { setBusy(true); await onInstall(w.id); setBusy(false); }}>{busy ? 'Installing…' : 'Install'}</BkButton>;
}

function StoreCard({ w, onInstall, onRate, onUninstall, onOpen }) {
  const isTool = w.kind === 'tool';
  return (
    <BkCard style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={bkS.cardIcon}><BkIcon name={isTool ? 'plug-zap' : 'sparkles'} size={16} style={{ color: 'var(--brand-fg)' }} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={bkS.titleLink} onClick={() => onOpen(w)} title="Open details"
            onMouseEnter={(e) => { e.target.style.textDecoration = 'underline'; }} onMouseLeave={(e) => { e.target.style.textDecoration = 'none'; }}>{w.name}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}>{w.author}{isTool ? '' : ` · ${w.noteCount} notes`}</div>
        </div>
        <BkScope scope={w.scope} size="sm" showLabel={false} />
      </div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)', minHeight: 38 }}>{w.desc}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{(w.topics || []).slice(0, 4).map((t) => <BkBadge key={t} tone="info">#{t}</BkBadge>)}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
        <BkStars value={w.myRating || Math.round(w.rating || 0)} onRate={(s) => onRate(w.id, s)} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}>{w.rating} · {(w.installs || 0).toLocaleString()}</span>
        <div style={{ flex: 1 }} />
        <InstallActions w={w} onInstall={onInstall} onUninstall={onUninstall} />
      </div>
    </BkCard>
  );
}

// Search box + chip row + capped grid over a catalog slice. Shared by both tabs.
function CatalogBrowser({ items, placeholder, chips, chipOf, onInstall, onRate, onUninstall, onOpen }) {
  const [q, setQ] = React.useState('');
  const [chip, setChip] = React.useState('all');
  const [installedOnly, setInstalledOnly] = React.useState(false);
  const [shown, setShown] = React.useState(40);
  const ql = q.trim().toLowerCase();
  const filtered = items.filter((w) => {
    if (installedOnly && !w.installed) return false;
    if (chip !== 'all' && chipOf && chipOf(w) !== chip) return false;
    if (!ql) return true;
    return (w.name + ' ' + (w.desc || '') + ' ' + (w.topics || []).join(' ')).toLowerCase().includes(ql);
  }).sort((a, b) => (b.installs || 0) - (a.installs || 0));
  const visible = filtered.slice(0, shown);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: '1 1 220px', minWidth: 200, padding: '0 10px', height: 32, background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
          <BkIcon name="search" size={14} style={{ color: 'var(--text-faint)' }} />
          <input value={q} onChange={(e) => { setQ(e.target.value); setShown(40); }} placeholder={placeholder} style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-strong)', fontFamily: 'var(--font-sans)', fontSize: 13 }} />
        </div>
        {(chips || []).map((c) => <button key={c} onClick={() => { setChip(c); setShown(40); }} style={bkS.chip(chip === c)}>{c}</button>)}
        <button onClick={() => { setInstalledOnly((v) => !v); setShown(40); }} style={bkS.chip(installedOnly)}>installed</button>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)', margin: '0 2px 8px' }}>{filtered.length.toLocaleString()} result{filtered.length !== 1 ? 's' : ''}{filtered.length > shown ? ` · showing ${shown}` : ''}</div>
      <div style={bkS.grid}>
        {visible.map((w) => <StoreCard key={w.id} w={w} onInstall={onInstall} onRate={onRate} onUninstall={onUninstall} onOpen={onOpen} />)}
      </div>
      {filtered.length > shown && (
        <button onClick={() => setShown((s) => s + 60)} style={{ marginTop: 14, width: '100%', padding: '10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-inset)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          Show more · {(filtered.length - shown).toLocaleString()} more
        </button>
      )}
    </div>
  );
}

// --- Personal Wizards: your own knowledge bases (promoted Sections or the chat
// builder). Nothing here moves files; a wizard is a view over its notes.
const { AskMessage: BkAskMessage, CitationChip: BkCitationChip } = bkNS;

function PersonalWizardCard({ w, onAsk, onOpen }) {
  return (
    <BkCard style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={bkS.cardIcon}><BkIcon name="wand-2" size={16} style={{ color: 'var(--brand-fg)' }} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={bkS.titleLink} onClick={() => onOpen(w)} title="Open details"
            onMouseEnter={(e) => { e.target.style.textDecoration = 'underline'; }} onMouseLeave={(e) => { e.target.style.textDecoration = 'none'; }}>{w.name}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}>{w.note_count} note{w.note_count === 1 ? '' : 's'}{w.folder ? ` · ${w.folder.split('/').pop()}` : ''}</div>
        </div>
        {w.share_scope && w.share_scope !== 'private' && <BkBadge tone="info">{w.share_scope}</BkBadge>}
      </div>
      {w.topic && w.topic !== w.name && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}><BkBadge tone="info">#{w.topic}</BkBadge></div>}
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 2 }}>
        <div style={{ flex: 1 }} />
        <BkButton variant="primary" size="sm" icon="sparkles" onClick={() => onAsk(w)}>Chat</BkButton>
      </div>
    </BkCard>
  );
}

// --- Connected tools: MCP servers + AI-tool hooks already wired into Lore.
// Status only here (install flows live in Settings/Hooks) — the catalog below
// covers everything not yet connected.
function ConnectedToolRow({ name, connected }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: '1px solid var(--divider)' }}>
      <BkIcon name={connected ? 'plug-zap' : 'plug'} size={14} style={{ color: connected ? 'var(--jade-400)' : 'var(--text-faint)' }} />
      <span style={{ flex: 1, fontSize: 13, color: 'var(--text-body)' }}>{name}</span>
      <BkBadge tone={connected ? 'success' : 'neutral'} dot>{connected ? 'Connected' : 'Not connected'}</BkBadge>
    </div>
  );
}

function ConnectedTools() {
  const [mcp, setMcp] = React.useState(null);
  const [hooks, setHooks] = React.useState(null);
  React.useEffect(() => {
    (async () => {
      try { setMcp(window.lore && window.lore.mcp && window.lore.mcp.detectTools ? await window.lore.mcp.detectTools() : {}); } catch { setMcp({}); }
      try { setHooks(window.lore && window.lore.hooks && window.lore.hooks.detect ? await window.lore.hooks.detect() : []); } catch { setHooks([]); }
    })();
  }, []);
  if (mcp === null || hooks === null) return null;
  const rows = [
    { name: 'Claude Code MCP', connected: !!(mcp.claude && mcp.claude.installed) },
    { name: 'Codex MCP', connected: !!(mcp.codex && mcp.codex.installed) },
    ...(hooks || []).map((h) => ({ name: h.name || h.id, connected: !!h.installed })),
  ];
  return (
    <div style={{ marginBottom: 22 }}>
      <h2 style={bkS.h2}>Connected</h2>
      <p style={bkS.sub}>What's wired into Lore right now — manage these from Settings / Connections.</p>
      <BkCard style={{ padding: 0, overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <div key={r.name} style={i === rows.length - 1 ? { borderBottom: 'none' } : undefined}>
            <ConnectedToolRow name={r.name} connected={r.connected} />
          </div>
        ))}
      </BkCard>
    </div>
  );
}

// --- Detail view: opened by clicking a card's title. Inline panel (no router):
// long description, what's inside, rating/installs, tags, Chat + Install.
function StoreDetail({ item, onBack, onChat, onInstall, onUninstall, onRate }) {
  const { kind, w } = item;                       // kind: 'catalog' | 'personal'
  const isTool = kind === 'catalog' && w.kind === 'tool';
  const [notes, setNotes] = React.useState(null); // personal wizards: real member notes
  React.useEffect(() => {
    if (kind !== 'personal') { setNotes(null); return; }
    let live = true;
    (async () => {
      try {
        const r = window.lore && window.lore.wizards && window.lore.wizards.personal && window.lore.wizards.personal.notes
          ? await window.lore.wizards.personal.notes(w.id) : { notes: [] };
        if (live) setNotes((r && r.notes) || []);
      } catch { if (live) setNotes([]); }
    })();
    return () => { live = false; };
  }, [kind, w.id]);

  const inside = kind === 'personal'
    ? (notes || []).map((n) => ({ key: n.id, label: n.title || n.id, sub: n.path }))
    : (w.noteTitles || []).map((t, i) => ({ key: i, label: t }));

  return (
    <div>
      <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12, padding: '2px 0', marginBottom: 14 }}>
        <BkIcon name="arrow-left" size={14} /> Back to store
      </button>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <span style={{ ...bkS.cardIcon, width: 44, height: 44 }}><BkIcon name={isTool ? 'plug-zap' : 'wand-2'} size={22} style={{ color: 'var(--brand-fg)' }} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-strong)', margin: 0 }}>{w.name}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 5, flexWrap: 'wrap' }}>
            {kind === 'catalog' && <>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)' }}>{w.author}</span>
              <BkStars value={w.myRating || Math.round(w.rating || 0)} onRate={(s) => onRate(w.id, s)} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>{w.rating} · {(w.installs || 0).toLocaleString()} installs</span>
            </>}
            {kind === 'personal' && <>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)' }}>{w.note_count} note{w.note_count === 1 ? '' : 's'}{w.folder ? ` · ${w.folder}` : ''}</span>
              <BkBadge tone={w.share_scope === 'private' ? 'neutral' : 'info'}>{w.share_scope || 'private'}</BkBadge>
            </>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!isTool && <BkButton variant="primary" icon="sparkles" onClick={() => onChat(item)}>Chat</BkButton>}
          {kind === 'catalog' && <InstallActions w={w} onInstall={onInstall} onUninstall={onUninstall} />}
        </div>
      </div>

      {kind === 'catalog' && !isTool && !w.installed && (
        <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '10px 0 0' }}>
          Chat works before installing — the preview answers from the catalog listing only. Install to add the notes to your library and chat over the full contents.
        </p>
      )}
      {kind === 'personal' && w.share_scope && w.share_scope !== 'private' && (
        <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '10px 0 0' }}>
          Marked {w.share_scope} — stored on the wizard now; it shares when team sync{w.share_scope === 'public' ? ' / the public store' : ''} lands.
        </p>
      )}

      <p style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--text-body)', margin: '16px 0 0', maxWidth: 720 }}>
        {kind === 'catalog' ? (w.desc || 'No description in the catalog.') : `Your own knowledge base — answers are drawn only from this wizard's notes. Notes stay where they are on disk; the wizard is a view over them.`}
      </p>

      {((kind === 'catalog' && (w.topics || []).length > 0) || (kind === 'personal' && w.topic && w.topic !== w.name)) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 12 }}>
          {kind === 'catalog'
            ? (w.topics || []).map((t) => <BkBadge key={t} tone="info">#{t}</BkBadge>)
            : <BkBadge tone="info">#{w.topic}</BkBadge>}
        </div>
      )}

      <div style={{ marginTop: 22 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)', margin: '0 0 8px' }}>What's inside</h3>
        {kind === 'personal' && notes === null && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-faint)' }}>Loading notes…</div>}
        {inside.length > 0 && (
          <BkCard style={{ padding: 0, overflow: 'hidden', maxWidth: 720 }}>
            {inside.map((n, i) => (
              <div key={n.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: i === inside.length - 1 ? 'none' : '1px solid var(--divider)' }}>
                <BkIcon name="file-text" size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.label}</span>
                {n.sub && <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '45%' }}>{n.sub}</span>}
              </div>
            ))}
          </BkCard>
        )}
        {kind === 'personal' && notes !== null && !inside.length && <p style={bkS.sub}>No notes resolved yet — is the backend running?</p>}
        {kind === 'catalog' && !inside.length && <p style={bkS.sub}>The catalog listing doesn't include a note list for this entry.</p>}
        {kind === 'catalog' && (w.sources || []).length > 0 && (
          <div style={{ marginTop: 12, maxWidth: 720 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)', margin: '0 0 6px' }}>Sources</h3>
            {(w.sources || []).map((s) => (
              <div key={s} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '2px 0' }}>{s}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
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
        const r = window.lore && window.lore.wizards && window.lore.wizards.personal && window.lore.wizards.personal.history
          ? await window.lore.wizards.personal.history(wizard.id) : { messages: [] };
        if (live) setMessages((r && r.messages) || []);
      } catch { if (live) setMessages([]); }
      if (live) setLoading(false);
    })();
    return () => { live = false; };
  }, [wizard.id]);

  React.useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, asking]);

  const send = async () => {
    const q = draft.trim();
    if (!q || asking) return;
    setDraft('');
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setAsking(true);
    try {
      const r = window.lore && window.lore.wizards && window.lore.wizards.personal && window.lore.wizards.personal.ask
        ? await window.lore.wizards.personal.ask(wizard.id, q) : { error: 'wizard ask unavailable' };
      setMessages((m) => [...m, { role: 'assistant', text: r.answer || r.error || '(no answer)', sources: r.citations }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: 'Error: ' + ((e && e.message) || String(e)) }]);
    }
    setAsking(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'var(--scrim-bg, rgba(0,0,0,0.35))' }} />
      <div style={{ position: 'relative', width: 'var(--ask-width, 380px)', height: '100%', background: 'var(--surface-panel)', borderLeft: '1px solid var(--border-strong)', boxShadow: 'var(--shadow-xl)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--divider)', flexShrink: 0 }}>
          <span style={{ width: 24, height: 24, borderRadius: 'var(--radius-sm)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)' }}>
            <BkIcon name="wand-2" size={14} style={{ color: 'var(--brand-fg)' }} />
          </span>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Ask {wizard.name}</span>
          <button onClick={onClose} aria-label="Close wizard chat" style={{ border: 'none', background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer', display: 'inline-flex', padding: 4 }}>
            <BkIcon name="x" size={16} />
          </button>
        </div>

        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 10px' }}>
          {!loading && messages.length === 0 && (
            <div style={{ padding: '24px 6px', textAlign: 'center' }}>
              <p style={{ fontFamily: 'var(--font-serif)', fontSize: 16, color: 'var(--text-body)', margin: '0 0 4px' }}>Ask {wizard.name}.</p>
              <p style={{ fontSize: 12.5, color: 'var(--text-subtle)', margin: 0, lineHeight: 1.5 }}>Answers are drawn only from this wizard's {wizard.note_count} note{wizard.note_count === 1 ? '' : 's'}.</p>
            </div>
          )}
          {loading && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-faint)', padding: '12px 0' }}>Loading chat…</div>}
          {messages.map((m, i) => (
            m.role === 'user'
              ? <BkAskMessage key={i} role="user">{m.text}</BkAskMessage>
              : (
                <div key={i}>
                  <BkAskMessage role="answer" sources={m.sources ? m.sources.length : undefined}>
                    <span style={{ whiteSpace: 'pre-wrap' }}>{m.text}</span>
                  </BkAskMessage>
                  {m.sources && m.sources.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, margin: '4px 0 4px 36px' }}>
                      {m.sources.map((c, ci) => <BkCitationChip key={ci} index={ci + 1} note={c.heading_path || c.note_id} />)}
                    </div>
                  )}
                </div>
              )
          ))}
          {asking && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)', padding: '4px 0 4px 36px' }}>thinking…</div>}
        </div>

        <div style={{ padding: '10px 12px 12px', borderTop: '1px solid var(--divider)', flexShrink: 0 }}>
          <div style={{ border: '1px solid var(--border-field)', borderRadius: 'var(--radius-md)', background: 'var(--surface-inset)', padding: 10 }}>
            <textarea
              value={draft} onChange={(e) => setDraft(e.target.value)} rows={2}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              aria-label={`Ask ${wizard.name}`}
              placeholder={`Ask ${wizard.name}…`}
              style={{ width: '100%', resize: 'none', border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--font-sans)', fontSize: 14, lineHeight: 1.5, color: 'var(--text-strong)' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              <button onClick={send} disabled={asking || !draft.trim()} aria-label="Send question" style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36,
                border: 'none', borderRadius: 'var(--radius-sm)', cursor: asking || !draft.trim() ? 'not-allowed' : 'pointer',
                background: 'var(--brand-bg)', color: 'var(--text-onbrand)', opacity: asking || !draft.trim() ? 0.5 : 1,
              }}><BkIcon name="arrow-up" size={15} /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// advancedMode gates the store surfaces: the Knowledge-bases/Tools tabs, the
// catalog browsers and shared collections are developer/store territory. The
// default Wizards view is just YOUR wizards + the create flow.
function BucketsView({ buckets, onAsk, onOpen, onChanged, scopes, advancedMode }) {
  const WizardBuilder = window.LoreWizardBuilder, CatalogPreviewChat = window.LoreCatalogPreviewChat;
  const [topTab, setTopTab] = React.useState('bases');   // 'bases' | 'tools'
  const [catalog, setCatalog] = React.useState(null);
  const [personal, setPersonal] = React.useState(null);
  const [detail, setDetail] = React.useState(null);       // {kind:'catalog'|'personal', id}
  const [chatWizard, setChatWizard] = React.useState(null); // personal wizard chat overlay
  const [preview, setPreview] = React.useState(null);     // catalog KB preview-chat overlay
  const [builderOpen, setBuilderOpen] = React.useState(false);

  const loadCatalog = React.useCallback(async () => {
    if (!window.lore || !window.lore.wizards || !window.lore.wizards.catalog) { setCatalog([]); return; }
    try { setCatalog(await window.lore.wizards.catalog()); } catch { setCatalog([]); }
  }, []);
  const loadPersonal = React.useCallback(async () => {
    if (!window.lore || !window.lore.wizards || !window.lore.wizards.personal || !window.lore.wizards.personal.list) { setPersonal([]); return; }
    try {
      const r = await window.lore.wizards.personal.list();
      setPersonal((r && r.wizards) || []);
    } catch { setPersonal([]); }
  }, []);
  React.useEffect(() => { loadCatalog(); loadPersonal(); }, [loadCatalog, loadPersonal]);

  const install = async (id) => { try { await window.lore.wizards.install(id); } catch { /* */ } await loadCatalog(); if (onChanged) onChanged(); };
  const rate = async (id, s) => { try { await window.lore.wizards.rate(id, s); } catch { /* */ } loadCatalog(); };
  const uninstall = async (id) => { try { await window.lore.wizards.uninstall(id); } catch { /* */ } await loadCatalog(); if (onChanged) onChanged(); };

  const kbCatalog = (catalog || []).filter((w) => w.kind === 'wizard');
  const toolCatalog = (catalog || []).filter((w) => w.kind === 'tool');
  // Resolve the detail item from live state so install/rate updates show through.
  const detailItem = detail && (detail.kind === 'catalog'
    ? (() => { const w = (catalog || []).find((x) => x.id === detail.id); return w && { kind: 'catalog', w }; })()
    : (() => { const w = (personal || []).find((x) => x.id === detail.id); return w && { kind: 'personal', w }; })());

  const openDetail = (kind) => (w) => setDetail({ kind, id: w.id });
  // Chat from the detail view: personal → the wizard's own persisted RAG chat;
  // installed catalog KB → its notes are in the library, so the real Ask panel;
  // uninstalled catalog KB → honest metadata-only preview chat.
  const chatFor = (item) => {
    if (item.kind === 'personal') setChatWizard(item.w);
    else if (item.w.installed) onAsk();
    else setPreview(item.w);
  };
  const onCreated = (wizard) => {
    setBuilderOpen(false);
    loadPersonal();
    if (wizard && wizard.id) setChatWizard(wizard);   // working chat, immediately
  };

  const topTabs = [
    { value: 'bases', label: 'Knowledge bases', count: kbCatalog.length + (personal || []).length + (buckets || []).length },
    { value: 'tools', label: 'Tools', count: toolCatalog.length },
  ];

  return (
    <div style={bkS.wrap}>
      <div style={bkS.head}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-3xl)', fontWeight: 600, color: 'var(--text-strong)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="design/assets/sprites/codex-tome.png" alt="" style={{ width: 28, height: 28, objectFit: 'contain', verticalAlign: 'middle' }} onError={(e) => { e.target.style.display = 'none'; }} />
            Wizards
            {window.LoreHelpHint && <window.LoreHelpHint size={16} tip="A Wizard is a knowledge base — a curated bundle of notes you can chat with (e.g. a Security playbook or Trading strategies). A note can live in many Wizards at once, unlike a folder, which it only sits in one of. Tools are different: plugins that connect outside data into Lore." />}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: '4px 0 0' }}>Knowledge bases you can chat with, and tools that connect outside data into Lore.</p>
        </div>
        <div style={{ flex: 1 }} />
        <BkButton variant="secondary" icon="sparkles" onClick={onAsk}>Ask all wizards</BkButton>
        <BkButton variant="primary" icon="wand-2" onClick={() => setBuilderOpen(true)}>Create a wizard</BkButton>
      </div>
      <div style={bkS.body}>
        {detailItem
          ? <StoreDetail item={detailItem} onBack={() => setDetail(null)} onChat={chatFor} onInstall={install} onUninstall={uninstall} onRate={rate} />
          : <>
            {advancedMode && (
              <div style={{ marginBottom: 18 }}>
                <BkTabs value={topTab} onChange={setTopTab} tabs={topTabs} />
              </div>
            )}

            {(!advancedMode || topTab === 'bases') && <>
              <BkCard style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
                <span style={{ ...bkS.cardIcon, width: 40, height: 40 }}><BkIcon name="wand-2" size={20} style={{ color: 'var(--brand-fg)' }} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--text-strong)' }}>Create a wizard from your notes</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', marginTop: 2 }}>Describe what you want — “everything about my trading bots” — Lore finds the notes, you confirm, and it's ready to chat. Notes stay where they are.</div>
                </div>
                <BkButton variant="primary" icon="wand-2" onClick={() => setBuilderOpen(true)}>Create a wizard</BkButton>
              </BkCard>

              <div style={{ marginBottom: 22 }}>
                <h2 style={bkS.h2}>Personal</h2>
                {personal !== null && personal.length === 0
                  ? <p style={bkS.sub}>No wizards of your own yet — create one above, or review what Lore tidied (sidebar → ✨) and turn a group into a folder.</p>
                  : <>
                    <p style={bkS.sub}>Wizards built from your own notes — each chat answers only from its own notes.</p>
                    <div style={bkS.grid}>
                      {(personal || []).map((w) => <PersonalWizardCard key={w.id} w={w} onAsk={setChatWizard} onOpen={openDetail('personal')} />)}
                    </div>
                  </>}
              </div>

              {advancedMode && (buckets || []).length > 0 && (
                <div style={{ marginBottom: 22 }}>
                  <h2 style={bkS.h2}>Shared collections</h2>
                  <p style={bkS.sub}>Knowledge bases pooled with your team — a note can live in many at once.</p>
                  <div style={bkS.grid}>
                    {buckets.map((b) => <BucketCard key={b.id} b={b} onOpen={() => onOpen && onOpen(b)} />)}
                  </div>
                </div>
              )}

              {advancedMode && (catalog === null
                ? <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-faint)', padding: '12px 0' }}>Loading catalog…</div>
                : kbCatalog.length > 0 && (
                  <div>
                    <h2 style={bkS.h2}>Discover knowledge bases</h2>
                    <p style={bkS.sub}>Published note bundles, curated from the web. Click a title for details; chat previews work before installing.</p>
                    <CatalogBrowser items={kbCatalog} placeholder="Search knowledge bases…" onInstall={install} onRate={rate} onUninstall={uninstall} onOpen={openDetail('catalog')} />
                  </div>
                ))}
            </>}

            {advancedMode && topTab === 'tools' && <>
              <p style={{ ...bkS.sub, margin: '0 0 18px' }}>Plugins that connect external data and capabilities INTO Lore — MCP servers, agent skills, and marketplace integrations. Knowledge bases (note bundles) live in the other tab.</p>
              <ConnectedTools />
              {catalog === null
                ? <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-faint)', padding: '12px 0' }}>Loading catalog…</div>
                : <div>
                    <h2 style={bkS.h2}>Discover tools</h2>
                    <p style={bkS.sub}>{toolCatalog.length.toLocaleString()} available from the cloud marketplace. Install to wire one into your library.</p>
                    <CatalogBrowser items={toolCatalog} placeholder="Search tools…"
                      chips={['all', 'skill', 'mcp', 'marketplace']} chipOf={(w) => (w.topics && w.topics[0]) || 'tool'}
                      onInstall={install} onRate={rate} onUninstall={uninstall} onOpen={openDetail('catalog')} />
                  </div>}
            </>}
          </>}
      </div>
      {chatWizard && <PersonalWizardChat wizard={chatWizard} onClose={() => setChatWizard(null)} />}
      {preview && CatalogPreviewChat && <CatalogPreviewChat w={preview} onClose={() => setPreview(null)} onInstall={async () => { const id = preview.id; setPreview(null); await install(id); }} />}
      {builderOpen && WizardBuilder && <WizardBuilder scopes={scopes} onClose={() => setBuilderOpen(false)} onCreated={onCreated} />}
    </div>
  );
}

window.LoreBucketsView = BucketsView;
