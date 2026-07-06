/* global React */
// Lore desktop — "Move…" dialog: where a page lives decides who can see it.
// Presentation only; the parent performs the move via the redaction-gated
// setNoteScope IPC and closes the dialog.
const mvNS = window.VaultDesignSystem_ffbf58;
const MvIcon = mvNS.Icon;

function mvPlaceOf(scope) {
  const s = String(scope || '').toLowerCase();
  if (s === 'team') return 'team';
  if (s === 'company' || s === 'enterprise') return 'company';
  return 'my';
}

function MoveTargetRow({ meta, hint, onClick, disabled }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '11px 13px',
        borderRadius: 10, cursor: disabled ? 'wait' : 'pointer', textAlign: 'left',
        border: `1px solid ${hover ? meta.border : 'var(--border)'}`,
        background: hover ? meta.tint : 'transparent', opacity: disabled ? 0.6 : 1,
        fontFamily: 'var(--font-sans)',
      }}>
      <span style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: meta.tint, border: `1px solid ${meta.border}` }}>
        <MvIcon name={meta.icon} size={16} style={{ color: meta.fg }} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)' }}>{meta.label}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 1 }}>{hint}</span>
      </span>
      <MvIcon name="arrow-right" size={15} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
    </button>
  );
}

function MoveDialog({ note, onMove, onClose, busy }) {
  const meta = window.LorePlaceMeta;
  const from = mvPlaceOf(note && note.scope);
  const targets = ['my', 'team', 'company'].filter((p) => p !== from);
  const hints = {
    my: 'Back to private — only you can see it.',
    team: 'Your teammates can read it.',
    company: 'Everyone at the company can read it.',
  };
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 50, background: 'var(--backdrop)', backdropFilter: 'blur(var(--backdrop-blur))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 'min(440px, calc(100% - 48px))', background: 'var(--surface-overlay)',
        border: '1px solid var(--border-strong)', borderRadius: 14, boxShadow: 'var(--shadow-modal)',
        padding: '20px 20px 18px', display: 'flex', flexDirection: 'column', gap: 8,
        animation: 'lore-fade-in 140ms ease',
      }}>
        <div style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--text-strong)' }}>Move “{note && note.title}”</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', lineHeight: 1.55, marginBottom: 8 }}>
          Where a page lives decides who can see it. It’s in <span style={{ color: (meta[from] || {}).fg, fontWeight: 600 }}>{(meta[from] || {}).label}</span> now.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {targets.map((t) => (
            <MoveTargetRow key={t} meta={meta[t]} hint={hints[t]} disabled={busy} onClick={() => onMove(t)} />
          ))}
        </div>
        <button onClick={onClose} style={{
          alignSelf: 'flex-end', marginTop: 8, height: 30, padding: '0 14px', borderRadius: 8,
          border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer',
          color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', fontSize: 12.5,
        }}>Cancel</button>
      </div>
    </div>
  );
}

window.LoreMoveDialog = MoveDialog;
