/* global React */
// Lore desktop — center editor (reading view) + right context pane
const edNS = window.VaultDesignSystem_ffbf58;
const { Icon: EdIcon, IconButton: EdIconBtn, WikiLink, ScopeTag: EdScope, Tabs: EdTabs, Avatar: EdAvatar, Badge: EdBadge, ScopePicker, Tooltip: EdTip } = edNS;

const edS = {
  center: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface-canvas)' },
  tabbar: { display: 'flex', alignItems: 'center', height: 38, background: 'var(--surface-base)', borderBottom: '1px solid var(--border-subtle)', paddingRight: 8, flexShrink: 0 },
  tab: (on) => ({
    display: 'flex', alignItems: 'center', gap: 7, height: '100%', padding: '0 14px',
    borderRight: '1px solid var(--border-subtle)', cursor: 'pointer',
    background: on ? 'var(--surface-canvas)' : 'transparent',
    color: on ? 'var(--text-strong)' : 'var(--text-subtle)', fontSize: 13,
    boxShadow: on ? 'inset 0 2px 0 var(--brand-bg)' : 'none',
  }),
  toolbar: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 18px', borderBottom: '1px solid var(--divider)', flexShrink: 0 },
  scroll: { flex: 1, overflowY: 'auto', padding: '28px 0 80px' },
  col: { maxWidth: '64ch', margin: '0 auto', padding: '0 32px' },
  context: { width: 'var(--context-width)', flexShrink: 0, background: 'var(--surface-panel)', borderLeft: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column' },
};

function Runs({ runs, onOpen }) {
  return runs.map((r, i) => {
    if (r.link) return <WikiLink key={i} onClick={() => onOpen && onOpen(r.link)}>{r.x}</WikiLink>;
    if (r.mark) return <mark key={i} style={{ background: 'var(--highlight-bg)', color: 'var(--text-strong)', borderRadius: 2, padding: '0 2px' }}>{r.x}</mark>;
    if (r.code) return <code key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.86em', background: 'var(--surface-inset)', padding: '0.1em 0.35em', borderRadius: 'var(--radius-sm)' }}>{r.x}</code>;
    return <span key={i}>{r.x}</span>;
  });
}

