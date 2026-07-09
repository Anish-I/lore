/* global React */
// Lore desktop — Ask panel (docked 392px, Hybrid design): cited recall chatbot,
// "FROM THESE PAGES" receipts card, About/Looking-in context chip composer.
const akNS = window.VaultDesignSystem_ffbf58;
const { Icon: AkIcon, IconButton: AkIconBtn, EvidenceRow, Kbd: AkKbd } = akNS;

// Render final answers as real Markdown (headings/lists/code/bold) — not a flat word blob.
const akMd = window.markdownit ? window.markdownit({ html: false, linkify: true, breaks: true }) : null;
if (typeof document !== 'undefined' && !document.getElementById('ak-md-style')) {
  const s = document.createElement('style'); s.id = 'ak-md-style';
  s.textContent = `.ak-md{font-size:13.5px;line-height:1.62;color:var(--text-body)}.ak-md>:first-child{margin-top:0}.ak-md>:last-child{margin-bottom:0}.ak-md p{margin:0 0 9px}.ak-md h1,.ak-md h2,.ak-md h3,.ak-md h4{color:var(--text-strong);font-weight:600;line-height:1.3;margin:14px 0 6px}.ak-md h1{font-size:16px}.ak-md h2{font-size:15px}.ak-md h3{font-size:14px}.ak-md ul,.ak-md ol{margin:4px 0 9px;padding-left:20px}.ak-md li{margin:3px 0}.ak-md li>ul,.ak-md li>ol{margin:3px 0}.ak-md code{background:var(--surface-inset);border:1px solid var(--border);border-radius:4px;padding:1px 5px;font-family:var(--font-mono);font-size:12px}.ak-md pre{background:var(--surface-inset);border:1px solid var(--border);border-radius:var(--radius-md);padding:11px 13px;overflow-x:auto;margin:9px 0}.ak-md pre code{background:none;border:none;padding:0;font-size:12px}.ak-md strong{color:var(--text-strong);font-weight:600}.ak-md a{color:var(--brand-fg);text-decoration:none}.ak-md blockquote{border-left:3px solid var(--border-strong);margin:9px 0;padding:2px 0 2px 13px;color:var(--text-muted)}.ak-md hr{border:none;border-top:1px solid var(--divider);margin:12px 0}.ak-md table{border-collapse:collapse;margin:9px 0;font-size:12.5px}.ak-md th,.ak-md td{border:1px solid var(--border);padding:5px 9px;text-align:left}`
    + `.ak-ref{color:var(--brand-fg);border-bottom:1px dotted var(--brand-fg);cursor:help;}`
    + `.ak-caret{display:inline-block;width:7px;height:15px;background:var(--amber-400);vertical-align:-2px;margin-left:2px;animation:lore-caret 1s step-end infinite;}`;
  document.head.appendChild(s);
}
function akEscapeHtml(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// refs: [{title, preview}] — every "[Title]" the model cited becomes a marked
// span whose hover shows what that note actually says (the retrieved passage).
function AkMarkdown({ text, refs }) {
  if (!akMd) return <span style={{ whiteSpace: 'pre-wrap' }}>{text}</span>;
  let html = akMd.render(String(text || ''));
  (refs || []).forEach((r) => {
    if (!r || !r.title) return;
    const esc = akEscapeHtml(r.title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const preview = akEscapeHtml((r.preview || '').replace(/\s+/g, ' ').trim());
    if (!preview) return;
    html = html.replace(new RegExp('\\[' + esc + '\\]', 'g'),
      `<span class="ak-ref" title="${preview}">${akEscapeHtml(r.title)}</span>`);
  });
  return <div className="ak-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

const akS = {
  panel: { width: 'var(--ask-width)', flexShrink: 0, background: 'var(--surface-panel)', borderLeft: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--divider)', flexShrink: 0 },
  scroll: { flex: 1, overflowY: 'auto', padding: '12px 14px 10px' },
  composerWrap: { position: 'relative', flexShrink: 0, padding: '10px 14px 14px' },
  scrim: { position: 'absolute', left: 0, right: 0, top: -22, height: 22, background: 'var(--scrim-to-panel)', pointerEvents: 'none' },
  composer: { border: '1px solid var(--border-field)', borderRadius: 12, background: 'var(--surface-canvas)', padding: 10 },
};

function akPlaceOf(scope) {
  const s = String(scope || '').toLowerCase();
  if (s === 'team') return 'team';
  if (s === 'company' || s === 'enterprise') return 'company';
  return 'my';
}

function AnswerRuns({ runs }) {
  return runs.map((r, i) => {
    if (r.mark) return <mark key={i} style={{ background: 'var(--highlight-bg)', color: 'var(--text-strong)', borderRadius: 2, padding: '0 2px' }}>{r.x}</mark>;
    return <span key={i}>{r.x}</span>;
  });
}

function Evidence({ rows }) {
  const [open, setOpen] = React.useState(false); // consolidated: opt-in detail
  const [showAll, setShowAll] = React.useState(false);
  return (
    <div style={{ borderTop: '1px solid var(--divider)' }}>
      <button onClick={() => setOpen(!open)} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
        border: 'none', background: 'transparent', cursor: 'pointer',
        fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)',
      }}>
        <AkIcon name="git-commit-horizontal" size={12} />
        <span>why retrieved · {rows.length} chunks</span>
        <AkIcon name="chevron-down" size={12} style={{ marginLeft: 'auto', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform var(--dur-fast) var(--ease-out)' }} />
      </button>
      {open && (
        <div style={{ padding: '2px 4px 6px' }}>
          {(showAll ? rows : rows.slice(0, 4)).map((r) => <EvidenceRow key={r.index} {...r} onOpen={() => {}} />)}
          {rows.length > 4 && (
            <button onClick={() => setShowAll((v) => !v)} style={{ border: 'none', background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10.5, padding: '4px 8px' }}>
              {showAll ? 'show less' : `show all ${rows.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
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
  return (
    <div style={{ margin: '6px 0 10px 34px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-base)', overflow: 'hidden' }}>
      {unique.length > 0 && (
        <div style={{ padding: '9px 12px 4px', fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.07em', color: 'var(--text-faint)' }}>FROM THESE PAGES</div>
      )}
      {visible.map((c) => {
        const pm = meta[akPlaceOf(c.scope)] || meta.my || {};
        return (
          <div key={c.note_id}
            onClick={() => onOpenCitation && onOpenCitation(c)}
            title={`${c.preview ? String(c.preview).replace(/\s+/g, ' ').trim() : (c.heading_path || c.title || '')}${onCiteScope && akPlaceOf(c.scope) === 'my' ? '\n\n(right-click to push to your team)' : ''}`}
            onContextMenu={(e) => {
              e.preventDefault();
              if (!onCiteScope || akPlaceOf(c.scope) !== 'my') return;
              if (window.confirm(`Push “${c.title}” to your team?`)) onCiteScope(c, 'team');
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 12px', cursor: onOpenCitation ? 'pointer' : 'default' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <AkIcon name={pm.icon || 'lock'} size={13} style={{ color: pm.fg || 'var(--text-faint)', flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || c.note_id}</span>
            <span style={{ fontSize: 10.5, color: pm.fg || 'var(--text-faint)', flexShrink: 0 }}>{pm.label || ''}</span>
            <AkIcon name="arrow-up-right" size={12} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
          </div>
        );
      })}
      {hidden > 0 && (
        <button onClick={() => setExpanded(true)} style={{ display: 'block', padding: '4px 12px 8px', border: 'none', background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>+{hidden} more</button>
      )}
      {evidence && evidence.length > 0 && <Evidence rows={evidence} />}
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

// User bubble (right, mockup radius) and answer row (sparkles avatar + content).
function AkUserBubble({ children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '10px 0' }}>
      <div style={{
        maxWidth: '85%', padding: '9px 13px', background: 'var(--obsidian-720)',
        borderRadius: '12px 12px 3px 12px', color: 'var(--text-strong)', fontSize: 13.5, lineHeight: 1.5,
        border: '1px solid var(--border-subtle)',
      }}>{children}</div>
    </div>
  );
}
function AkAnswerRow({ children, streaming }) {
  return (
    <div style={{ display: 'flex', gap: 10, margin: '12px 0', animation: 'lore-fade-in 160ms ease' }}>
      <span style={{ width: 24, height: 24, flexShrink: 0, marginTop: 2, borderRadius: 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)' }}>
        <AkIcon name="sparkles" size={13} style={{ color: 'var(--brand-fg)' }} />
      </span>
      <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: 1.62, color: 'var(--text-body)' }}>
        {children}
        {streaming && <span className="ak-caret" />}
      </div>
    </div>
  );
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
    { id: 'local', label: 'On-device (fallback)' },
  ];
  const available = AK_PROVIDERS.filter((p) => p.id === 'local' || (providers && providers[p.id]));
  const [model, setModel] = React.useState(null); // provider id; null until defaulted
  const provider = model || (available.some((p) => p.id === defaultProvider) ? defaultProvider : (available[0] && available[0].id));
  const providerLabel = (AK_PROVIDERS.find((p) => p.id === provider) || {}).label || provider || 'auto';
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

  // Inline mode: the home area's MAIN chat — full width on the canvas, content
  // centered in a reading column, with visible History + Model buttons.
  const panelStyle = inline
    ? { flex: 1, minWidth: 0, background: 'var(--surface-canvas)', display: 'flex', flexDirection: 'column' }
    : akS.panel;
  const colStyle = inline ? { maxWidth: 760, width: '100%', margin: '0 auto' } : { width: '100%' };
  const modelBtn = (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setCog((c) => !c)} title="Choose the answering model & source"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 8, background: cog ? 'var(--surface-raised)' : 'transparent', color: 'var(--text-body)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 12 }}>
        <AkIcon name="cpu" size={13} style={{ color: 'var(--brand-fg)' }} />
        <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{providerLabel}</span>
        <AkIcon name="chevron-down" size={12} style={{ color: 'var(--text-faint)' }} />
      </button>
      {cog && (
        <React.Fragment>
          <div onClick={() => setCog(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, width: 232, padding: 11, background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', zIndex: 41, display: 'flex', flexDirection: 'column', gap: 10 }}>
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
          </div>
        </React.Fragment>
      )}
    </div>
  );

  return (
    <div style={panelStyle}>
      <div style={{ ...akS.header, position: 'relative', ...(inline ? { padding: '10px 20px' } : {}) }}>
        {inline && onClose && (
          <button onClick={onClose} title="Back to your pages"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-body)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 12, flexShrink: 0 }}>
            <AkIcon name="arrow-left" size={14} />Pages
          </button>
        )}
        <span style={{ width: 30, height: 30, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)', flexShrink: 0 }}>
          <AkIcon name="sparkles" size={16} style={{ color: 'var(--brand-fg)' }} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>Ask Lore</div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Answers only from your pages — with receipts</div>
        </div>
        {inline && modelBtn}
        {onNewChat && messages.length > 0 && <AkIconBtn icon="plus" label="New conversation" size="sm" onClick={onNewChat} />}
        {onResumeThread && (inline
          ? <button onClick={openHistory} title="Past conversations" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-body)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 12 }}><AkIcon name="history" size={13} />History</button>
          : <AkIconBtn icon="history" label="Past conversations" size="sm" onClick={openHistory} />)}
        {!inline && onClose && <AkIconBtn icon="x" label="Close Ask" size="sm" onClick={onClose} />}
        {historyOpen && (
          <AskHistoryDrawer threads={threads} onClose={() => setHistoryOpen(false)}
            onResume={onResumeThread} onDelete={(id) => { if (onDeleteThread) onDeleteThread(id); }} />
        )}
      </div>

      <div style={akS.scroll} ref={scrollRef}>
       <div style={colStyle}>
        {messages.length === 0 && (
          <div style={{ padding: '20px 6px' }}>
            <img src="design/assets/sprites/lore-familiar.png" alt="" aria-hidden="true"
              style={{ display: 'block', width: 120, height: 120, margin: '0 auto 10px', objectFit: 'contain', filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.28))', pointerEvents: 'none', userSelect: 'none' }} />
            <p style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--text-strong)', margin: '0 0 4px', textAlign: 'center' }}>
              {ctx ? `Ask about “${ctx.title}”` : 'Ask across your pages.'}
            </p>
            <p style={{ fontSize: 12.5, color: 'var(--text-subtle)', margin: '0 0 16px', lineHeight: 1.5, textAlign: 'center' }}>Answers are drawn only from pages you can see, and every claim is cited.</p>
            {!identityReady && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, marginBottom: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface-inset)', textAlign: 'left' }}>
                <AkIcon name="alert-circle" size={15} style={{ color: 'var(--brand-fg)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-body)', lineHeight: 1.45 }}>Finish setup before asking Lore.</span>
                <button onClick={onSetup} style={{ border: '1px solid var(--border)', background: 'var(--surface-raised)', color: 'var(--text-body)', borderRadius: 'var(--radius-sm)', padding: '5px 9px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11 }}>Configure</button>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {(suggestions || []).slice(0, 3).map((s) => (
                <button key={s} onClick={() => send(s)} disabled={!identityReady || asking} style={{
                  textAlign: 'left', display: 'flex', alignItems: 'center', gap: 9, padding: '8px 13px',
                  border: '1px solid var(--border)', background: 'var(--surface-base)', borderRadius: 999,
                  color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', fontSize: 12.5, cursor: identityReady ? 'pointer' : 'not-allowed', opacity: identityReady ? 1 : 0.5,
                }}>
                  <AkIcon name="message-circle-question" size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          m.role === 'user'
            ? <AkUserBubble key={i}>{m.text}</AkUserBubble>
            : (
              <div key={i}>
                <AkAnswerRow streaming={m.streaming}>
                  {m.streaming
                    ? <AnswerRuns runs={m.shown || m.runs || []} />
                    : <AkMarkdown text={m.text || (m.shown || m.runs || []).map((r) => r.x).join('')} refs={m.citations} />}
                </AkAnswerRow>
                {!m.streaming && m.scopes && (
                  <div style={{ margin: '-6px 0 6px 34px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)' }}>{m.scopes}</div>
                )}
                {!m.streaming && (
                  <CitationSources citations={m.citations} evidence={m.evidence} onCiteScope={onCiteScope} onOpenCitation={onOpenCitation} />
                )}
                {!m.streaming && m.conflicts && m.conflicts.length > 0 && (
                  <div style={{ margin: '0 0 10px 34px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {m.conflicts.slice(0, 3).map((cf, ci) => (
                      <div key={ci} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 10px', borderRadius: 9, border: '1px solid var(--warning-border)', background: 'var(--warning-bg)' }}>
                        <AkIcon name="alert-triangle" size={13} style={{ color: 'var(--warning-fg)', flexShrink: 0, marginTop: 1 }} />
                        <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-body)', minWidth: 0 }}>
                          Sources disagree:{' '}
                          <span onClick={() => onOpenCitation && onOpenCitation({ note_id: cf.a_id, title: cf.a_title })} style={{ color: 'var(--warning-fg)', fontWeight: 600, cursor: onOpenCitation ? 'pointer' : 'default' }}>{cf.a_title}</span>
                          {' '}contradicts{' '}
                          <span onClick={() => onOpenCitation && onOpenCitation({ note_id: cf.b_id, title: cf.b_title })} style={{ color: 'var(--warning-fg)', fontWeight: 600, cursor: onOpenCitation ? 'pointer' : 'default' }}>{cf.b_title}</span>
                          {cf.evidence ? <span style={{ color: 'var(--text-subtle)' }}> — “{cf.evidence.slice(0, 160)}”</span> : null}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
        ))}
       </div>
      </div>

      <div style={akS.composerWrap}>
        <div style={akS.scrim} />
        <div style={inline ? { ...akS.composer, maxWidth: 760, margin: '0 auto' } : akS.composer}>
          <textarea
            value={draft} onChange={(e) => setDraft(e.target.value)} rows={2}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            aria-label="Ask Lore question"
            placeholder={identityReady ? (ctx ? `Ask about “${ctx.title}”…` : 'Ask anything about your pages…') : 'Finish setup to ask Lore…'}
            style={{ width: '100%', resize: 'none', border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--font-sans)', fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-strong)' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6, position: 'relative', minWidth: 0 }}>
            {/* Context chip: "About: {page}" (clearable) or "Looking in: {scope}" (cycles). */}
            {ctx ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, padding: '3px 9px', borderRadius: 999, border: '1px solid var(--brand-soft-border)', background: 'var(--brand-soft-bg)', color: 'var(--brand-fg)', fontSize: 11 }}>
                <AkIcon name="file-text" size={11} style={{ flexShrink: 0 }} />
                <span style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>About: {ctx.title}</span>
                {onClearCtx && (
                  <span onClick={onClearCtx} title="Clear page context" style={{ display: 'inline-flex', cursor: 'pointer', opacity: 0.7 }}>
                    <AkIcon name="x" size={11} />
                  </span>
                )}
              </span>
            ) : scopeChip ? (
              <button onClick={scopeChip.onCycle || undefined} title={scopeChip.onCycle ? 'Switch where Lore looks' : undefined}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, padding: '3px 9px', borderRadius: 999, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, cursor: scopeChip.onCycle ? 'pointer' : 'default', fontFamily: 'var(--font-sans)' }}>
                <AkIcon name="telescope" size={11} style={{ flexShrink: 0 }} />
                <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Looking in: {scopeChip.label}</span>
              </button>
            ) : null}
            {!inline && (
            <button onClick={() => setCog((c) => !c)} title="Model, source & citations" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 24, padding: '0 8px', border: '1px solid var(--border)', borderRadius: 999, background: cog ? 'var(--surface-raised)' : 'transparent', color: 'var(--text-faint)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
              <AkIcon name="sliders-horizontal" size={11} />
            </button>
            )}
            <div style={{ flex: 1 }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)', flexShrink: 0 }}><AkKbd>↵</AkKbd></span>
            <button onClick={() => send()} disabled={asking || !identityReady || !draft.trim()} aria-label="Send question" style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, flexShrink: 0,
              border: 'none', borderRadius: 9, cursor: asking || !identityReady || !draft.trim() ? 'not-allowed' : 'pointer',
              background: 'var(--brand-bg)', color: 'var(--text-onbrand)', opacity: asking || !identityReady || !draft.trim() ? 0.5 : 1,
            }}><AkIcon name="arrow-up" size={16} /></button>

            {!inline && cog && (
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
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

window.LoreAskPanel = AskPanel;
