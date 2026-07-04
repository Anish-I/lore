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

// Per-citation source label — THE transparency feature: when the bot answers,
// each citation chip says which note it came from AND whose knowledge it is
// ("PairStrategy · Private" / "roadmap · Team"). Right-click a private chip to
// push that note to the team (routes through the same redaction-gated flow).
function AkCiteScopeLabel(scope) {
  const s = String(scope || '').toLowerCase();
  if (s === 'team') return 'Team';
  if (s === 'company' || s === 'enterprise') return 'Company';
  return 'Private';
}
function AkCiteDot(scope) {
  const s = String(scope || '').toLowerCase();
  if (s === 'team') return 'var(--azure-500)';                      // azure = team
  if (s === 'company' || s === 'enterprise') return 'var(--amber-400)';
  return 'var(--jade-500)';                                         // jade = private
}
function CitationSources({ citations, onCiteScope }) {
  const list = citations || [];
  if (!list.length) return null;
  const seen = new Set();
  const unique = list.filter((c) => {
    if (!c || !c.note_id || seen.has(c.note_id)) return false;
    seen.add(c.note_id);
    return true;
  });
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, margin: '4px 0 4px 36px' }}>
      {unique.map((c) => (
        <span key={c.note_id}
          title={`${c.heading_path || c.title}${onCiteScope && AkCiteScopeLabel(c.scope) === 'Private' ? ' — right-click to push to your team' : ''}`}
          onContextMenu={(e) => {
            e.preventDefault();
            if (!onCiteScope) return;
            if (AkCiteScopeLabel(c.scope) !== 'Private') return;
            if (window.confirm(`Push “${c.title}” to your team?`)) onCiteScope(c, 'team');
          }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-full)', background: 'var(--surface-inset)', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', maxWidth: 220 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: AkCiteDot(c.scope), flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || c.note_id}</span>
          <span style={{ color: 'var(--text-faint)', flexShrink: 0 }}>· {AkCiteScopeLabel(c.scope)}</span>
        </span>
      ))}
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