function Block({ b, note, onOpen }) {
  if (b.t === 'h1') return <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-4xl)', fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.01em', margin: '0 0 14px', color: 'var(--text-strong)' }}>{b.s}</h1>;
  if (b.t === 'meta') return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 26px', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)' }}>
      <EdScope scope={note.scope} size="sm" />
      <span>{note.owner}</span><span>· updated {note.updated}</span>
      <span style={{ color: 'var(--link-fg)' }}>{note.tags.map((t) => '#' + t).join('  ')}</span>
    </div>
  );
  if (b.t === 'h2') return <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-2xl)', fontWeight: 600, margin: '30px 0 12px', color: 'var(--text-strong)' }}>{b.s}</h2>;
  if (b.t === 'h3') return <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-xl)', fontWeight: 600, margin: '24px 0 10px', color: 'var(--text-strong)' }}>{b.s}</h3>;
  if (b.t === 'quote') return <blockquote style={{ margin: '20px 0', padding: '4px 18px', borderLeft: '3px solid var(--brand-soft-border)', color: 'var(--text-muted)', fontStyle: 'italic', fontFamily: 'var(--font-serif)' }}>{b.runs ? <Runs runs={b.runs} onOpen={onOpen} /> : b.s}</blockquote>;
  if (b.t === 'code') return <pre style={{ margin: '16px 0', padding: '12px 14px', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflowX: 'auto', fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-body)' }}>{b.s}</pre>;
  if (b.t === 'li') return (
    <div style={{ display: 'flex', gap: 10, margin: '6px 0', fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', lineHeight: 1.6, color: 'var(--text-body)' }}>
      <span style={{ color: 'var(--brand-fg)', marginTop: 1 }}>—</span>
      <span>{b.runs ? <Runs runs={b.runs} onOpen={onOpen} /> : b.s}</span>
    </div>
  );
  return <p style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', lineHeight: 1.65, margin: '0 0 16px', color: 'var(--text-body)' }}>{b.runs ? <Runs runs={b.runs} onOpen={onOpen} /> : b.s}</p>;
}

function Editor({ note, mode, onMode, onOpen, scope, onScope }) {
  return (
    <div style={edS.center}>
      <div style={edS.tabbar}>
        <div style={edS.tab(true)}>
          <EdIcon name="file-text" size={13} style={{ color: 'var(--brand-fg)' }} />
          {note.title}
          <EdIcon name="x" size={12} style={{ color: 'var(--text-faint)', marginLeft: 4 }} />
        </div>
        <div style={{ flex: 1 }} />
        <EdIconBtn icon="panel-right-close" label="Toggle pane" size="sm" />
      </div>

      <div style={edS.toolbar}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>{note.path || (note.title + '.md')}</span>
        <div style={{ flex: 1 }} />
        <ScopePicker value={scope} onChange={onScope} />
        <div style={{ display: 'flex', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 2, gap: 2 }}>
          {['read', 'edit'].map((m) => (
            <button key={m} onClick={() => onMode(m)} style={{
              border: 'none', cursor: 'pointer', padding: '4px 11px', borderRadius: 'var(--radius-xs)',
              background: mode === m ? 'var(--surface-raised)' : 'transparent',
              color: mode === m ? 'var(--text-strong)' : 'var(--text-subtle)',
              fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: mode === m ? 600 : 400, textTransform: 'capitalize',
            }}>{m}</button>
          ))}
        </div>
      </div>

      <div style={edS.scroll}>
        {mode === 'edit'
          ? <div style={edS.col}>
              <textarea value={note.raw || ''} onChange={(e) => note.onEdit && note.onEdit(e.target.value)}
                style={{ width: '100%', minHeight: '60vh', resize: 'vertical', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface-inset)', color: 'var(--text-body)', fontFamily: 'var(--font-mono)', fontSize: 13.5, lineHeight: 1.7, padding: 16, outline: 'none' }} />
            </div>
          : <div style={edS.col}>
              {note.body.map((b, i) => <Block key={i} b={b} note={note} onOpen={onOpen} />)}
            </div>}
      </div>
    </div>
  );
}

function ContextPane({ note, onAsk }) {
  const [tab, setTab] = React.useState('backlinks');
  return (
    <div style={edS.context}>
      <div style={{ padding: '0 12px' }}>
        <EdTabs value={tab} onChange={setTab} tabs={[
          { value: 'backlinks', label: 'Backlinks', count: note.backlinks.length },
          { value: 'outline', label: 'Outline' },
          { value: 'tags', label: 'Tags', count: note.tags.length },
        ]} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {tab === 'backlinks' && (note.backlinks.length === 0
          ? <div style={{ fontSize: 12.5, color: 'var(--text-faint)', padding: '8px 8px', lineHeight: 1.5 }}>No backlinks yet.</div>
          : note.backlinks.map((bl, i) => (
          <div key={i} style={{ display: 'flex', gap: 9, padding: '9px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <EdIcon name="link-2" size={14} style={{ color: 'var(--link-fg)', marginTop: 2 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>{bl.note}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)', marginTop: 2 }}>› {bl.heading} · {bl.owner}</div>
            </div>
          </div>
        )))}
        {tab === 'outline' && note.outline.map((h, i) => (
          <div key={i} style={{ padding: '6px 8px', paddingLeft: 8 + (i === 0 ? 0 : 14), fontSize: 13, color: i === 0 ? 'var(--text-strong)' : 'var(--text-muted)', fontWeight: i === 0 ? 600 : 400, cursor: 'pointer' }}>{h}</div>
        ))}
        {tab === 'tags' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {note.tags.map((t) => <EdBadge key={t} tone="info">#{t}</EdBadge>)}
          </div>
        )}
      </div>
      <div style={{ padding: 12, borderTop: '1px solid var(--divider)' }}>
        <button onClick={onAsk} style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          height: 34, border: '1px solid var(--brand-soft-border)', background: 'var(--brand-soft-bg)',
          color: 'var(--brand-fg)', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
          fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600,
        }}>
          <EdIcon name="sparkles" size={15} />Ask about this note
        </button>
      </div>
    </div>
  );
}

Object.assign(window, { LoreEditor: Editor, LoreContextPane: ContextPane });
