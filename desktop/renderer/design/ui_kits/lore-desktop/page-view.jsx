/* global React */
// Lore desktop — Hybrid open-page view: header chrome (back / Lives in / Chat /
// Move) around the LoreEditor reading column, plus the Related-pages pill row.
const pvNS = window.VaultDesignSystem_ffbf58;
const PvIcon = pvNS.Icon;

function pvScopePlace(scope) {
  const s = String(scope || '').toLowerCase();
  if (s === 'team') return 'team';
  if (s === 'company' || s === 'enterprise') return 'company';
  return 'my';
}

function PvPill({ children, onClick, title, dotColor }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button onClick={onClick} title={title}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 13px', borderRadius: 999,
        border: `1px solid ${hover ? 'var(--border-strong)' : 'var(--border)'}`,
        background: 'var(--surface-panel)', cursor: 'pointer',
        color: 'var(--text-body)', fontFamily: 'var(--font-sans)', fontSize: 12.5,
      }}>
      {dotColor && <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />}
      <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
    </button>
  );
}

// Related-pages strip — rendered inside the editor's reading column (footer prop).
function RelatedPages({ connections, onOpen }) {
  const conns = (connections || []).filter((c) => c.path);
  if (!conns.length) return null;
  const meta = window.LorePlaceMeta;
  const tipOf = (c) => {
    const base = c.kind === 'tag' ? 'Covers the same topic' : c.kind === 'folder' ? 'Sits in the same folder'
      : c.kind === 'link' ? 'Linked pages' : `Relation: ${String(c.kind || '').replace(/_/g, ' ')}`;
    const provenance = c.origin === 'llm' ? 'inferred by enrichment' : c.origin === 'capture' ? 'noticed in an agent session' : 'from your links/folders';
    return `${base} — ${provenance}`;
  };
  return (
    <div style={{ marginTop: 34, paddingTop: 18, borderTop: '1px solid var(--divider)' }} onClick={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <PvIcon name="link-2" size={14} style={{ color: 'var(--text-subtle)' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>Related pages</span>
        <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>linked or on the same topic</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, paddingTop: 8 }}>
        {conns.slice(0, 14).map((c, i) => (
          <PvPill key={c.id || i} title={tipOf(c)} onClick={() => onOpen(c.path)}
            dotColor={(meta[pvScopePlace(c.scope)] || meta.my).fg}>
            {c.label}
          </PvPill>
        ))}
      </div>
    </div>
  );
}

// Per-note git history popover — commits from the vault-git autocommit repo,
// with a line diff view and one-click restore.
function HistoryPanel({ relPath, onRestored, onClose }) {
  const [commits, setCommits] = React.useState(null);
  const [sel, setSel] = React.useState(null);      // oid being viewed
  const [diff, setDiff] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    let live = true;
    window.lore.vaultGit.history(relPath).then((r) => {
      if (!live) return;
      if (r && r.ok) setCommits(r.commits || []);
      else { setCommits([]); setError((r && r.error) || 'history unavailable'); }
    }).catch((e) => { if (live) { setCommits([]); setError(String(e)); } });
    return () => { live = false; };
  }, [relPath]);
  const view = async (oid) => {
    setSel(oid); setDiff(null);
    try { const r = await window.lore.vaultGit.diff(relPath, oid); setDiff(r && r.ok ? r.diff : [{ t: 'info', s: (r && r.error) || 'diff failed' }]); }
    catch (e) { setDiff([{ t: 'info', s: String(e) }]); }
  };
  const doRestore = async (oid) => {
    if (!window.confirm('Restore this page to the selected version? The current content is kept in history.')) return;
    setBusy(true);
    try {
      const r = await window.lore.vaultGit.restore(relPath, oid);
      if (r && r.ok) { onRestored(); onClose(); }
      else setError((r && r.error) || 'restore failed');
    } catch (e) { setError(String(e)); }
    setBusy(false);
  };
  const ago = (ms) => {
    if (!ms) return '';
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  };
  const diffColor = { add: 'var(--success-fg)', del: 'var(--danger-fg)', ctx: 'var(--text-subtle)', info: 'var(--text-faint)' };
  const diffPrefix = { add: '+ ', del: '- ', ctx: '  ', info: '' };
  return (
    <React.Fragment>
      <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={onClose} />
      <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 41, width: sel ? 560 : 340, maxHeight: 420, display: 'flex', flexDirection: 'column', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 12, boxShadow: 'var(--shadow-modal)', overflow: 'hidden' }}>
        <div style={{ padding: '9px 12px', borderBottom: '1px solid var(--divider)', fontSize: 12.5, fontWeight: 600, color: 'var(--text-strong)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <PvIcon name="history" size={14} style={{ color: 'var(--brand-fg)' }} />
          Page history
          {sel && <button onClick={() => { setSel(null); setDiff(null); }} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--brand-fg)', cursor: 'pointer', fontSize: 11.5, fontFamily: 'var(--font-sans)' }}>back to list</button>}
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {error && <div style={{ padding: 12, fontSize: 12, color: 'var(--danger-fg)' }}>{error}</div>}
          {!sel && commits === null && <div style={{ padding: 12, fontSize: 12, color: 'var(--text-faint)' }}>loading…</div>}
          {!sel && commits && commits.length === 0 && !error && (
            <div style={{ padding: 14, fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.5 }}>No snapshots yet — edits are snapshotted automatically about a minute after you save.</div>
          )}
          {!sel && (commits || []).map((c) => (
            <div key={c.oid} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', borderBottom: '1px solid var(--divider)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)', flexShrink: 0 }}>{c.short}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.message}</span>
              <span style={{ fontSize: 10.5, color: 'var(--text-faint)', flexShrink: 0 }}>{ago(c.when)}</span>
              <button onClick={() => view(c.oid)} style={{ background: 'none', border: 'none', color: 'var(--brand-fg)', cursor: 'pointer', fontSize: 11.5, fontFamily: 'var(--font-sans)', flexShrink: 0 }}>View</button>
              <button onClick={() => doRestore(c.oid)} disabled={busy} style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 11.5, fontFamily: 'var(--font-sans)', flexShrink: 0 }}>Restore</button>
            </div>
          ))}
          {sel && (
            <div style={{ padding: '10px 12px' }}>
              <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {(diff || [{ t: 'info', s: 'loading…' }]).map((row, i) => (
                  <div key={i} style={{ color: diffColor[row.t] || 'var(--text-body)' }}>{diffPrefix[row.t]}{row.s}</div>
                ))}
              </pre>
              <button onClick={() => doRestore(sel)} disabled={busy} style={{ marginTop: 10, height: 28, padding: '0 12px', borderRadius: 8, border: '1px solid var(--brand-soft-border)', background: 'var(--brand-soft-bg)', color: 'var(--brand-fg)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 600 }}>
                {busy ? 'Restoring…' : 'Restore this version'}
              </button>
            </div>
          )}
        </div>
      </div>
    </React.Fragment>
  );
}