function AskHistoryDrawer({ threads, onResume, onDelete, onClose }) {
  const ago = (iso) => {
    const d = Date.parse(iso);
    if (Number.isNaN(d)) return '';
    const s = Math.max(0, Math.round((Date.now() - d) / 1000));
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  };
  return (
    <React.Fragment>
      <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={onClose} />
      <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 8, zIndex: 41, width: 280, maxHeight: 340, overflowY: 'auto', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-xl)' }}>
        <div style={{ padding: '7px 10px', borderBottom: '1px solid var(--divider)', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Past conversations</div>
        {threads === null && <div style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>Loading…</div>}
        {Array.isArray(threads) && threads.length === 0 && (
          <div style={{ padding: '12px 12px', fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.5 }}>No saved conversations yet — ask something and it lands here.</div>
        )}
        {(threads || []).map((t) => (
          <div key={t.thread_id} onClick={() => { onClose(); onResume(t.thread_id); }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <AkIcon name="message-circle" size={13} style={{ color: 'var(--brand-fg)', flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12.5, color: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', marginTop: 1 }}>{t.count} turn{t.count === 1 ? '' : 's'}{t.updated_at ? ` · ${ago(t.updated_at)}` : ''}</div>
            </div>
            <span onClick={(e) => { e.stopPropagation(); onDelete(t.thread_id); }} title="Delete this conversation"
              style={{ display: 'inline-flex', padding: 3, borderRadius: 3, color: 'var(--text-faint)', cursor: 'pointer' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--clay-400)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-faint)'; }}>
              <AkIcon name="trash-2" size={12} />
            </span>
          </div>
        ))}
      </div>
    </React.Fragment>
  );
}

function AskPanel({ messages, asking, suggestions, onSend, onClose, source, onSource, sourceOptions, identityReady, onSetup,
  threads, onLoadThreads, onResumeThread, onDeleteThread, onNewChat, onCiteScope, providers, defaultProvider }) {
  const [draft, setDraft] = React.useState('');
  // Answering engine = the user's own subscriptions/key (same providers as
  // Settings -> AI provider), defaulting to their Settings choice. 'local' is
  // the on-device fallback (Ollama) and always offered.
  const AK_PROVIDERS = [
    { id: 'claude', label: 'Claude (your subscription)' },
    { id: 'codex', label: 'Codex (your subscription)' },
    { id: 'byok', label: 'Your API key' },
    { id: 'local', label: 'On-device (fallback)' },
  ];
  const available = AK_PROVIDERS.filter((p) => p.id === 'local' || (providers && providers[p.id]));
  const [model, setModel] = React.useState(null); // provider id; null until defaulted
  const provider = model || (available.some((p) => p.id === defaultProvider) ? defaultProvider : (available[0] && available[0].id));
  const providerLabel = (AK_PROVIDERS.find((p) => p.id === provider) || {}).label || provider || 'auto';
  const [showCites, setShowCites] = React.useState(true);
  const [cog, setCog] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const akSel = { width: '100%', marginTop: 4, padding: '5px 7px', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-strong)', fontFamily: 'var(--font-mono)', fontSize: 11.5, outline: 'none' };
  const scrollRef = React.useRef(null);
  React.useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, asking]);
  const send = (q) => { const v = (q ?? draft).trim(); if (!v || asking || !identityReady) return; setDraft(''); onSend(v, null, provider === 'local' ? null : provider); };
  const openHistory = () => {
    setHistoryOpen((o) => {
      const next = !o;
      if (next && onLoadThreads) onLoadThreads();
      return next;
    });
  };

  return (
    <div style={akS.panel}>
      <div style={{ ...akS.header, position: 'relative' }}>
        <span style={{ width: 24, height: 24, borderRadius: 'var(--radius-sm)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)' }}>
          <AkIcon name="sparkles" size={14} style={{ color: 'var(--brand-fg)' }} />
        </span>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>Ask Lore</span>
        {/* Nothing to actually pick between with 0-1 sources ("All" + one identical
            option) — the toggle only earns its place once there's a real choice. */}
        {sourceOptions && sourceOptions.length > 2 && (
          <SourceToggle value={source || 'all'} onChange={onSource || (() => {})} options={sourceOptions} />
        )}
        {onNewChat && messages.length > 0 && <AkIconBtn icon="plus" label="New conversation" size="sm" onClick={onNewChat} />}
        {onResumeThread && <AkIconBtn icon="history" label="Past conversations" size="sm" onClick={openHistory} />}
        {onClose && <AkIconBtn icon="x" label="Close Ask" size="sm" onClick={onClose} />}
        {historyOpen && (
          <AskHistoryDrawer threads={threads} onClose={() => setHistoryOpen(false)}
            onResume={onResumeThread} onDelete={(id) => { if (onDeleteThread) onDeleteThread(id); }} />
        )}
      </div>

      <div style={akS.scroll} ref={scrollRef}>
        {messages.length === 0 && (
          <div style={{ padding: '24px 6px' }}>
            <img src="design/assets/sprites/lore-familiar.png" alt="" aria-hidden="true"
              style={{ display: 'block', width: 132, height: 132, margin: '0 auto 10px', objectFit: 'contain', filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.28))', pointerEvents: 'none', userSelect: 'none' }} />
            <p style={{ fontFamily: 'var(--font-serif)', fontSize: 17, color: 'var(--text-body)', margin: '0 0 4px', textAlign: 'center' }}>Ask across your libraries.</p>
            <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: '0 0 16px', lineHeight: 1.5, textAlign: 'center' }}>Answers are drawn only from notes you can see, and every claim is cited.</p>
            {!identityReady && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, marginBottom: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface-inset)', textAlign: 'left' }}>
                <AkIcon name="alert-circle" size={15} style={{ color: 'var(--brand-fg)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-body)', lineHeight: 1.45 }}>Finish setup before asking Lore.</span>
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
              {suggestions.length > 0 && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', textAlign: 'center', marginTop: 2 }}>these learn from what you ask</div>
              )}
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
                {showCites && !m.streaming && <CitationSources citations={m.citations} onCiteScope={onCiteScope} />}
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
            placeholder={identityReady ? 'Ask anything about your knowledge…' : 'Finish setup to ask Lore…'}
            style={{ width: '100%', resize: 'none', border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--font-sans)', fontSize: 14, lineHeight: 1.5, color: 'var(--text-strong)' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, position: 'relative' }}>
            <button onClick={() => setCog((c) => !c)} title="Model, source & citations" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 24, padding: '0 9px', border: '1px solid var(--border)', borderRadius: 'var(--radius-full)', background: cog ? 'var(--surface-raised)' : 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
              <AkIcon name="sliders-horizontal" size={12} />{providerLabel} · {source || 'all'}{showCites ? ' · cites' : ''}
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
                  <select value={provider} onChange={(e) => setModel(e.target.value)} style={akSel}>
                    {available.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </label>
                <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)' }}>Source
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
