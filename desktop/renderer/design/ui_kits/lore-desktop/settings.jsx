/* global React */
// Lore desktop — Account settings
const stNS = window.VaultDesignSystem_ffbf58;
const { Icon: StIcon, Avatar: StAvatar, Switch: StSwitch, Button: StButton, Badge: StBadge, ScopeTag: StScope } = stNS;

const stS = {
  wrap: { flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--surface-canvas)' },
  body: { maxWidth: 760, margin: '0 auto', padding: '28px 28px 80px' },
  section: { border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface-panel)', marginBottom: 18, overflow: 'hidden' },
  secHead: { display: 'flex', alignItems: 'center', gap: 9, padding: '12px 16px', borderBottom: '1px solid var(--divider)' },
  row: { display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', borderBottom: '1px solid var(--divider)' },
  label: { fontSize: 13.5, color: 'var(--text-strong)', fontWeight: 500 },
  hint: { fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 },
};

function Section({ icon, title, children }) {
  return (
    <div style={stS.section}>
      <div style={stS.secHead}>
        <StIcon name={icon} size={15} style={{ color: 'var(--brand-fg)' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)', textTransform: 'none' }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Row({ label, hint, children, last }) {
  return (
    <div style={{ ...stS.row, borderBottom: last ? 'none' : stS.row.borderBottom }}>
      <div style={{ flex: 1 }}>
        <div style={stS.label}>{label}</div>
        {hint && <div style={stS.hint}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function SettingsView({ settings, config, scopeOptions = [], onOpenSetup }) {
  const s = {
    account: {},
    indexing: {},
    sync: {},
    connections: [],
    ...(settings || {}),
  };
  s.account = s.account || {};
  s.indexing = s.indexing || {};
  s.sync = s.sync || {};
  s.connections = Array.isArray(s.connections) ? s.connections : [];
  const [defScope, setDefScope] = React.useState('');
  const [cfg, setCfg] = React.useState(config || null);

  // Developer / Integrations state
  const [mcpStatus, setMcpStatus] = React.useState('checking'); // 'checking' | 'installed' | 'detected' | 'not configured'
  const [mcpActivating, setMcpActivating] = React.useState(false);
  const [copiedKey, setCopiedKey] = React.useState(''); // which snippet was copied

  // Data upkeep state
  const [upkeepAuto, setUpkeepAuto] = React.useState(false);
  const [upkeepRunning, setUpkeepRunning] = React.useState(false);
  const [upkeepResult, setUpkeepResult] = React.useState(null); // {dateNotes, topics, folded} | {error}
  const [upkeepStatusLine, setUpkeepStatusLine] = React.useState('');

  React.useEffect(() => {
    if (window.lore && window.lore.mcp && window.lore.mcp.detect) {
      window.lore.mcp.detect()
        .then((st) => setMcpStatus(st || 'not configured'))
        .catch(() => setMcpStatus('not configured'));
    } else {
      setMcpStatus('not configured');
    }
    if (window.lore && window.lore.upkeep && window.lore.upkeep.status) {
      window.lore.upkeep.status()
        .then((st) => { if (st) setUpkeepStatusLine(String(st)); })
        .catch(() => {});
    }
    if (window.lore && window.lore.config && window.lore.config.get) {
      window.lore.config.get()
        .then((c) => { setCfg(c || null); setDefScope((c && c.scope) || ''); })
        .catch(() => {});
    }
  }, []);

  React.useEffect(() => {
    setCfg(config || null);
    setDefScope((config && config.scope) || '');
  }, [config]);

  const stCopy = (text, key) => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((c) => (c === key ? '' : c)), 1800);
    }).catch(() => {});
  };

  const stMcpToggle = async (enable) => {
    setMcpActivating(true);
    try {
      if (enable) {
        if (window.lore && window.lore.mcp && window.lore.mcp.install) await window.lore.mcp.install();
        setMcpStatus('installed');
      } else {
        if (window.lore && window.lore.mcp && window.lore.mcp.uninstall) await window.lore.mcp.uninstall();
        setMcpStatus('not configured');
      }
    } catch { /* non-fatal */ }
    setMcpActivating(false);
  };

  const stRunUpkeep = async () => {
    if (!window.lore || !window.lore.upkeep || !window.lore.upkeep.run) return;
    setUpkeepRunning(true);
    setUpkeepResult(null);
    try {
      if (!cfg || !cfg.tenant) {
        setUpkeepResult({ error: 'tenant is not configured' });
        setUpkeepRunning(false);
        return;
      }
      const res = await window.lore.upkeep.run({ tenant: cfg.tenant, scope: cfg.scope || undefined });
      setUpkeepResult(res || {});
      if (window.lore.upkeep.status) {
        window.lore.upkeep.status().then((st) => { if (st) setUpkeepStatusLine(String(st)); }).catch(() => {});
      }
    } catch (e) {
      setUpkeepResult({ error: String((e && e.message) || e) });
    }
    setUpkeepRunning(false);
  };

  const stSetUpkeepAuto = (v) => {
    setUpkeepAuto(v);
    if (window.lore && window.lore.upkeep && window.lore.upkeep.setAuto) {
      window.lore.upkeep.setAuto(v).catch(() => {});
    }
  };

  const ST_CLI_INSTALL = 'pip install -e ./core';
  const ST_CLI_SAMPLE = `lore ask "<question>" --scope ${(cfg && cfg.scope) || '<scope>'} --tenant ${(cfg && cfg.tenant) || '<tenant>'}`;
  const ST_MCP_JSON = '{\n  "mcpServers": {\n    "lore": {\n      "command": "python",\n      "args": ["-m", "lore.mcp_server"],\n      "cwd": "<path-to-core>"\n    }\n  }\n}';

  const stMcpIsActive = mcpStatus === 'installed';
  const stMcpTone = mcpStatus === 'installed' ? 'success' : mcpStatus === 'detected' ? 'info' : 'neutral';
  const stMcpLabel = mcpStatus === 'checking' ? 'checking…' : mcpStatus;
  const identityReady = Boolean(cfg && cfg.tenant && cfg.scope);
  const ownerLabel = (cfg && cfg.owner) || 'No identity configured';
  const tenantLabel = (cfg && cfg.tenant) || 'No tenant';
  const scopeLabel = (cfg && cfg.scope) || '';
  const displayNone = (v) => v || 'None';

  return (
    <div style={stS.wrap}>
      <div style={stS.body}>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-3xl)', fontWeight: 600, color: 'var(--text-strong)', margin: '0 0 4px' }}>Settings</h1>
        <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: '0 0 24px' }}>Manage your account, indexing, and the sources Lore reads.</p>

        <Section icon="user" title="Account">
          <div style={{ ...stS.row }}>
            <StAvatar name={ownerLabel} size={48} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-strong)' }}>{ownerLabel}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>{tenantLabel}{scopeLabel ? ` · ${scopeLabel}` : ''}</div>
            </div>
            <StBadge tone={identityReady ? 'success' : 'neutral'}>{identityReady ? 'configured' : 'not configured'}</StBadge>
            <StButton variant="secondary" size="sm" onClick={onOpenSetup}>Configure</StButton>
          </div>
          <Row label="Note scope" hint="New notes use this permission when configured." last>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {defScope ? <StScope scope={defScope} size="sm" /> : <StBadge tone="neutral">none</StBadge>}
              {scopeOptions.filter((sc) => sc !== defScope).slice(0, 3).map((sc) => <StScope key={sc} scope={sc} size="sm" />)}
            </div>
          </Row>
        </Section>

        <Section icon="cpu" title="Indexing & recall">
          <Row label="Auto-index on save" hint="This control is not wired to persistent config yet.">
            <StBadge tone="neutral">not configured</StBadge>
          </Row>
          <Row label="Contextual retrieval" hint="No retrieval transform is configured from the desktop app yet.">
            <StBadge tone="neutral">not configured</StBadge>
          </Row>
          <Row label="Embedding model">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>{displayNone(s.indexing.embedder)}</span>
          </Row>
          <Row label="Reranker">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>{displayNone(s.indexing.reranker)}</span>
          </Row>
          <Row label="Local fallback" hint="No local fallback is configured." last>
            <StBadge tone="neutral">not configured</StBadge>
          </Row>
        </Section>

        <Section icon="refresh-cw" title="Sync & storage">
          <Row label="Provider">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>{displayNone(s.sync.provider)}</span>
          </Row>
          <Row label="Encryption" hint="Vaults are encrypted at rest.">
            <StBadge tone={s.sync.encrypted ? 'success' : 'neutral'} dot={s.sync.encrypted}>{s.sync.encrypted ? 'enabled' : 'not configured'}</StBadge>
          </Row>
          <Row label="Last sync" last>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-faint)' }}>{displayNone(s.sync.lastSync)}</span>
          </Row>
        </Section>

        <Section icon="plug" title="Connected sources">
          {s.connections.length === 0 && (
            <Row label="Sources" hint="No connected sources yet." last>
              <StBadge tone="neutral">none</StBadge>
            </Row>
          )}
          {s.connections.map((c, i) => (
            <Row key={c.id} label={c.name} hint={c.detail} last={i === s.connections.length - 1}>
              {c.status === 'connected'
                ? <StBadge tone="success" dot>connected</StBadge>
                : <StButton variant="secondary" size="sm" icon="plus">Connect</StButton>}
            </Row>
          ))}
        </Section>

        {/* ── CLI ── */}
        <Section icon="terminal" title="CLI">
          <Row label="Install" hint="Run once in your terminal to make `lore` available globally.">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-body)', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '3px 8px' }}>{ST_CLI_INSTALL}</code>
              <StButton variant="ghost" size="sm" icon={copiedKey === 'cli-install' ? 'check' : 'copy'} onClick={() => stCopy(ST_CLI_INSTALL, 'cli-install')}>
                {copiedKey === 'cli-install' ? 'Copied' : 'Copy'}
              </StButton>
            </div>
          </Row>
          <Row label="Example query" hint="Ask a question from your terminal." last>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-body)', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '3px 8px' }}>{ST_CLI_SAMPLE}</code>
              <StButton variant="ghost" size="sm" icon={copiedKey === 'cli-sample' ? 'check' : 'copy'} onClick={() => stCopy(ST_CLI_SAMPLE, 'cli-sample')}>
                {copiedKey === 'cli-sample' ? 'Copied' : 'Copy'}
              </StButton>
            </div>
          </Row>
        </Section>

        {/* ── MCP server ── */}
        <Section icon="plug-2" title="MCP server">
          <Row label="Status">
            <StBadge tone={stMcpTone} dot>{stMcpLabel}</StBadge>
          </Row>
          <Row label="Activate in Claude Code / Cursor / Codex" hint="One-click writes the lore entry into ~/.claude/.mcp.json (idempotent, backup kept).">
            <StSwitch
              checked={stMcpIsActive}
              onChange={stMcpToggle}
              disabled={mcpActivating || mcpStatus === 'checking'}
            />
          </Row>
          <Row label="Manual setup" hint="Paste into ~/.claude/.mcp.json (or cursor/codex equivalent) to configure manually." last>
            <StButton
              variant="ghost"
              size="sm"
              icon={copiedKey === 'mcp-json' ? 'check' : 'copy'}
              onClick={() => stCopy(ST_MCP_JSON, 'mcp-json')}
            >
              {copiedKey === 'mcp-json' ? 'Copied JSON' : 'Copy JSON'}
            </StButton>
          </Row>
          <div style={{ padding: '10px 16px 14px', background: 'var(--surface-inset)', borderTop: '1px solid var(--divider)' }}>
            <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{ST_MCP_JSON}</pre>
          </div>
        </Section>

        {/* ── Data upkeep ── */}
        <Section icon="refresh-ccw" title="Data upkeep">
          <Row label="Auto-upkeep" hint={identityReady ? 'Lore folds date/session notes into topic nodes automatically after each ingest.' : 'Configure tenant and scope before enabling upkeep.'}>
            <StSwitch checked={upkeepAuto && identityReady} onChange={stSetUpkeepAuto} disabled={!identityReady} />
          </Row>
          <Row label="Rebuild now" hint="Detect ephemeral notes (daily, session, sync) and consolidate them into durable topic nodes." last>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {upkeepRunning && (
                <StIcon name="loader" size={14} style={{ color: 'var(--brand-fg)', animation: 'lore-pulse 1s linear infinite' }} />
              )}
              <StButton
                variant="secondary"
                size="sm"
                icon="zap"
                onClick={stRunUpkeep}
                disabled={upkeepRunning || !identityReady}
              >
                {upkeepRunning ? 'Running…' : 'Rebuild now'}
              </StButton>
            </div>
          </Row>
          {(upkeepResult || upkeepStatusLine) && (
            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--divider)', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {upkeepResult && !upkeepResult.error && (
                <span>
                  Folded <strong>{upkeepResult.dateNotes ?? '?'}</strong> date notes into{' '}
                  <strong>{upkeepResult.topics ?? '?'}</strong> topics
                  {upkeepResult.folded != null ? ` (${upkeepResult.folded} merged)` : ''}.
                </span>
              )}
              {upkeepResult && upkeepResult.error && (
                <span style={{ color: 'var(--clay-400)' }}>Error: {upkeepResult.error}</span>
              )}
              {!upkeepResult && upkeepStatusLine && (
                <span>{upkeepStatusLine}</span>
              )}
            </div>
          )}
        </Section>

        {s.account && s.account.name && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <StButton variant="danger" icon="log-out">Sign out</StButton>
          </div>
        )}
      </div>
    </div>
  );
}

window.LoreSettingsView = SettingsView;
