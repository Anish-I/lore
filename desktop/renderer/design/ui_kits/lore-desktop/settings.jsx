/* global React */
// Lore desktop — Account settings
const stNS = window.VaultDesignSystem_ffbf58;
const { Icon: StIcon, Avatar: StAvatar, Switch: StSwitch, Select: StSelect, Button: StButton, Badge: StBadge, ScopeTag: StScope, Input: StInput } = stNS;

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

function SettingsView({ settings }) {
  const s = settings;
  const [auto, setAuto] = React.useState(s.indexing.autoIndex);
  const [ctx, setCtx] = React.useState(s.indexing.contextual);
  const [local, setLocal] = React.useState(s.indexing.localFallback);
  const [defScope, setDefScope] = React.useState('private');

  // Developer / Integrations state
  const [mcpStatus, setMcpStatus] = React.useState('checking'); // 'checking' | 'installed' | 'detected' | 'not configured'
  const [mcpActivating, setMcpActivating] = React.useState(false);
  const [copiedKey, setCopiedKey] = React.useState(''); // which snippet was copied

  // Google account / auth state
  const [authUser, setAuthUser] = React.useState(null);   // {user_id, email, scopes} | null
  const [authBusy, setAuthBusy] = React.useState(false);
  const [authError, setAuthError] = React.useState('');

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
    if (window.lore && window.lore.auth && window.lore.auth.status) {
      window.lore.auth.status().then((u) => setAuthUser(u || null)).catch(() => {});
    }
  }, []);

  const stSignIn = async () => {
    if (!window.lore || !window.lore.auth) return;
    setAuthBusy(true); setAuthError('');
    try {
      const r = await window.lore.auth.login();
      if (r && r.ok) setAuthUser({ user_id: r.user_id, email: r.email, scopes: r.scopes });
      else setAuthError((r && r.reason) || 'sign-in failed');
    } catch (e) { setAuthError(String((e && e.message) || e)); }
    setAuthBusy(false);
  };

  const stSignOut = async () => {
    if (window.lore && window.lore.auth) { try { await window.lore.auth.logout(); } catch { /* ignore */ } }
    setAuthUser(null);
  };

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
      const res = await window.lore.upkeep.run({ tenant: 'solo' });
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
  const ST_CLI_SAMPLE = 'lore ask "what\'s the kalshi bot"';
  const ST_MCP_JSON = '{\n  "mcpServers": {\n    "lore": {\n      "command": "python",\n      "args": ["-m", "lore.mcp_server"],\n      "cwd": "<path-to-core>"\n    }\n  }\n}';

  const stMcpIsActive = mcpStatus === 'installed';
  const stMcpTone = mcpStatus === 'installed' ? 'success' : mcpStatus === 'detected' ? 'info' : 'neutral';
  const stMcpLabel = mcpStatus === 'checking' ? 'checking…' : mcpStatus;

  return (
    <div style={stS.wrap}>
      <div style={stS.body}>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-3xl)', fontWeight: 600, color: 'var(--text-strong)', margin: '0 0 4px' }}>Settings</h1>
        <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: '0 0 24px' }}>Manage your account, indexing, and the sources Lore reads.</p>

        <Section icon="user" title="Account">
          <div style={{ ...stS.row }}>
            <StAvatar name={s.account.avatar} size={48} scope="team" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-strong)' }}>{s.account.name}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>{s.account.email}</div>
            </div>
            <StBadge tone="neutral">{s.account.role}</StBadge>
            <StButton variant="secondary" size="sm">Edit profile</StButton>
          </div>
          <Row label="Google sign-in" hint={authUser ? `Signed in — ${(authUser.scopes && authUser.scopes.length) || 0} team scope(s)` : 'Sign in to sync team/enterprise notes and ask across your team.'}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {authUser
                ? <>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-muted)' }}>{authUser.email}</span>
                    <StButton variant="secondary" size="sm" onClick={stSignOut}>Sign out</StButton>
                  </>
                : <StButton variant="primary" size="sm" onClick={stSignIn} disabled={authBusy}>{authBusy ? 'Opening browser…' : 'Sign in with Google'}</StButton>}
            </div>
          </Row>
          {authError && <div style={{ padding: '0 16px 10px', color: 'var(--clay-400)', fontSize: 12 }}>{authError}</div>}
          <Row label="Default note scope" hint="New notes start with this permission." last>
            <div style={{ display: 'flex', gap: 6 }}>
              {['private', 'team', 'enterprise'].map((sc) => (
                <button key={sc} onClick={() => setDefScope(sc)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}>
                  <span style={{ opacity: defScope === sc ? 1 : 0.45, outline: defScope === sc ? '1px solid var(--brand-soft-border)' : 'none', borderRadius: 'var(--radius-full)', display: 'inline-block' }}>
                    <StScope scope={sc} size="sm" />
                  </span>
                </button>
              ))}
            </div>
          </Row>
        </Section>

        <Section icon="cpu" title="Indexing & recall">
          <Row label="Auto-index on save" hint="Re-index notes a couple of seconds after each edit.">
            <StSwitch checked={auto} onChange={setAuto} />
          </Row>
          <Row label="Contextual retrieval" hint="Prepend a situating blurb to each chunk before embedding. Lifts recall.">
            <StSwitch checked={ctx} onChange={setCtx} />
          </Row>
          <Row label="Embedding model">
            <StSelect defaultValue={s.indexing.embedder} options={['voyage-4-large', 'voyage-4', 'BGE-M3 (local)']} />
          </Row>
          <Row label="Reranker">
            <StSelect defaultValue={s.indexing.reranker} options={['rerank-2.5', 'cohere rerank-v4']} />
          </Row>
          <Row label="Local fallback" hint="Keep a local embedder for data-residency. Off by default." last>
            <StSwitch checked={local} onChange={setLocal} />
          </Row>
        </Section>

        <Section icon="refresh-cw" title="Sync & storage">
          <Row label="Provider">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>{s.sync.provider}</span>
          </Row>
          <Row label="Encryption" hint="Vaults are encrypted at rest.">
            <StBadge tone="success" dot>{s.sync.encrypted ? 'enabled' : 'off'}</StBadge>
          </Row>
          <Row label="Last sync" last>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-faint)' }}>{s.sync.lastSync}</span>
          </Row>
        </Section>

        <Section icon="plug" title="Connected sources">
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
          <Row label="Auto-upkeep" hint="Lore folds date/session notes into topic nodes automatically after each ingest.">
            <StSwitch checked={upkeepAuto} onChange={stSetUpkeepAuto} />
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
                disabled={upkeepRunning}
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

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <StButton variant="danger" icon="log-out">Sign out</StButton>
        </div>
      </div>
    </div>
  );
}

window.LoreSettingsView = SettingsView;
