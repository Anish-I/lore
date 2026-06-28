/* global React */
// Lore desktop — Ask panel (cited recall chatbot + evidence trail)
const akNS = window.VaultDesignSystem_ffbf58;
const { Icon: AkIcon, IconButton: AkIconBtn, AskMessage, CitationChip, EvidenceRow, Kbd: AkKbd, ScopeTag: AkScope } = akNS;

const akS = {
  panel: { width: 'var(--ask-width)', flexShrink: 0, background: 'var(--surface-panel)', borderLeft: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--divider)', flexShrink: 0 },
  scroll: { flex: 1, overflowY: 'auto', padding: '8px 14px 10px' },
  composerWrap: { position: 'relative', flexShrink: 0, padding: '12px 14px 14px' },
  scrim: { position: 'absolute', left: 0, right: 0, top: -22, height: 22, background: 'var(--scrim-to-panel)', pointerEvents: 'none' },
  composer: { border: '1px solid var(--border-field)', borderRadius: 'var(--radius-md)', background: 'var(--surface-inset)', padding: 10 },
};

function AnswerRuns({ runs, onCite }) {
  return runs.map((r, i) => {
    if (r.mark) return <mark key={i} style={{ background: 'var(--highlight-bg)', color: 'var(--text-strong)', borderRadius: 2, padding: '0 2px' }}>{r.x}</mark>;
    if (r.cite) return <React.Fragment key={i}>{r.x}<CitationChip index={r.cite} note="source" onClick={() => onCite && onCite(r.cite)} /></React.Fragment>;
    return <span key={i}>{r.x}</span>;
  });
}

function Evidence({ rows }) {
  const [open, setOpen] = React.useState(true);
  return (
    <div style={{ margin: '6px 0 4px 36px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--surface-base)' }}>
      <button onClick={() => setOpen(!open)} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
        border: 'none', background: 'transparent', cursor: 'pointer',
        fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-subtle)',
      }}>
        <AkIcon name="git-commit-horizontal" size={13} />
        <span>why retrieved · {rows.length} chunks</span>
        <AkIcon name="chevron-down" size={13} style={{ marginLeft: 'auto', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform var(--dur-fast) var(--ease-out)' }} />
      </button>
      {open && <div style={{ padding: '2px 4px 6px' }}>{rows.map((r) => <EvidenceRow key={r.index} {...r} onOpen={() => {}} />)}</div>}
    </div>
  );
}

function SourceToggle({ value, onChange }) {
  const opts = [
    { id: 'me', label: 'Me', icon: 'lock' },
    { id: 'team', label: 'Team', icon: 'users' },
    { id: 'both', label: 'Both', icon: 'layers' },
  ];
  return (
    <div style={{ display: 'flex', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-full)', padding: 2, gap: 2 }}>
      {opts.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} title={`Ask from ${o.label.toLowerCase()}`} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', cursor: 'pointer', border: 'none',
          borderRadius: 'var(--radius-full)', fontFamily: 'var(--font-mono)', fontSize: 10.5,
          background: value === o.id ? 'var(--brand-soft-bg)' : 'transparent',
          color: value === o.id ? 'var(--brand-fg)' : 'var(--text-faint)', fontWeight: value === o.id ? 600 : 400,
        }}>
          <AkIcon name={o.icon} size={11} />{o.label}
        </button>
      ))}
    </div>
  );
}

function AskPanel({ messages, asking, suggestions, onSend, onClose, source, onSource }) {
  const [draft, setDraft] = React.useState('');
  const scrollRef = React.useRef(null);
  React.useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, asking]);
  const send = (q) => { const v = (q ?? draft).trim(); if (!v || asking) return; setDraft(''); onSend(v); };

  return (
    <div style={akS.panel}>
      <div style={akS.header}>
        <span style={{ width: 24, height: 24, borderRadius: 'var(--radius-sm)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)' }}>
          <AkIcon name="sparkles" size={14} style={{ color: 'var(--brand-fg)' }} />
        </span>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>Ask Lore</span>
        <SourceToggle value={source || 'both'} onChange={onSource || (() => {})} />
        <AkIconBtn icon="x" label="Close Ask" size="sm" onClick={onClose} />
      </div>

      <div style={akS.scroll} ref={scrollRef}>
        {messages.length === 0 && (
          <div style={{ padding: '24px 6px' }}>
            <p style={{ fontFamily: 'var(--font-serif)', fontSize: 17, color: 'var(--text-body)', margin: '0 0 4px' }}>Ask across your vaults.</p>
            <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: '0 0 16px', lineHeight: 1.5 }}>Answers are drawn only from notes in your scope, and every claim is cited.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {suggestions.map((s) => (
                <button key={s} onClick={() => send(s)} style={{
                  textAlign: 'left', display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px',
                  border: '1px solid var(--border)', background: 'var(--surface-base)', borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-body)', fontFamily: 'var(--font-sans)', fontSize: 13, cursor: 'pointer',
                }}>
                  <AkIcon name="corner-down-right" size={14} style={{ color: 'var(--text-faint)' }} />{s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          m.role === 'user'
            ? <AskMessage key={i} role="user">{m.text}</AskMessage>
            : (
              <div key={i}>
                <AskMessage role="answer" sources={m.streaming ? undefined : m.sources} scopes={m.streaming ? undefined : m.scopes} streaming={m.streaming}>
                  <AnswerRuns runs={m.shown || m.runs} />
                </AskMessage>
                {!m.streaming && m.evidence && <Evidence rows={m.evidence} />}
              </div>
            )
        ))}
      </div>

      <div style={akS.composerWrap}>
        <div style={akS.scrim} />
        <div style={akS.composer}>
          <textarea
            value={draft} onChange={(e) => setDraft(e.target.value)} rows={2}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask anything about your knowledge…"
            style={{ width: '100%', resize: 'none', border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--font-sans)', fontSize: 14, lineHeight: 1.5, color: 'var(--text-strong)' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <AkScope scope="team" size="sm" />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}>cites sources</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}><AkKbd>↵</AkKbd> send</span>
            <button onClick={() => send()} disabled={asking} style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30,
              border: 'none', borderRadius: 'var(--radius-sm)', cursor: asking ? 'default' : 'pointer',
              background: 'var(--brand-bg)', color: 'var(--text-onbrand)', opacity: asking ? 0.5 : 1,
            }}><AkIcon name="arrow-up" size={16} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

window.LoreAskPanel = AskPanel;