function PageView({ note, editor, place, mode, connections, onBack, backLabel, onChatAbout, onMove, onDelete, relPath, onRestored }) {
  const meta = window.LorePlaceMeta[pvScopePlace(note && note.scope)] || window.LorePlaceMeta.my;
  const placeMeta = window.LorePlaceMeta[place] || meta;
  const [hoverBack, setHoverBack] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [hoverDelete, setHoverDelete] = React.useState(false);
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface-canvas)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 26px', borderBottom: '1px solid var(--divider)', flexShrink: 0 }}>
        <button onClick={onBack}
          onMouseEnter={() => setHoverBack(true)} onMouseLeave={() => setHoverBack(false)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
            cursor: 'pointer', padding: 0, fontFamily: 'var(--font-sans)', fontSize: 12.5,
            color: hoverBack ? 'var(--text-strong)' : 'var(--text-subtle)',
          }}>
          <PvIcon name="arrow-left" size={14} />
          {backLabel || `All ${placeMeta.label} pages`}
        </button>
        {mode === 'edit' && (
          <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>Editing — click away to save</span>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, color: meta.fg }}>
          <PvIcon name={meta.icon} size={13} />
          Lives in {meta.label}
        </span>
        <button onClick={onChatAbout} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 13px', borderRadius: 8,
          border: '1px solid var(--brand-soft-border)', background: 'var(--brand-soft-bg)', cursor: 'pointer',
          color: 'var(--brand-fg)', fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 600,
        }}>
          <PvIcon name="sparkles" size={13} />Chat about this
        </button>
        <button onClick={onMove} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 13px', borderRadius: 8,
          border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer',
          color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 500,
        }}>
          <PvIcon name="corner-up-right" size={13} />Move…
        </button>
        {relPath && window.lore && window.lore.vaultGit && (
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <button onClick={() => setHistoryOpen((o) => !o)} title="Page history (automatic snapshots)" style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 8,
              border: '1px solid var(--border)', background: historyOpen ? 'var(--surface-hover)' : 'transparent',
              cursor: 'pointer', color: 'var(--text-primary)',
            }}>
              <PvIcon name="history" size={14} />
            </button>
            {historyOpen && (
              <HistoryPanel relPath={relPath} onRestored={onRestored || (() => {})} onClose={() => setHistoryOpen(false)} />
            )}
          </span>
        )}
        {onDelete && (
          <button onClick={onDelete} title="Delete this page (moves to Trash)"
            onMouseEnter={() => setHoverDelete(true)} onMouseLeave={() => setHoverDelete(false)}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 8,
              border: `1px solid ${hoverDelete ? 'var(--danger-border, var(--border-strong))' : 'var(--border)'}`,
              background: 'transparent', cursor: 'pointer',
              color: hoverDelete ? 'var(--danger-fg)' : 'var(--text-subtle)',
            }}>
            <PvIcon name="trash-2" size={14} />
          </button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {editor}
      </div>
    </div>
  );
}

Object.assign(window, { LorePageView: PageView, LoreRelatedPages: RelatedPages });
