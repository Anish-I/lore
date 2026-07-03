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
  hint: { fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }
};

function Section({ icon, title, children }) {
  return (/*#__PURE__*/
    React.createElement("div", { style: stS.section }, /*#__PURE__*/
    React.createElement("div", { style: stS.secHead }, /*#__PURE__*/
    React.createElement(StIcon, { name: icon, size: 15, style: { color: 'var(--brand-fg)' } }), /*#__PURE__*/
    React.createElement("span", { style: { fontSize: 13, fontWeight: 600, color: 'var(--text-strong)', textTransform: 'none' } }, title)
    ),
    children
    ));

}

function Row({ label, hint, children, last }) {
  return (/*#__PURE__*/
    React.createElement("div", { style: { ...stS.row, borderBottom: last ? 'none' : stS.row.borderBottom } }, /*#__PURE__*/
    React.createElement("div", { style: { flex: 1 } }, /*#__PURE__*/
    React.createElement("div", { style: stS.label }, label),
    hint && /*#__PURE__*/React.createElement("div", { style: stS.hint }, hint)
    ),
    children
    ));

}

function normalizeMcpStatus(st) {
  if (!st) return 'not configured';
  if (typeof st === 'string') return st;
  if (st.installed) return 'installed';
  if (st.detected) return 'detected';
  return 'not configured';
}

function stText(value, fallback = 'None') {
  if (value == null || value === '') return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && (Object.prototype.hasOwnProperty.call(value, 'detected') || Object.prototype.hasOwnProperty.call(value, 'installed'))) {
    return normalizeMcpStatus(value);
  }
  if (value && value.error) return String(value.error);
  try {return JSON.stringify(value);} catch {return fallback;}
}

// "provider · model" label for the /config/retrieval snapshot ({error}/null aware).
function stRetrievalModel(retrieval, key) {
  if (retrieval === null) return 'checking…';
  if (retrieval.error) return 'backend offline';
  const m = retrieval[key];
  if (!m || !m.model) return 'unknown';
  return m.provider ? `${m.provider} · ${m.model}` : String(m.model);
}

