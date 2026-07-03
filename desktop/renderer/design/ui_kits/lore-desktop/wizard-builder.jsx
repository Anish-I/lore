/* global React */
// Lore desktop — chat-driven wizard creation (the PRIMARY creation flow) + the
// no-install catalog preview chat. Both are docked overlays used by buckets.jsx.
const wbNS = window.VaultDesignSystem_ffbf58;
const { Icon: WbIcon, Badge: WbBadge, Button: WbButton, Checkbox: WbCheckbox, AskMessage: WbAskMessage } = wbNS;

const wbS = {
  overlay: { position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end' },
  scrim: { position: 'absolute', inset: 0, background: 'var(--scrim-bg, rgba(0,0,0,0.35))' },
  panel: { position: 'relative', height: '100%', background: 'var(--surface-panel)', borderLeft: '1px solid var(--border-strong)', boxShadow: 'var(--shadow-xl)', display: 'flex', flexDirection: 'column' },
  head: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--divider)', flexShrink: 0 },
  headIcon: { width: 24, height: 24, borderRadius: 'var(--radius-sm)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)' },
  title: { flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  close: { border: 'none', background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer', display: 'inline-flex', padding: 4 },
  scroll: { flex: 1, overflowY: 'auto', padding: '8px 14px 10px' },
  foot: { padding: '10px 12px 12px', borderTop: '1px solid var(--divider)', flexShrink: 0 },
  inputBox: { border: '1px solid var(--border-field)', borderRadius: 'var(--radius-md)', background: 'var(--surface-inset)', padding: 10 },
  textarea: { width: '100%', resize: 'none', border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--font-sans)', fontSize: 14, lineHeight: 1.5, color: 'var(--text-strong)' },
  sendBtn: (off) => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, border: 'none', borderRadius: 'var(--radius-sm)', cursor: off ? 'not-allowed' : 'pointer', background: 'var(--brand-bg)', color: 'var(--text-onbrand)', opacity: off ? 0.5 : 1 }),
};

// --- Catalog preview chat: talk to an UNINSTALLED knowledge base WITHOUT installing ---
// Deterministic, metadata-only: the reply is composed from the catalog listing (name,
// description, topics, note titles) — no LLM, no retrieval over notes that aren't
// indexed, and it says so. Install is the honest path to the full contents.
function wbPreviewAnswer(w, q) {
  const toks = String(q).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const rank = (title) => toks.reduce((n, t) => n + (String(title).toLowerCase().includes(t) ? 1 : 0), 0);
  const hits = (w.noteTitles || []).map((t) => [rank(t), t]).filter((p) => p[0] > 0)
    .sort((a, b) => b[0] - a[0]).slice(0, 4).map((p) => p[1]);
  const lines = [`${w.name} — ${w.desc || 'no description in the catalog listing.'}`];
  if ((w.topics || []).length) lines.push(`Covers: ${w.topics.map((t) => '#' + t).join('  ')}`);
  lines.push(hits.length
    ? 'Notes in this pack that look related to your question:\n' + hits.map((t) => '• ' + t).join('\n')
    : 'Nothing in the note titles obviously matches that — it may still be covered inside the notes.');
  lines.push(`This preview only knows the catalog listing (${w.noteCount || (w.noteTitles || []).length} note titles + description) — install to chat over the full contents.`);
  return lines.join('\n\n');
}

