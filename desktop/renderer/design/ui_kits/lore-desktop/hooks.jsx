/* global React */
// Lore desktop — Hooks view: wire AI tool sessions into the knowledge graph (HK_ prefix)
const HK_NS = window.VaultDesignSystem_ffbf58;
const { Icon: HK_Icon, Switch: HK_Switch, Select: HK_Select, Button: HK_Button, Badge: HK_Badge } = HK_NS;

const HK_S = {
  wrap: { flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--surface-canvas)' },
  body: { maxWidth: 760, margin: '0 auto', padding: '28px 28px 80px' },
  section: { border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface-panel)', marginBottom: 18, overflow: 'hidden' },
  secHead: { display: 'flex', alignItems: 'center', gap: 9, padding: '12px 16px', borderBottom: '1px solid var(--divider)' },
  row: { display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', borderBottom: '1px solid var(--divider)' },
  label: { fontSize: 13.5, color: 'var(--text-strong)', fontWeight: 500 },
  hint: { fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 },
};

function HK_Section({ icon, title, children }) {
  return (
    <div style={HK_S.section}>
      <div style={HK_S.secHead}>
        <HK_Icon name={icon} size={15} style={{ color: 'var(--brand-fg)' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function HK_Row({ label, hint, children, last }) {
  return (
    <div style={{ ...HK_S.row, borderBottom: last ? 'none' : HK_S.row.borderBottom }}>
      <div style={{ flex: 1 }}>
        <div style={HK_S.label}>{label}</div>
        {hint && <div style={HK_S.hint}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

// Static metadata for known tools; merged with live detect() data
const HK_KNOWN = {
  claude:  { label: 'Claude Code',       icon: 'terminal-square', experimental: false },
  codex:   { label: 'Codex CLI',         icon: 'code-2',          experimental: true  },
  copilot: { label: 'Copilot / Cursor',  icon: 'bot',             experimental: true  },
};

// Ordered list — always show these three rows even if detect() omits them
const HK_TOOL_ORDER = ['claude', 'codex', 'copilot'];

const HK_STATUS_TONE = {
  detecting: 'neutral',
  detected:  'neutral',
  installed: 'info',
  capturing: 'success',
  error:     'danger',
};

const HK_CAPTURE_SNIPPET = `# CLI
lore capture --source mytool --scope private

# HTTP
curl -X POST http://localhost:8099/capture \\
  -H "Content-Type: application/json" \\
  -d '{"content":"...", "source":"mytool", "scope":"private"}'`;

function HK_ToolRow({ id, name, description, detected, status, statusEntry, cfg, onToggle, onMode, onScope, last }) {
  const known       = HK_KNOWN[id] || {};
  const label       = known.label || name || id;
  const icon        = known.icon  || 'plug';
  const experimental = known.experimental || false;
  const enabled     = cfg.enabled;
  const installing  = cfg.installing;

  // Derive badge from live status + statusEntry
  const liveStatus  = statusEntry
    ? (statusEntry.capturing ? 'capturing' : statusEntry.installed ? 'installed' : (detected ? 'detected' : 'detecting'))
    : (status || (detected ? 'detected' : 'detecting'));
  const badgeTone   = HK_STATUS_TONE[liveStatus] || 'neutral';

  return (
    <HK_Row label={label} hint={description} last={last}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {experimental && (
          <HK_Badge tone="neutral">Experimental — coming soon</HK_Badge>
        )}
        <HK_Badge tone={badgeTone} dot={liveStatus === 'capturing'}>{liveStatus}</HK_Badge>

        {enabled && !experimental && (
          <React.Fragment>
            <HK_Select
              value={cfg.mode}
              onChange={onMode}
              options={['live', 'session-end']}
            />
            <HK_Select
              value={cfg.scope}
              onChange={onScope}
              options={['private', 'team', 'enterprise']}
            />
          </React.Fragment>
        )}

        <HK_Switch
          checked={enabled}
          onChange={(v) => onToggle(v)}
          disabled={installing}
        />

        {(enabled || (statusEntry && statusEntry.installed)) && (
          <HK_Button variant="ghost" size="sm" onClick={() => onToggle(false)}>
            Uninstall
          </HK_Button>
        )}
      </div>
      {cfg.error && (
        <div style={{ width: '100%', marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--clay-400)', paddingLeft: 0, lineHeight: 1.5 }}>
          {cfg.error}
        </div>
      )}
    </HK_Row>
  );
}

function HooksView() {
  // toolMap: id -> detect() entry (or stub)
  const [toolMap, setToolMap]     = React.useState({});
  const [statuses, setStatuses]   = React.useState([]);
  // toolCfg: id -> { mode, scope, enabled, installing, error }
  const [toolCfg, setToolCfg]     = React.useState({});
  const [ready, setReady]         = React.useState(null); // null=loading, true=ok, false=not available
  const [copied, setCopied]       = React.useState(false);
  const unsubRef                  = React.useRef(null);

  const statusById = React.useMemo(
    () => Object.fromEntries(statuses.map((s) => [s.id, s])),
    [statuses]
  );

  const refreshStatuses = React.useCallback(async () => {
    if (!window.lore?.hooks?.status) return;
    try {
      const s = await window.lore.hooks.status();
      setStatuses(Array.isArray(s) ? s : []);   // tolerate non-array shapes — never crash the view
    } catch { /* non-fatal */ }
  }, []);

  React.useEffect(() => {
    if (!window.lore?.hooks?.detect) {
      setReady(false);
      return;
    }
    (async () => {
      try {
        const detected = await window.lore.hooks.detect();
        const map = {};
        for (const t of (detected || [])) { map[t.id] = t; }
        setToolMap(map);

        // Build initial cfg — default all known tools even if not detected
        const cfg = {};
        const allIds = Array.from(new Set([...HK_TOOL_ORDER, ...Object.keys(map)]));
        for (const id of allIds) {
          const t = map[id];
          cfg[id] = { mode: 'session-end', scope: 'private', enabled: !!(t && t.installed), installing: false, error: '' };
        }
        setToolCfg(cfg);
        setReady(true);
        await refreshStatuses();
      } catch {
        setReady(false);
      }

      if (window.lore?.onHooksUpdate) {
        try {
          const unsub = window.lore.onHooksUpdate(async () => { await refreshStatuses(); });
          unsubRef.current = unsub;
        } catch { /* non-fatal */ }
      }
    })();

    return () => {
      if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    };
  }, [refreshStatuses]);

  const patchCfg = (id, patch) => setToolCfg((m) => ({ ...m, [id]: { ...(m[id] || {}), ...patch } }));

  const handleToggle = async (id, val) => {
    const cfg = toolCfg[id] || { mode: 'session-end', scope: 'private' };
    if (val) {
      patchCfg(id, { enabled: true, installing: true, error: '' });
      if (window.lore?.hooks?.install) {
        try {
          const r = await window.lore.hooks.install(id, { mode: cfg.mode, scope: cfg.scope });
          if (r && r.ok === false) {
            patchCfg(id, { enabled: false, installing: false, error: r.reason || 'Install failed.' });
          } else {
            patchCfg(id, { enabled: true, installing: false, error: '' });
          }
        } catch (e) {
          patchCfg(id, { enabled: false, installing: false, error: String(e) });
        }
      } else {
        patchCfg(id, { enabled: false, installing: false, error: 'hooks.install not available yet.' });
      }
      await refreshStatuses();
    } else {
      patchCfg(id, { installing: true, error: '' });
      if (window.lore?.hooks?.uninstall) {
        try { await window.lore.hooks.uninstall(id); } catch { /* non-fatal */ }
      }
      patchCfg(id, { enabled: false, installing: false, error: '' });
      await refreshStatuses();
    }
  };

  const copySnippet = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(HK_CAPTURE_SNIPPET).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }).catch(() => {});
    }
  };

  // All tool IDs to render, preserving HK_TOOL_ORDER then any extras from detect()
  const allToolIds = React.useMemo(() => {
    const extra = Object.keys(toolMap).filter((id) => !HK_TOOL_ORDER.includes(id));
    return [...HK_TOOL_ORDER, ...extra];
  }, [toolMap]);

  return (
    <div style={HK_S.wrap}>
      <div style={HK_S.body}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 24 }}>
          <img
            src="design/assets/sprites/rune-link.png"
            alt=""
            style={{ width: 36, height: 36, objectFit: 'contain', marginTop: 4, opacity: 0.85 }}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
          <div>
            <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-3xl)', fontWeight: 600, color: 'var(--text-strong)', margin: '0 0 4px' }}>Hooks</h1>
            <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: 0, lineHeight: 1.6, maxWidth: 560 }}>
              Lore learns as you work — hook into your AI tools so every session feeds your graph.
              All local, secrets redacted before indexing.
            </p>
          </div>
        </div>

        {/* Not ready state */}
        {ready === false && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '48px 24px', background: 'var(--surface-panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
            <HK_Icon name="plug" size={28} style={{ color: 'var(--text-faint)' }} />
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 16, color: 'var(--text-body)' }}>Hooks backend not ready</div>
            <div style={{ fontSize: 13, color: 'var(--text-subtle)', maxWidth: 380, lineHeight: 1.6 }}>
              The hooks IPC bridge is not available yet. Make sure the Lore backend is running on :8099 and try re-opening this view.
            </div>
          </div>
        )}

        {/* Loading state */}
        {ready === null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 0', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-faint)' }}>
            <HK_Icon name="loader" size={14} style={{ color: 'var(--brand-fg)' }} />
            Detecting tools…
          </div>
        )}

        {/* Main content */}
        {ready === true && (
          <React.Fragment>
            <HK_Section icon="plug" title="AI tool hooks">
              {allToolIds.map((id, i) => {
                const tool = toolMap[id] || { id, name: HK_KNOWN[id]?.label || id, description: '', detected: false, installed: false, status: 'detecting' };
                const cfg  = toolCfg[id] || { mode: 'session-end', scope: 'private', enabled: false, installing: false, error: '' };
                const isLast = i === allToolIds.length - 1;
                return (
                  <HK_ToolRow
                    key={id}
                    id={id}
                    name={tool.name}
                    description={tool.description}
                    detected={tool.detected}
                    status={tool.status}
                    statusEntry={statusById[id] || null}
                    cfg={cfg}
                    onToggle={(v) => handleToggle(id, v)}
                    onMode={(v) => patchCfg(id, { mode: v })}
                    onScope={(v) => patchCfg(id, { scope: v })}
                    last={isLast}
                  />
                );
              })}
            </HK_Section>

            {/* Generic escape hatch */}
            <HK_Section icon="terminal" title="Any other tool">
              <HK_Row label="HTTP endpoint" hint="POST JSON to capture any session into Lore. Scoped and indexed like a normal note.">
                <HK_Badge tone="neutral">localhost:8099</HK_Badge>
              </HK_Row>
              <HK_Row label="CLI" hint={`lore capture --source <name> --scope <private|team|enterprise>`} last>
                <HK_Button variant="secondary" size="sm" icon={copied ? 'check' : 'copy'} onClick={copySnippet}>
                  {copied ? 'Copied' : 'Copy snippet'}
                </HK_Button>
              </HK_Row>
              <div style={{ margin: '0 16px 14px', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                <pre style={{ margin: 0, padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{HK_CAPTURE_SNIPPET}</pre>
              </div>
            </HK_Section>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

window.LoreHooksView = HooksView;
