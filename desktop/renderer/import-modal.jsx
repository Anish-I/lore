/* global React */
// Lore desktop — Import modal with drag-drop bucket (IM_ prefix for all top-level names)
const IM_NS = window.VaultDesignSystem_ffbf58;
const { Button: IM_Button, Icon: IM_Icon } = IM_NS;

function IM_ImportModal({ onClose, onDone }) {
  const [dragging, setDragging] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [urlDraft, setUrlDraft] = React.useState('');

  const IM_importUrl = async () => {
    const url = urlDraft.trim();
    if (!url || !window.lore || !window.lore.importUrl) return;
    setBusy(true);
    setStatus('Fetching page…');
    try {
      const r = await window.lore.importUrl(url);
      if (r && r.ok) {
        setUrlDraft('');
        setStatus(`Added “${(r.title || url).slice(0, 60)}” (${r.chunks} chunk${r.chunks === 1 ? '' : 's'}).`);
        if (onDone) setTimeout(onDone, 900);
      } else {
        setStatus('Page import failed: ' + ((r && r.error) || 'unknown error'));
      }
    } catch (e) {
      setStatus('Page import failed: ' + String((e && e.message) || e));
    }
    setBusy(false);
  };

  const IM_handleFiles = async (files) => {
    const paths = Array.from(files).map((f) => f.path).filter(Boolean);
    if (!paths.length) { setStatus('No files with a resolvable path found.'); return; }
    setBusy(true);
    setStatus(`Importing ${paths.length} item${paths.length !== 1 ? 's' : ''}…`);
    try {
      if (window.lore && window.lore.importFiles) await window.lore.importFiles(paths);
      setStatus(`Imported ${paths.length} item${paths.length !== 1 ? 's' : ''}.`);
      if (onDone) setTimeout(onDone, 900);
    } catch (e) {
      setStatus('Import failed: ' + String((e && e.message) || e));
    }
    setBusy(false);
  };

  const IM_onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    IM_handleFiles(e.dataTransfer.files);
  };
  const IM_onDragEnter = (e) => { e.preventDefault(); setDragging(true); };
  const IM_onDragLeave = (e) => { e.preventDefault(); setDragging(false); };
  const IM_onDragOver = (e) => { e.preventDefault(); };

  const IM_browse = async () => {
    if (!window.lore || !window.lore.importPick) { setStatus('File picker not available.'); return; }
    setBusy(true);
    setStatus('Picking…');
    try {
      await window.lore.importPick();
      setStatus('Import complete.');
      if (onDone) setTimeout(onDone, 900);
    } catch {
      setStatus('Cancelled.');
    }
    setBusy(false);
  };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--backdrop)', backdropFilter: 'blur(var(--backdrop-blur))' }}>
      <div style={{ width: 480, display: 'flex', flexDirection: 'column', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 14, boxShadow: 'var(--shadow-modal)', overflow: 'hidden', animation: 'lore-fade-in 140ms ease' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--divider)' }}>
          <IM_Icon name="upload" size={16} style={{ color: 'var(--brand-fg)' }} />
          <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: 'var(--text-strong)' }}>Add your files</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', display: 'inline-flex', padding: 4, borderRadius: 'var(--radius-sm)' }}>
            <IM_Icon name="x" size={16} />
          </button>
        </div>

        {/* Drop bucket */}
        <div style={{ padding: '24px 24px 16px' }}>
          <div
            onDrop={IM_onDrop}
            onDragEnter={IM_onDragEnter}
            onDragLeave={IM_onDragLeave}
            onDragOver={IM_onDragOver}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 14, minHeight: 180, padding: 28,
              border: `2px dashed ${dragging ? 'var(--brand-fg)' : 'var(--border-strong)'}`,
              borderRadius: 'var(--radius-md)',
              background: dragging ? 'var(--brand-soft-bg)' : 'var(--surface-inset)',
              transition: 'border-color 150ms var(--ease-out), background 150ms var(--ease-out)',
              cursor: 'default',
            }}
          >
            <IM_Icon
              name={dragging ? 'folder-input' : 'upload-cloud'}
              size={36}
              style={{ color: dragging ? 'var(--brand-fg)' : 'var(--text-faint)', transition: 'color 150ms' }}
            />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)', marginBottom: 4 }}>
                {dragging ? 'Drop to import' : 'Drop files or folders here'}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>
                Word docs, PDFs, text, Markdown, code and more all work
              </div>
            </div>
            <IM_Button variant="secondary" icon="folder-open" onClick={IM_browse} disabled={busy}>
              Browse files / folders…
            </IM_Button>
          </div>
        </div>

        {/* URL → note (backend fetch + readable-text extraction) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 24px 16px' }}>
          <IM_Icon name="link-2" size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
          <input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') IM_importUrl(); }}
            placeholder="…or paste a web page URL"
            disabled={busy}
            style={{ flex: 1, minWidth: 0, height: 32, padding: '0 11px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-inset)', color: 'var(--text-strong)', fontFamily: 'var(--font-sans)', fontSize: 12.5, outline: 'none' }}
          />
          <IM_Button variant="secondary" onClick={IM_importUrl} disabled={busy || !urlDraft.trim()}>Add page</IM_Button>
        </div>

        {/* Footer: progress + close */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderTop: '1px solid var(--divider)', minHeight: 48 }}>
          {busy && (
            <IM_Icon name="loader" size={14} style={{ color: 'var(--brand-fg)', animation: 'lore-pulse 1s linear infinite' }} />
          )}
          <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: status ? 'var(--text-muted)' : 'var(--text-faint)' }}>
            {status || 'New pages land in My Notes — private until you move them.'}
          </span>
          <IM_Button variant="ghost" onClick={onClose} disabled={busy}>Close</IM_Button>
        </div>

      </div>
    </div>
  );
}

window.LoreImportModal = IM_ImportModal;
