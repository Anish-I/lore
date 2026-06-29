/* global React */
// Lore desktop — Ask panel (cited recall chatbot + evidence trail)
const akNS = window.VaultDesignSystem_ffbf58;
const { Icon: AkIcon, IconButton: AkIconBtn, AskMessage, CitationChip, EvidenceRow, Kbd: AkKbd, ScopeTag: AkScope } = akNS;

// Render final answers as real Markdown (headings/lists/code/bold) — Claude-style — not a flat word blob.
const akMd = window.markdownit ? window.markdownit({ html: false, linkify: true, breaks: true }) : null;
if (typeof document !== 'undefined' && !document.getElementById('ak-md-style')) {
  const s = document.createElement('style'); s.id = 'ak-md-style';
  s.textContent = `.ak-md{font-size:14px;line-height:1.62;color:var(--text-body)}.ak-md>:first-child{margin-top:0}.ak-md>:last-child{margin-bottom:0}.ak-md p{margin:0 0 9px}.ak-md h1,.ak-md h2,.ak-md h3,.ak-md h4{font-family:var(--font-serif);color:var(--text-strong);font-weight:600;line-height:1.3;margin:14px 0 6px}.ak-md h1{font-size:18px}.ak-md h2{font-size:16px}.ak-md h3{font-size:14.5px}.ak-md ul,.ak-md ol{margin:4px 0 9px;padding-left:20px}.ak-md li{margin:3px 0}.ak-md li>ul,.ak-md li>ol{margin:3px 0}.ak-md code{background:var(--surface-inset);border:1px solid var(--border);border-radius:4px;padding:1px 5px;font-family:var(--font-mono);font-size:12.5px}.ak-md pre{background:var(--surface-inset);border:1px solid var(--border);border-radius:var(--radius-md);padding:11px 13px;overflow-x:auto;margin:9px 0}.ak-md pre code{background:none;border:none;padding:0;font-size:12.5px}.ak-md strong{color:var(--text-strong);font-weight:600}.ak-md a{color:var(--brand-fg);text-decoration:none}.ak-md blockquote{border-left:3px solid var(--border-strong);margin:9px 0;padding:2px 0 2px 13px;color:var(--text-muted)}.ak-md hr{border:none;border-top:1px solid var(--divider);margin:12px 0}.ak-md table{border-collapse:collapse;margin:9px 0;font-size:13px}.ak-md th,.ak-md td{border:1px solid var(--border);padding:5px 9px;text-align:left}`;
  document.head.appendChild(s);
}
function AkMarkdown({ text }) {
  if (!akMd) return <span style={{ whiteSpace: 'pre-wrap' }}>{text}</span>;
  return <div className="ak-md" dangerouslySetInnerHTML={{ __html: akMd.render(String(text || '')) }} />;
}

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