function CatalogPreviewChat({ w, onClose, onInstall }) {
  const [messages, setMessages] = React.useState([]);
  const [draft, setDraft] = React.useState('');
  const scrollRef = React.useRef(null);
  React.useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);

  const send = () => {
    const q = draft.trim();
    if (!q) return;
    setDraft('');
    setMessages((m) => [...m, { role: 'user', text: q }, { role: 'assistant', text: wbPreviewAnswer(w, q) }]);
  };

  return (
    <div style={wbS.overlay}>
      <div onClick={onClose} style={wbS.scrim} />
      <div style={{ ...wbS.panel, width: 'var(--ask-width, 380px)' }}>
        <div style={wbS.head}>
          <span style={wbS.headIcon}><WbIcon name="message-circle" size={14} style={{ color: 'var(--brand-fg)' }} /></span>
          <span style={wbS.title}>Preview · {w.name}</span>
          {onInstall && <WbButton variant="secondary" size="sm" icon="download" onClick={onInstall}>Install</WbButton>}
          <button onClick={onClose} aria-label="Close preview chat" style={wbS.close}><WbIcon name="x" size={16} /></button>
        </div>
        <div ref={scrollRef} style={wbS.scroll}>
          {messages.length === 0 && (
            <div style={{ padding: '24px 6px', textAlign: 'center' }}>
              <p style={{ fontFamily: 'var(--font-serif)', fontSize: 16, color: 'var(--text-body)', margin: '0 0 4px' }}>Preview {w.name}.</p>
              <p style={{ fontSize: 12.5, color: 'var(--text-subtle)', margin: 0, lineHeight: 1.5 }}>
                Not installed yet — answers come from the catalog listing only. Install to chat over the full contents.
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            m.role === 'user'
              ? <WbAskMessage key={i} role="user">{m.text}</WbAskMessage>
              : <WbAskMessage key={i} role="answer"><span style={{ whiteSpace: 'pre-wrap' }}>{m.text}</span></WbAskMessage>
          ))}
        </div>
        <div style={wbS.foot}>
          <div style={wbS.inputBox}>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              aria-label={`Preview ${w.name}`} placeholder={`Ask what ${w.name} covers…`} style={wbS.textarea} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              <button onClick={send} disabled={!draft.trim()} aria-label="Send question" style={wbS.sendBtn(!draft.trim())}>
                <WbIcon name="arrow-up" size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Wizard builder: describe → /search finds notes → refine/deselect → create ---
// Search-first, chat-shaped. Every message runs the EXISTING /search (k=40) over the
// configured scopes and MERGES results into one candidate list (checked by default,
// prior tick state preserved). Create = applied section from the ticked note ids +
// promote — backend state only, no files move.

// "everything about my trading bots" → "Trading Bots" (title-cased, filler dropped).
function wbSuggestName(q) {
  const words = String(q).replace(/^(everything|all|any|notes?|stuff)\s+(about|on|for|related to)\s+/i, '')
    .replace(/^(my|the|our)\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 4);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').slice(0, 60);
}

const WB_SCOPES = [
  { id: 'private', label: 'Private', hint: 'Only you. The default.' },
  { id: 'team', label: 'Team', hint: 'Forward-looking — stored now, shares when team sync lands.' },
  { id: 'public', label: 'Public', hint: 'Forward-looking — stored now, publishes when the public store lands.' },
];