function SettingsView({ settings, config, scopeOptions = [], onOpenSetup }) {
  const s = {
    account: {},
    indexing: {},
    sync: {},
    connections: [],
    ...(settings || {})
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

  // Google account / auth state
  const [authUser, setAuthUser] = React.useState(null); // {user_id, email, scopes} | null
  const [authBusy, setAuthBusy] = React.useState(false);
  const [authError, setAuthError] = React.useState('');

  // Indexing & recall state (real wiring: config flag + backend /config/retrieval)
  const [autoIndexOnSave, setAutoIndexOnSave] = React.useState(true); // default ON; explicit false disables
  const [retrieval, setRetrieval] = React.useState(null); // {embeddingModel, reranker, contextualRetrieval, localFallback} | {error} | null while loading
  const [importResult, setImportResult] = React.useState(null); // {ok, applied, ignored} | {ok:false, reason}

  // Lore CLI install state
  const [cliStatus, setCliStatus] = React.useState(null); // {installed, path, onPath, hint?} | null while checking
  const [cliInstalling, setCliInstalling] = React.useState(false);
  const [cliResult, setCliResult] = React.useState(null); // install() result | null

  // Data upkeep state — defaults ON; only an explicit cfg.upkeepAuto === false disables
  const [upkeepAuto, setUpkeepAuto] = React.useState(true);
  const [upkeepRunning, setUpkeepRunning] = React.useState(false);
  const [upkeepResult, setUpkeepResult] = React.useState(null); // {dateNotes, topics, folded} | {error}
  const [upkeepStatusLine, setUpkeepStatusLine] = React.useState('');

  // AI provider (graph enrichment): codex sub / claude sub / byok
  const [providers, setProviders] = React.useState(null); // { codex, claude, byok } | null
  const [llmProvider, setLlmProvider] = React.useState(config && config.llmProvider || 'codex');
  const [enrichRunning, setEnrichRunning] = React.useState(false);
  const [enrichResult, setEnrichResult] = React.useState(null);

  React.useEffect(() => {
    if (window.lore && window.lore.mcp && window.lore.mcp.detect) {
      window.lore.mcp.detect().
      then((st) => setMcpStatus(normalizeMcpStatus(st))).
      catch(() => setMcpStatus('not configured'));
    } else {
      setMcpStatus('not configured');
    }
    if (window.lore && window.lore.enrich && window.lore.enrich.providers) {
      window.lore.enrich.providers().then((p) => setProviders(p || null)).catch(() => {});
    }
    if (window.lore && window.lore.upkeep && window.lore.upkeep.status) {
      window.lore.upkeep.status().
      then((st) => {if (st) setUpkeepStatusLine(stText(st, ''));}).
      catch(() => {});
    }
    if (window.lore && window.lore.config && window.lore.config.get) {
      window.lore.config.get().
      then((c) => {
        setCfg(c || null);
        setDefScope(c && c.scope || '');
        setAutoIndexOnSave(!(c && c.autoIndexOnSave === false));
        setUpkeepAuto(!(c && c.upkeepAuto === false));
      }).
      catch(() => {});
    }
    if (window.lore && window.lore.auth && window.lore.auth.status) {
      window.lore.auth.status().then((u) => setAuthUser(u || null)).catch(() => {});
    }
    if (window.lore && window.lore.retrieval && window.lore.retrieval.config) {
      window.lore.retrieval.config().then((r) => setRetrieval(r || { error: 'no response' })).catch((e) => setRetrieval({ error: String(e) }));
    } else {
      setRetrieval({ error: 'unavailable' });
    }
    if (window.lore && window.lore.cli && window.lore.cli.status) {
      window.lore.cli.status().then((s) => setCliStatus(s || null)).catch(() => setCliStatus(null));
    }
  }, []);

  const stSignIn = async () => {
    if (!window.lore || !window.lore.auth) return;
    setAuthBusy(true);setAuthError('');
    try {
      const r = await window.lore.auth.login();
      if (r && r.ok) setAuthUser({ user_id: r.user_id, email: r.email, scopes: r.scopes });else
      setAuthError(r && (r.detail || r.reason) || 'sign-in failed');
    } catch (e) {setAuthError(String(e && e.message || e));}
    setAuthBusy(false);
  };

  const stSignOut = async () => {
    if (window.lore && window.lore.auth) {try {await window.lore.auth.logout();} catch {/* ignore */}}
    setAuthUser(null);
  };

  React.useEffect(() => {
    setCfg(config || null);
    setDefScope(config && config.scope || '');
    if (config) {
      setAutoIndexOnSave(config.autoIndexOnSave !== false);
      setUpkeepAuto(config.upkeepAuto !== false);
    }
  }, [config]);

  const stCopy = (text, key) => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((c) => c === key ? '' : c), 1800);
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
    } catch {/* non-fatal */}
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
        window.lore.upkeep.status().then((st) => {if (st) setUpkeepStatusLine(stText(st, ''));}).catch(() => {});
      }
    } catch (e) {
      setUpkeepResult({ error: String(e && e.message || e) });
    }
    setUpkeepRunning(false);
  };

  const stSetAutoIndex = (v) => {
    setAutoIndexOnSave(v);
    if (window.lore && window.lore.config && window.lore.config.set) {
      // Persist explicitly (true AND false) so the off-state survives restarts.
      window.lore.config.set({ autoIndexOnSave: !!v }).catch(() => {});
    }
  };

  const stImportConfig = async () => {
    if (!window.lore || !window.lore.config || !window.lore.config.importRetrieval) return;
    setImportResult(null);
    try {
      const r = await window.lore.config.importRetrieval();
      if (r && r.reason === 'canceled') return; // user closed the picker — not an error
      setImportResult(r || { ok: false, reason: 'no response' });
      if (r && r.ok && window.lore.config.get) {
        // Refresh local state so imported toggles show immediately.
        const c = await window.lore.config.get();
        setCfg(c || null);
        setAutoIndexOnSave(!(c && c.autoIndexOnSave === false));
        setUpkeepAuto(!(c && c.upkeepAuto === false));
        if (c && c.llmProvider) setLlmProvider(c.llmProvider);
      }
    } catch (e) {
      setImportResult({ ok: false, reason: String(e && e.message || e) });
    }
  };

  const stInstallCli = async () => {
    if (!window.lore || !window.lore.cli || !window.lore.cli.install) return;
    setCliInstalling(true);
    setCliResult(null);
    try {
      const r = await window.lore.cli.install();
      setCliResult(r || { ok: false, reason: 'no response' });
      if (window.lore.cli.status) {
        const s = await window.lore.cli.status();
        setCliStatus(s || null);
      }
    } catch (e) {
      setCliResult({ ok: false, reason: String(e && e.message || e) });
    }
    setCliInstalling(false);
  };

  const stSetUpkeepAuto = (v) => {
    setUpkeepAuto(v);
    if (window.lore && window.lore.upkeep && window.lore.upkeep.setAuto) {
      window.lore.upkeep.setAuto(v).catch(() => {});
    }
  };

  const stPickProvider = (p) => {
    setLlmProvider(p);
    if (window.lore && window.lore.config && window.lore.config.set) {
      window.lore.config.set({ llmProvider: p }).catch(() => {});
    }
  };

  const stRunEnrich = async () => {
    if (!window.lore || !window.lore.enrich || !window.lore.enrich.run) return;
    if (!cfg || !cfg.tenant) {setEnrichResult({ error: 'tenant is not configured' });return;}
    setEnrichRunning(true);setEnrichResult(null);
    try {
      const res = await window.lore.enrich.run({ tenant: cfg.tenant, limit: 8, provider: llmProvider });
      setEnrichResult(res || {});
    } catch (e) {setEnrichResult({ error: String(e && e.message || e) });}
    setEnrichRunning(false);
  };

  const ST_PROVIDERS = [
  { id: 'codex', label: 'Codex subscription', hint: 'Uses your Codex CLI login. No API key.', install: 'npm i -g @openai/codex   # then: codex login' },
  { id: 'claude', label: 'Claude subscription', hint: 'Uses your Claude Code CLI login. No API key.', install: 'npm i -g @anthropic-ai/claude-code   # then: claude (sign in)' },
  { id: 'byok', label: 'Bring your own key', hint: 'Any OpenAI-compatible key (Together default).', install: 'set LORE_LLM_API_KEY=...   (optionally LORE_LLM_BASE_URL / LORE_LLM_MODEL)' }];


  const ST_CLI_INSTALL = 'pip install -e ./core';
  const ST_CLI_SAMPLE = `lore ask "<question>" --scope ${cfg && cfg.scope || '<scope>'} --tenant ${cfg && cfg.tenant || '<tenant>'}`;
  const ST_MCP_JSON = '{\n  "mcpServers": {\n    "lore": {\n      "command": "python",\n      "args": ["-m", "lore.mcp_server"],\n      "cwd": "<path-to-core>"\n    }\n  }\n}';

  const stMcpIsActive = mcpStatus === 'installed';
  const stMcpTone = mcpStatus === 'installed' ? 'success' : mcpStatus === 'detected' ? 'info' : 'neutral';
  const stMcpLabel = mcpStatus === 'checking' ? 'checking…' : stText(mcpStatus, 'not configured');
  const identityReady = Boolean(cfg && cfg.tenant && cfg.scope);
  const ownerLabel = stText(cfg && cfg.owner, 'No identity configured');
  const tenantLabel = stText(cfg && cfg.tenant, 'No tenant');
  const scopeLabel = stText(cfg && cfg.scope, '');
  const displayNone = (v) => stText(v, 'None');

  return (/*#__PURE__*/
    React.createElement("div", { style: stS.wrap }, /*#__PURE__*/
    React.createElement("div", { style: stS.body }, /*#__PURE__*/
    React.createElement("h1", { style: { fontFamily: 'var(--font-serif)', fontSize: 'var(--text-3xl)', fontWeight: 600, color: 'var(--text-strong)', margin: '0 0 4px' } }, "Settings"), /*#__PURE__*/
    React.createElement("p", { style: { fontSize: 13, color: 'var(--text-subtle)', margin: '0 0 24px' } }, "Manage your account, indexing, and the sources Lore reads."), /*#__PURE__*/

    React.createElement(Section, { icon: "user", title: "Account" }, /*#__PURE__*/
    React.createElement("div", { style: { ...stS.row } }, /*#__PURE__*/
    React.createElement(StAvatar, { name: ownerLabel, size: 48 }), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1 } }, /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 15, fontWeight: 600, color: 'var(--text-strong)' } }, ownerLabel), /*#__PURE__*/
    React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 } }, tenantLabel, scopeLabel ? ` · ${scopeLabel}` : '')
    ), /*#__PURE__*/
    React.createElement(StBadge, { tone: identityReady ? 'success' : 'neutral' }, identityReady ? 'configured' : 'not configured'), /*#__PURE__*/
    React.createElement(StButton, { variant: "secondary", size: "sm", onClick: onOpenSetup }, "Configure")
    ), /*#__PURE__*/
    React.createElement(Row, { label: "Google sign-in", hint: authUser ? `Signed in — ${authUser.scopes && authUser.scopes.length || 0} team scope(s)` : 'Sign in to sync team/enterprise notes and ask across your team.' }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8 } },
    authUser ? /*#__PURE__*/
    React.createElement(React.Fragment, null, /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-muted)' } }, authUser.email), /*#__PURE__*/
    React.createElement(StButton, { variant: "secondary", size: "sm", onClick: stSignOut }, "Sign out")
    ) : /*#__PURE__*/
    React.createElement(StButton, { variant: "primary", size: "sm", onClick: stSignIn, disabled: authBusy }, authBusy ? 'Opening browser…' : 'Sign in with Google')
    )
    ),
    authError && /*#__PURE__*/React.createElement("div", { style: { padding: '0 16px 10px', color: 'var(--clay-400)', fontSize: 12 } }, authError), /*#__PURE__*/
    React.createElement(Row, { label: "Note scope", hint: "New notes use this permission when configured.", last: true }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' } },
    defScope ? /*#__PURE__*/React.createElement(StScope, { scope: defScope, size: "sm" }) : /*#__PURE__*/React.createElement(StBadge, { tone: "neutral" }, "none"),
    scopeOptions.filter((sc) => sc !== defScope).slice(0, 3).map((sc) => /*#__PURE__*/React.createElement(StScope, { key: sc, scope: sc, size: "sm" }))
    )
    )
    ), /*#__PURE__*/

    React.createElement(Section, { icon: "cpu", title: "Indexing & recall" }, /*#__PURE__*/
    React.createElement(Row, { label: "Auto-index on save", hint: "Re-index a note automatically when its file changes on disk. Off: re-index manually (right-click a note \u2192 Re-index Note)." }, /*#__PURE__*/
    React.createElement(StSwitch, { checked: autoIndexOnSave, onChange: stSetAutoIndex })
    ), /*#__PURE__*/
    React.createElement(Row, { label: "Contextual retrieval", hint: "Every chunk is stored with a situating context sentence for better recall. Built into the indexing pipeline." }, /*#__PURE__*/
    React.createElement(StBadge, { tone: retrieval === null ? 'neutral' : retrieval.error ? 'neutral' : 'success', dot: !!(retrieval && !retrieval.error) },
    retrieval === null ? 'checking…' : retrieval.error ? 'backend offline' : 'enabled'
    )
    ), /*#__PURE__*/
    React.createElement(Row, { label: "Embedding model" }, /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' } }, stRetrievalModel(retrieval, 'embeddingModel'))
    ), /*#__PURE__*/
    React.createElement(Row, { label: "Reranker" }, /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' } }, stRetrievalModel(retrieval, 'reranker'))
    ), /*#__PURE__*/
    React.createElement(Row, { label: "Local fallback", hint: "On-device fastembed models. Always used for hook captures and imports; primary for search when no cloud key is set." },
    (() => {
      const lf = retrieval && !retrieval.error ? retrieval.localFallback : null;
      const tone = !lf ? 'neutral' : lf.active ? 'success' : lf.available ? 'info' : 'neutral';
      const label = retrieval === null ? 'checking…' : retrieval.error ? 'backend offline' :
      lf && lf.active ? 'active' : lf && lf.available ? 'available' : 'not available';
      return /*#__PURE__*/React.createElement(StBadge, { tone: tone, dot: !!(lf && lf.active) }, label);
    })()
    ), /*#__PURE__*/
    React.createElement(Row, { label: "Import config", hint: "Apply retrieval and upkeep settings from a JSON file \u2014 another Lore install or a shared team config.", last: true }, /*#__PURE__*/
    React.createElement(StButton, { variant: "secondary", size: "sm", icon: "folder-open", onClick: stImportConfig }, "Import\u2026")
    ),
    importResult && /*#__PURE__*/
    React.createElement("div", { style: { padding: '10px 16px', borderTop: '1px solid var(--divider)', fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.6, color: importResult.ok ? 'var(--text-muted)' : 'var(--clay-400)' } },
    importResult.ok ?
    `Applied: ${Object.keys(importResult.applied || {}).join(', ')}${(importResult.ignored || []).length ? ` · ignored: ${importResult.ignored.join(', ')}` : ''}` :
    `Import failed: ${stText(importResult.reason, 'unknown error')}`
    )

    ), /*#__PURE__*/

    React.createElement(Section, { icon: "refresh-cw", title: "Sync & storage" }, /*#__PURE__*/
    React.createElement(Row, { label: "Provider" }, /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' } }, displayNone(s.sync.provider))
    ), /*#__PURE__*/
    React.createElement(Row, { label: "Encryption", hint: "Libraries are encrypted at rest." }, /*#__PURE__*/
    React.createElement(StBadge, { tone: s.sync.encrypted ? 'success' : 'neutral', dot: s.sync.encrypted }, s.sync.encrypted ? 'enabled' : 'not configured')
    ), /*#__PURE__*/
    React.createElement(Row, { label: "Last sync", last: true }, /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-faint)' } }, displayNone(s.sync.lastSync))
    )
    ), /*#__PURE__*/

    React.createElement(Section, { icon: "plug", title: "Connected sources" },
    s.connections.length === 0 && /*#__PURE__*/
    React.createElement(Row, { label: "Sources", hint: "No connected sources yet.", last: true }, /*#__PURE__*/
    React.createElement(StBadge, { tone: "neutral" }, "none")
    ),

    s.connections.map((c, i) => /*#__PURE__*/
    React.createElement(Row, { key: c.id, label: c.name, hint: c.detail, last: i === s.connections.length - 1 },
    c.status === 'connected' ? /*#__PURE__*/
    React.createElement(StBadge, { tone: "success", dot: true }, "connected") : /*#__PURE__*/
    React.createElement(StButton, { variant: "secondary", size: "sm", icon: "plus" }, "Connect")
    )
    )
    ), /*#__PURE__*/


    React.createElement(Section, { icon: "terminal", title: "CLI" }, /*#__PURE__*/
    React.createElement(Row, { label: "Lore CLI", hint: cliStatus && cliStatus.installed ? `Installed at ${cliStatus.path}` : 'One click puts the `lore` command on your PATH — no sudo, no venv activation.' }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8 } }, /*#__PURE__*/
    React.createElement(StBadge, { tone: cliStatus === null ? 'neutral' : cliStatus.installed ? 'success' : 'neutral', dot: !!(cliStatus && cliStatus.installed) },
    cliStatus === null ? 'checking…' : cliStatus.installed ? 'installed' : 'not installed'
    ), /*#__PURE__*/
    React.createElement(StButton, { variant: "secondary", size: "sm", icon: "download", disabled: cliInstalling, onClick: stInstallCli },
    cliInstalling ? 'Installing…' : cliStatus && cliStatus.installed ? 'Reinstall' : 'Install'
    )
    )
    ),
    (cliResult || cliStatus && cliStatus.installed && !cliStatus.onPath) && /*#__PURE__*/
    React.createElement("div", { style: { padding: '0 16px 10px', fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.6, color: cliResult && cliResult.ok === false ? 'var(--clay-400)' : 'var(--text-muted)' } },
    cliResult && cliResult.ok === false && /*#__PURE__*/React.createElement("div", null, "Install failed: ", stText(cliResult.reason, 'unknown error')),
    cliResult && cliResult.ok && /*#__PURE__*/React.createElement("div", null, "Installed (", cliResult.mechanism, ") at ", cliResult.path),
    (cliResult && cliResult.ok && !cliResult.onPath || !cliResult && cliStatus && !cliStatus.onPath) && /*#__PURE__*/
    React.createElement("div", null, "That folder isn\u2019t on your PATH yet \u2014 run: ", /*#__PURE__*/React.createElement("code", null, cliResult && cliResult.hint || cliStatus && cliStatus.hint || ''))

    ), /*#__PURE__*/

    React.createElement(Row, { label: "Manual install", hint: "Or run once in your terminal to make `lore` available globally." }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 6 } }, /*#__PURE__*/
    React.createElement("code", { style: { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-body)', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '3px 8px' } }, ST_CLI_INSTALL), /*#__PURE__*/
    React.createElement(StButton, { variant: "ghost", size: "sm", icon: copiedKey === 'cli-install' ? 'check' : 'copy', onClick: () => stCopy(ST_CLI_INSTALL, 'cli-install') },
    copiedKey === 'cli-install' ? 'Copied' : 'Copy'
    )
    )
    ), /*#__PURE__*/
    React.createElement(Row, { label: "Example query", hint: "Ask a question from your terminal.", last: true }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 6 } }, /*#__PURE__*/
    React.createElement("code", { style: { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-body)', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '3px 8px' } }, ST_CLI_SAMPLE), /*#__PURE__*/
    React.createElement(StButton, { variant: "ghost", size: "sm", icon: copiedKey === 'cli-sample' ? 'check' : 'copy', onClick: () => stCopy(ST_CLI_SAMPLE, 'cli-sample') },
    copiedKey === 'cli-sample' ? 'Copied' : 'Copy'
    )
    )
    )
    ), /*#__PURE__*/


    React.createElement(Section, { icon: "plug-2", title: "MCP server" }, /*#__PURE__*/
    React.createElement(Row, { label: "Status" }, /*#__PURE__*/
    React.createElement(StBadge, { tone: stMcpTone, dot: true }, stMcpLabel)
    ), /*#__PURE__*/
    React.createElement(Row, { label: "Activate in Claude Code / Cursor / Codex", hint: "One-click writes the lore entry into ~/.claude/.mcp.json (idempotent, backup kept)." }, /*#__PURE__*/
    React.createElement(StSwitch, {
      checked: stMcpIsActive,
      onChange: stMcpToggle,
      disabled: mcpActivating || mcpStatus === 'checking' }
    )
    ), /*#__PURE__*/
    React.createElement(Row, { label: "Manual setup", hint: "Paste into ~/.claude/.mcp.json (or cursor/codex equivalent) to configure manually.", last: true }, /*#__PURE__*/
    React.createElement(StButton, {
      variant: "ghost",
      size: "sm",
      icon: copiedKey === 'mcp-json' ? 'check' : 'copy',
      onClick: () => stCopy(ST_MCP_JSON, 'mcp-json') },

    copiedKey === 'mcp-json' ? 'Copied JSON' : 'Copy JSON'
    )
    ), /*#__PURE__*/
    React.createElement("div", { style: { padding: '10px 16px 14px', background: 'var(--surface-inset)', borderTop: '1px solid var(--divider)' } }, /*#__PURE__*/
    React.createElement("pre", { style: { margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' } }, ST_MCP_JSON)
    )
    ), /*#__PURE__*/


    React.createElement(Section, { icon: "sparkles", title: "AI provider" }, /*#__PURE__*/
    React.createElement("div", { style: { padding: '4px 16px 10px', fontSize: 12, color: 'var(--text-subtle)', lineHeight: 1.5 } }, "Lore enriches your knowledge graph by inferring relationships from your notes. Pick how it runs \u2014 your existing Codex/Claude subscription (no key), or your own API key."


    ),
    ST_PROVIDERS.map((p, i) => {
      const avail = providers ? !!providers[p.id] : null; // null while loading
      const selected = llmProvider === p.id;
      return (/*#__PURE__*/
        React.createElement(Row, { key: p.id, label: p.label, hint: p.hint, last: i === ST_PROVIDERS.length - 1 }, /*#__PURE__*/
        React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8 } }, /*#__PURE__*/
        React.createElement(StBadge, { tone: avail === null ? 'neutral' : avail ? 'success' : 'neutral', dot: true },
        avail === null ? 'checking…' : avail ? 'detected' : 'not found'
        ), /*#__PURE__*/
        React.createElement(StButton, { variant: selected ? 'primary' : 'secondary', size: "sm", onClick: () => stPickProvider(p.id) },
        selected ? 'Selected' : 'Use'
        )
        )
        ));

    }),
    (() => {
      const sel = ST_PROVIDERS.find((p) => p.id === llmProvider);
      const avail = providers ? !!providers[llmProvider] : null;
      return (/*#__PURE__*/
        React.createElement("div", { style: { padding: '10px 16px 14px', background: 'var(--surface-inset)', borderTop: '1px solid var(--divider)' } },
        avail === false && sel && /*#__PURE__*/
        React.createElement("div", { style: { fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 } },
        sel.label, " isn\u2019t set up yet. Install / sign in:", /*#__PURE__*/
        React.createElement("pre", { style: { margin: '6px 0 0', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'pre-wrap' } }, sel.install)
        ), /*#__PURE__*/

        React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        enrichRunning && /*#__PURE__*/React.createElement(StIcon, { name: "loader", size: 14, style: { color: 'var(--brand-fg)', animation: 'lore-pulse 1s linear infinite' } }), /*#__PURE__*/
        React.createElement(StButton, { variant: "secondary", size: "sm", icon: "sparkles", onClick: stRunEnrich, disabled: enrichRunning || !identityReady || avail === false },
        enrichRunning ? 'Enriching…' : 'Enrich 8 notes (test)'
        ),
        enrichResult && !enrichResult.error && /*#__PURE__*/
        React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-muted)' } }, "+",
        enrichResult.edges ?? 0, " edges from ", enrichResult.notesProcessed ?? 0, " notes"
        ),

        enrichResult && enrichResult.error && /*#__PURE__*/
        React.createElement("span", { style: { fontSize: 11.5, color: 'var(--clay-400)' } }, stText(enrichResult.error, 'error'))

        )
        ));

    })()
    ), /*#__PURE__*/


    React.createElement(Section, { icon: "refresh-ccw", title: "Data upkeep" }, /*#__PURE__*/
    React.createElement(Row, { label: "Auto-upkeep", hint: identityReady ? 'Lore folds date/session notes into topic nodes automatically after each ingest.' : 'Configure tenant and scope before enabling upkeep.' }, /*#__PURE__*/
    React.createElement(StSwitch, { checked: upkeepAuto && identityReady, onChange: stSetUpkeepAuto, disabled: !identityReady })
    ), /*#__PURE__*/
    React.createElement(Row, { label: "Rebuild now", hint: "Detect ephemeral notes (daily, session, sync) and consolidate them into durable topic nodes.", last: true }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8 } },
    upkeepRunning && /*#__PURE__*/
    React.createElement(StIcon, { name: "loader", size: 14, style: { color: 'var(--brand-fg)', animation: 'lore-pulse 1s linear infinite' } }), /*#__PURE__*/

    React.createElement(StButton, {
      variant: "secondary",
      size: "sm",
      icon: "zap",
      onClick: stRunUpkeep,
      disabled: upkeepRunning || !identityReady },

    upkeepRunning ? 'Running…' : 'Rebuild now'
    )
    )
    ),
    (upkeepResult || upkeepStatusLine) && /*#__PURE__*/
    React.createElement("div", { style: { padding: '10px 16px', borderTop: '1px solid var(--divider)', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6 } },
    upkeepResult && !upkeepResult.error && /*#__PURE__*/
    React.createElement("span", null, "Folded ", /*#__PURE__*/
    React.createElement("strong", null, upkeepResult.dateNotes ?? '?'), " date notes into", ' ', /*#__PURE__*/
    React.createElement("strong", null, upkeepResult.topics ?? '?'), " topics",
    upkeepResult.folded != null ? ` (${upkeepResult.folded} merged)` : '', "."
    ),

    upkeepResult && upkeepResult.error && /*#__PURE__*/
    React.createElement("span", { style: { color: 'var(--clay-400)' } }, "Error: ", stText(upkeepResult.error, 'Unknown error')),

    !upkeepResult && upkeepStatusLine && /*#__PURE__*/
    React.createElement("span", null, upkeepStatusLine)

    )

    ),

    s.account && s.account.name && /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', justifyContent: 'flex-end', gap: 10 } }, /*#__PURE__*/
    React.createElement(StButton, { variant: "danger", icon: "log-out" }, "Sign out")
    )

    )
    ));

}

window.LoreSettingsView = SettingsView;