function SourceToggle({ value, onChange, options }) {
  const opts = (options && options.length ? options : [{ value: 'all', label: 'All', icon: 'layers' }]).map((o) => ({
    id: o.value || o.id,
    label: o.label || o.value || o.id,
    icon: o.icon || 'tag',
  }));
  return (
    <div style={{ display: 'flex', minWidth: 0, maxWidth: 190, background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-full)', padding: 2, gap: 2, overflow: 'hidden' }}>
      {opts.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} title={`Ask from ${o.label}`} style={{
          minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', cursor: 'pointer', border: 'none',
          borderRadius: 'var(--radius-full)', fontFamily: 'var(--font-mono)', fontSize: 10.5,
          background: value === o.id ? 'var(--brand-soft-bg)' : 'transparent',
          color: value === o.id ? 'var(--brand-fg)' : 'var(--text-faint)', fontWeight: value === o.id ? 600 : 400,
        }}>
          <AkIcon name={o.icon} size={11} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function AskPanel({ messages, asking, suggestions, onSend, onClose, source, onSource, sourceOptions, identityReady, onSetup }) {
  const [draft, setDraft] = React.useState('');
  const [model, setModel] = React.useState('gemma4:e4b (local)');
  const [showCites, setShowCites] = React.useState(true);
  const [cog, setCog] = React.useState(false);
  const akSel = { width: '100%', marginTop: 4, padding: '5px 7px', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-strong)', fontFamily: 'var(--font-mono)', fontSize: 11.5, outline: 'none' };
  const scrollRef = React.useRef(null);
  React.useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, asking]);
  const send = (q) => { const v = (q ?? draft).trim(); if (!v || asking || !identityReady) return; setDraft(''); onSend(v, model.split(' ')[0]); };

  return (
    <div style={akS.panel}>
      <div style={akS.header}>
        <span style={{ width: 24, height: 24, borderRadius: 'var(--radius-sm)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)' }}>
          <AkIcon name="sparkles" size={14} style={{ color: 'var(--brand-fg)' }} />
        </span>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>Ask Lore</span>
        <SourceToggle value={source || 'all'} onChange={onSource || (() => {})} options={sourceOptions} />
        <AkIconBtn icon="x" label="Close Ask" size="sm" onClick={onClose} />
      </div>

      <div style={akS.scroll} ref={scrollRef}>
        {messages.length === 0 && (
          <div style={{ padding: '24px 6px' }}>
            <img src="design/assets/sprites/lore-familiar.png" alt="" aria-hidden="true"
              style={{ display: 'block', width: 132, height: 132, margin: '0 auto 10px', objectFit: 'contain', filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.28))', pointerEvents: 'none', userSelect: 'none' }} />
            <p style={{ fontFamily: 'var(--font-serif)', fontSize: 17, color: 'var(--text-body)', margin: '0 0 4px', textAlign: 'center' }}>Ask across your libraries.</p>
            <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: '0 0 16px', lineHeight: 1.5, textAlign: 'center' }}>Answers are drawn only from notes in your scope, and every claim is cited.</p>
            {!identityReady && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, marginBottom: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface-inset)', textAlign: 'left' }}>
                <AkIcon name="alert-circle" size={15} style={{ color: 'var(--brand-fg)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-body)', lineHeight: 1.45 }}>Set a tenant and scope before asking Lore.</span>
                <button onClick={onSetup} style={{ border: '1px solid var(--border)', background: 'var(--surface-raised)', color: 'var(--text-body)', borderRadius: 'var(--radius-sm)', padding: '5px 9px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11 }}>Configure</button>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {suggestions.map((s) => (
                <button key={s} onClick={() => send(s)} disabled={!identityReady || asking} style={{
                  textAlign: 'left', display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px',
                  border: '1px solid var(--border)', background: 'var(--surface-base)', borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-body)', fontFamily: 'var(--font-sans)', fontSize: 13, cursor: identityReady ? 'pointer' : 'not-allowed', opacity: identityReady ? 1 : 0.5,
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
                  {m.streaming
                    ? <AnswerRuns runs={m.shown || m.runs} />
                    : <AkMarkdown text={m.text || (m.shown || m.runs || []).map((r) => r.x).join('')} />}
                </AskMessage>
                {showCites && !m.streaming && m.evidence && <Evidence rows={m.evidence} />}
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
            aria-label="Ask Lore question"
            placeholder={identityReady ? 'Ask anything about your knowledge…' : 'Configure tenant and scope to ask Lore…'}
            style={{ width: '100%', resize: 'none', border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--font-sans)', fontSize: 14, lineHeight: 1.5, color: 'var(--text-strong)' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, position: 'relative' }}>
            <button onClick={() => setCog((c) => !c)} title="Model, scope & citations" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 24, padding: '0 9px', border: '1px solid var(--border)', borderRadius: 'var(--radius-full)', background: cog ? 'var(--surface-raised)' : 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
              <AkIcon name="sliders-horizontal" size={12} />{model.split(' ')[0]} · {source || 'all'}{showCites ? ' · cites' : ''}
            </button>
            <div style={{ flex: 1 }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}><AkKbd>↵</AkKbd> send</span>
            <button onClick={() => send()} disabled={asking || !identityReady || !draft.trim()} aria-label="Send question" style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44,
              border: 'none', borderRadius: 'var(--radius-sm)', cursor: asking || !identityReady || !draft.trim() ? 'not-allowed' : 'pointer',
              background: 'var(--brand-bg)', color: 'var(--text-onbrand)', opacity: asking || !identityReady || !draft.trim() ? 0.5 : 1,
            }}><AkIcon name="arrow-up" size={16} /></button>

            {cog && (
              <div style={{ position: 'absolute', bottom: 32, left: 0, width: 232, padding: 11, background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', zIndex: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)' }}>Model
                  <select value={model} onChange={(e) => setModel(e.target.value)} style={akSel}>
                    {['gemma4:e4b (local)', 'llama4-maverick (local)', 'qwen2.5 (local)'].map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
                <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)' }}>Scope
                  <select value={source || 'all'} onChange={(e) => onSource && onSource(e.target.value)} style={akSel}>
                    {(sourceOptions && sourceOptions.length ? sourceOptions : [{ value: 'all', label: 'All configured' }]).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-body)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={showCites} onChange={(e) => setShowCites(e.target.checked)} />
                  Cite sources
                </label>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

window.LoreAskPanel = AskPanel;