function WizardBuilder({ scopes, onClose, onCreated }) {
  const [messages, setMessages] = React.useState([]);
  const [cands, setCands] = React.useState([]);          // [{id, title, score, checked}]
  const [draft, setDraft] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [name, setName] = React.useState('');
  const [nameTouched, setNameTouched] = React.useState(false);
  const [shareScope, setShareScope] = React.useState('private');
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState('');
  const scrollRef = React.useRef(null);
  React.useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, searching]);

  const push = (role, text) => setMessages((m) => [...m, { role, text }]);

  const send = async () => {
    const q = draft.trim();
    if (!q || searching) return;
    setDraft('');
    push('user', q);
    if (!scopes || !scopes.length || !window.lore || !window.lore.search) {
      push('assistant', 'Finish setup first (account, library, purpose) so I can search your notes.');
      return;
    }
    setSearching(true);
    let r;
    try { r = await window.lore.search(q, scopes, 40); } catch (e) { r = { error: String((e && e.message) || e) }; }
    if (!r || r.error) {
      push('assistant', 'Search failed: ' + ((r && r.error) || 'no response') + '. Is the backend running?');
    } else {
      // Merge by note_id (search returns chunks): union with prior results, keep tick state.
      const seen = new Map(cands.map((c) => [c.id, c]));
      const inQuery = new Set();
      let added = 0;
      for (const hit of (r.results || [])) {
        if (!hit.note_id || inQuery.has(hit.note_id)) continue;
        inQuery.add(hit.note_id);
        if (seen.has(hit.note_id)) continue;
        seen.set(hit.note_id, { id: hit.note_id, title: hit.title || hit.note_id, score: hit.score, checked: true });
        added++;
      }
      setCands([...seen.values()]);
      if (!nameTouched && !name) setName(wbSuggestName(q));
      push('assistant', inQuery.size
        ? `Matched ${inQuery.size} note${inQuery.size === 1 ? '' : 's'} (${added} new, ${seen.size} total). Untick any strays below, refine with another message, or create the wizard.`
        : 'No notes matched that. Try different words — the search runs over your indexed notes.');
    }
    setSearching(false);
  };

  const toggle = (id) => setCands((cs) => cs.map((c) => c.id === id ? { ...c, checked: !c.checked } : c));
  const pickedIds = cands.filter((c) => c.checked).map((c) => c.id);

  const create = async () => {
    if (!name.trim() || !pickedIds.length || creating) return;
    setCreating(true); setError('');
    let r;
    try { r = await window.lore.wizards.createFromNotes({ name: name.trim(), noteIds: pickedIds, shareScope }); }
    catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (r && r.ok) onCreated(r.wizard);
    else setError((r && r.error) || 'Could not create the wizard.');
    setCreating(false);
  };

  const scopeHint = (WB_SCOPES.find((s) => s.id === shareScope) || WB_SCOPES[0]).hint;
  const chip = (active) => ({ padding: '4px 11px', borderRadius: 'var(--radius-full)', cursor: 'pointer', border: `1px solid ${active ? 'var(--brand-soft-border)' : 'var(--border)'}`, background: active ? 'var(--brand-soft-bg)' : 'var(--surface-inset)', color: active ? 'var(--brand-fg)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 });

  return (
    <div style={wbS.overlay}>
      <div onClick={onClose} style={wbS.scrim} />
      <div style={{ ...wbS.panel, width: 460 }}>
        <div style={wbS.head}>
          <span style={wbS.headIcon}><WbIcon name="wand-2" size={14} style={{ color: 'var(--brand-fg)' }} /></span>
          <span style={wbS.title}>Create a wizard</span>
          <button onClick={onClose} aria-label="Close wizard builder" style={wbS.close}><WbIcon name="x" size={16} /></button>
        </div>

        <div ref={scrollRef} style={wbS.scroll}>
          {messages.length === 0 && (
            <div style={{ padding: '24px 6px', textAlign: 'center' }}>
              <p style={{ fontFamily: 'var(--font-serif)', fontSize: 16, color: 'var(--text-body)', margin: '0 0 4px' }}>Describe the knowledge base you want.</p>
              <p style={{ fontSize: 12.5, color: 'var(--text-subtle)', margin: 0, lineHeight: 1.5 }}>
                e.g. “everything about my trading bots” — Lore searches your notes, you confirm the list, and the wizard is ready to chat. Notes stay where they are.
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            m.role === 'user'
              ? <WbAskMessage key={i} role="user">{m.text}</WbAskMessage>
              : <WbAskMessage key={i} role="answer"><span style={{ whiteSpace: 'pre-wrap' }}>{m.text}</span></WbAskMessage>
          ))}
          {searching && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)', padding: '4px 0 4px 36px' }}>searching…</div>}

          {cands.length > 0 && (
            <div style={{ margin: '10px 0 4px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface-inset)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--divider)' }}>
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: 'var(--text-strong)' }}>Matched notes</span>
                <WbBadge tone="info">{pickedIds.length} of {cands.length} selected</WbBadge>
              </div>
              <div style={{ maxHeight: 220, overflowY: 'auto', padding: '6px 12px 8px' }}>
                {cands.map((c) => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                    <WbCheckbox checked={c.checked} onChange={() => toggle(c.id)} label={c.title || c.id} style={{ fontSize: 12.5, minWidth: 0 }} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={wbS.foot}>
          {cands.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <input value={name} onChange={(e) => { setName(e.target.value); setNameTouched(true); }} placeholder="Wizard name…" aria-label="Wizard name"
                style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', border: '1px solid var(--border-field)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-inset)', color: 'var(--text-strong)', fontFamily: 'var(--font-sans)', fontSize: 13, outline: 'none' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {WB_SCOPES.map((s) => (
                  <button key={s.id} onClick={() => setShareScope(s.id)} style={chip(shareScope === s.id)}>{s.label}</button>
                ))}
                <div style={{ flex: 1 }} />
                <WbButton variant="primary" size="sm" icon={creating ? 'loader' : 'wand-2'} onClick={create} disabled={creating || !name.trim() || !pickedIds.length}>
                  {creating ? 'Creating…' : `Create wizard (${pickedIds.length})`}
                </WbButton>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 5 }}>{scopeHint}</div>
              {error && <div style={{ fontSize: 11.5, color: 'var(--clay-400)', marginTop: 5 }}>{error}</div>}
            </div>
          )}
          <div style={wbS.inputBox}>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              aria-label="Describe your wizard"
              placeholder={cands.length ? 'Refine — another search merges into the list…' : 'Describe what this wizard should know…'}
              style={wbS.textarea} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              <button onClick={send} disabled={searching || !draft.trim()} aria-label="Search notes" style={wbS.sendBtn(searching || !draft.trim())}>
                <WbIcon name="arrow-up" size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.LoreWizardBuilder = WizardBuilder;
window.LoreCatalogPreviewChat = CatalogPreviewChat;
