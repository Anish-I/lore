/* global React */
// Lore desktop — Import modal with drag-drop bucket (IM_ prefix for all top-level names)
const IM_NS = window.VaultDesignSystem_ffbf58;
const { Button: IM_Button, Icon: IM_Icon } = IM_NS;

function IM_ImportModal({ onClose, onDone }) {
  const [dragging, setDragging] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const IM_handleFiles = async (files) => {
    const paths = Array.from(files).map((f) => f.path).filter(Boolean);
    if (!paths.length) {setStatus('No files with a resolvable path found.');return;}
    setBusy(true);
    setStatus(`Importing ${paths.length} item${paths.length !== 1 ? 's' : ''}…`);
    try {
      if (window.lore && window.lore.importFiles) await window.lore.importFiles(paths);
      setStatus(`Imported ${paths.length} item${paths.length !== 1 ? 's' : ''}.`);
      if (onDone) setTimeout(onDone, 900);
    } catch (e) {
      setStatus('Import failed: ' + String(e && e.message || e));
    }
    setBusy(false);
  };

  const IM_onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    IM_handleFiles(e.dataTransfer.files);
  };
  const IM_onDragEnter = (e) => {e.preventDefault();setDragging(true);};
  const IM_onDragLeave = (e) => {e.preventDefault();setDragging(false);};
  const IM_onDragOver = (e) => {e.preventDefault();};

  const IM_browse = async () => {
    if (!window.lore || !window.lore.importPick) {setStatus('File picker not available.');return;}
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

  return (/*#__PURE__*/
    React.createElement("div", { style: { position: 'absolute', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--backdrop)', backdropFilter: 'blur(var(--backdrop-blur))' } }, /*#__PURE__*/
    React.createElement("div", { style: { width: 520, display: 'flex', flexDirection: 'column', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)', overflow: 'hidden' } }, /*#__PURE__*/


    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--divider)' } }, /*#__PURE__*/
    React.createElement(IM_Icon, { name: "upload", size: 16, style: { color: 'var(--brand-fg)' } }), /*#__PURE__*/
    React.createElement("span", { style: { flex: 1, fontFamily: 'var(--font-serif)', fontSize: 15, fontWeight: 600, color: 'var(--text-strong)' } }, "Import files"), /*#__PURE__*/
    React.createElement("button", { onClick: onClose, style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', display: 'inline-flex', padding: 4, borderRadius: 'var(--radius-sm)' } }, /*#__PURE__*/
    React.createElement(IM_Icon, { name: "x", size: 16 })
    )
    ), /*#__PURE__*/


    React.createElement("div", { style: { padding: '24px 24px 16px' } }, /*#__PURE__*/
    React.createElement("div", {
      onDrop: IM_onDrop,
      onDragEnter: IM_onDragEnter,
      onDragLeave: IM_onDragLeave,
      onDragOver: IM_onDragOver,
      style: {
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 14, minHeight: 180, padding: 28,
        border: `2px dashed ${dragging ? 'var(--brand-fg)' : 'var(--border-strong)'}`,
        borderRadius: 'var(--radius-md)',
        background: dragging ? 'var(--brand-soft-bg)' : 'var(--surface-inset)',
        transition: 'border-color 150ms var(--ease-out), background 150ms var(--ease-out)',
        cursor: 'default'
      } }, /*#__PURE__*/

    React.createElement(IM_Icon, {
      name: dragging ? 'folder-input' : 'upload-cloud',
      size: 36,
      style: { color: dragging ? 'var(--brand-fg)' : 'var(--text-faint)', transition: 'color 150ms' } }
    ), /*#__PURE__*/
    React.createElement("div", { style: { textAlign: 'center' } }, /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 14, fontWeight: 600, color: 'var(--text-strong)', marginBottom: 4 } },
    dragging ? 'Drop to import' : 'Drop files or folders here'
    ), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 12.5, color: 'var(--text-subtle)' } }, "Markdown, text, code, JSON, YAML and more"

    )
    ), /*#__PURE__*/
    React.createElement(IM_Button, { variant: "secondary", icon: "folder-open", onClick: IM_browse, disabled: busy }, "Browse files / folders\u2026"

    )
    )
    ), /*#__PURE__*/


    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderTop: '1px solid var(--divider)', minHeight: 48 } },
    busy && /*#__PURE__*/
    React.createElement(IM_Icon, { name: "loader", size: 14, style: { color: 'var(--brand-fg)', animation: 'lore-pulse 1s linear infinite' } }), /*#__PURE__*/

    React.createElement("span", { style: { flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: status ? 'var(--text-muted)' : 'var(--text-faint)' } },
    status || 'Files are copied into your library and indexed.'
    ), /*#__PURE__*/
    React.createElement(IM_Button, { variant: "ghost", onClick: onClose, disabled: busy }, "Close")
    )

    )
    ));

}

window.LoreImportModal = IM_ImportModal;