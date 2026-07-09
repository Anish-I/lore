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
  try { return JSON.stringify(value); } catch { return fallback; }
}

// "provider · model" label for the /config/retrieval snapshot ({error}/null aware).
function stRetrievalModel(retrieval, key) {
  if (retrieval === null) return 'checking…';
  if (retrieval.error) return 'memory engine is starting…';
  const m = retrieval[key];
  if (!m || !m.model) return 'unknown';
  return m.provider ? `${m.provider} · ${m.model}` : String(m.model);
}

function stAgo(iso) {
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return 'just now';
  const s = Math.max(0, Math.round((Date.now() - d) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function SettingsView({ settings, config, scopeOptions = [], onConfig, onOpenSetup }) {
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

  // Google account / auth state
  const [authUser, setAuthUser] = React.useState(null);   // {user_id, email, scopes} | null
  const [authBusy, setAuthBusy] = React.useState(false);
  const [authError, setAuthError] = React.useState('');

  // Indexing & recall state (real wiring: config flag + backend /config/retrieval)
  const [autoIndexOnSave, setAutoIndexOnSave] = React.useState(true); // default ON; explicit false disables
  // Advanced mode (default OFF) — the developer surfaces live behind it. Replaces
  // the old simpleMode flag entirely (cfg.simpleMode is ignored; the default
  // experience IS the simple one now).
  const [advancedMode, setAdvancedMode] = React.useState(false);
  const [backupEnabled, setBackupEnabled] = React.useState(false);
  const [backupDir, setBackupDir] = React.useState('');
  const [backupStatus, setBackupStatus] = React.useState(null);
  const [backupBusy, setBackupBusy] = React.useState(false);
  const [auditOpen, setAuditOpen] = React.useState(false);
  const [auditEntries, setAuditEntries] = React.useState(null);
  const [autoFileObvious, setAutoFileObvious] = React.useState(false); // default OFF; only explicit true enables
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
  // Automatic organization knobs: propose Sections when N+ related notes cluster.
  const [autoClassify, setAutoClassify] = React.useState(!!(config && config.autoClassify));
  const [sectionThreshold, setSectionThreshold] = React.useState((config && config.sectionThreshold) || 5);
  const [lastTidied, setLastTidied] = React.useState((config && config.upkeepLastRun) || null);
  // Folder read-scope: which top-level folders Lore is allowed to read/index.
  const [folders, setFolders] = React.useState(null);   // [names] | null (loading)
  const [excludes, setExcludes] = React.useState((config && config.excludes) || []);

  // AI provider (graph enrichment): codex sub / claude sub / byok
  const [providers, setProviders] = React.useState(null); // { codex, claude, byok } | null
  const [llmProvider, setLlmProvider] = React.useState((config && config.llmProvider) || 'codex');
  const [enrichRunning, setEnrichRunning] = React.useState(false);
  const [enrichResult, setEnrichResult] = React.useState(null);

  React.useEffect(() => {
    if (window.lore && window.lore.mcp && window.lore.mcp.detect) {
      window.lore.mcp.detect()
        .then((st) => setMcpStatus(normalizeMcpStatus(st)))
        .catch(() => setMcpStatus('not configured'));
    } else {
      setMcpStatus('not configured');
    }
    if (window.lore && window.lore.enrich && window.lore.enrich.providers) {
      window.lore.enrich.providers().then((p) => setProviders(p || null)).catch(() => {});
    }
    if (window.lore && window.lore.upkeep && window.lore.upkeep.status) {
      window.lore.upkeep.status()
        .then((st) => {
          // Only surface a friendly line — never dump the raw status object (a
          // bare {lastRun:null} used to render as JSON). The "Last tidied" row
          // below carries the timestamp.
          if (st && st.lastRun) setUpkeepStatusLine(`Last run ${stAgo(st.lastRun) || ''}.`);
          else if (st && st.error) setUpkeepStatusLine('');
        })
        .catch(() => {});
    }
    if (window.lore && window.lore.config && window.lore.config.get) {
      window.lore.config.get()
        .then((c) => {
          setCfg(c || null);
          setDefScope((c && c.scope) || '');
          setAutoIndexOnSave(!(c && c.autoIndexOnSave === false));
          setAdvancedMode(!!(c && c.advancedMode === true));
          setBackupEnabled(!!(c && c.backupEnabled));
          setBackupDir((c && c.backupDir) || '');
          setAutoFileObvious(!!(c && c.autoFileObvious === true));
          setUpkeepAuto(!(c && c.upkeepAuto === false));
          setAutoClassify(!!(c && c.autoClassify === true));
          setSectionThreshold((c && c.sectionThreshold) || 5);
          setLastTidied((c && c.upkeepLastRun) || null);
          setExcludes((c && c.excludes) || []);
          // Load the vault's top-level folders for the read-scope picker.
          const root = c && Array.isArray(c.roots) && c.roots[0];
          if (root && window.lore && window.lore.readTree) {
            window.lore.readTree(root)
              .then((t) => setFolders((t && t.tree ? t.tree : []).filter((n) => n.kind === 'folder').map((n) => n.name).sort((a, b) => a.localeCompare(b))))
              .catch(() => setFolders([]));
          } else setFolders([]);
        })
        .catch(() => {});
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
    if (window.lore && window.lore.backup && window.lore.backup.status) {
      window.lore.backup.status().then((b) => setBackupStatus(b || null)).catch(() => {});
    }
  }, []);

  const stSignIn = async () => {
    if (!window.lore || !window.lore.auth) return;
    setAuthBusy(true); setAuthError('');
    try {
      const r = await window.lore.auth.login();
      if (r && r.ok) setAuthUser({ user_id: r.user_id, email: r.email, scopes: r.scopes });
      else setAuthError((r && (r.detail || r.reason)) || 'sign-in failed');
    } catch (e) { setAuthError(String((e && e.message) || e)); }
    setAuthBusy(false);
  };

  const stSignOut = async () => {
    if (window.lore && window.lore.auth) { try { await window.lore.auth.logout(); } catch { /* ignore */ } }
    setAuthUser(null);
  };

  React.useEffect(() => {
    setCfg(config || null);
    setDefScope((config && config.scope) || '');
    if (config) {
      setAutoIndexOnSave(config.autoIndexOnSave !== false);
      setAdvancedMode(config.advancedMode === true);
      setAutoFileObvious(config.autoFileObvious === true);
      setUpkeepAuto(config.upkeepAuto !== false);
    }
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
        window.lore.upkeep.status().then((st) => { if (st) setUpkeepStatusLine(stText(st, '')); }).catch(() => {});
      }
    } catch (e) {
      setUpkeepResult({ error: String((e && e.message) || e) });
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

  const stSetAutoFile = (v) => {
    setAutoFileObvious(v);
    if (window.lore && window.lore.config && window.lore.config.set) {
      window.lore.config.set({ autoFileObvious: !!v }).catch(() => {});
    }
  };

  const stSetAutoClassify = (v) => {
    setAutoClassify(v);
    if (window.lore && window.lore.config && window.lore.config.set) {
      window.lore.config.set({ autoClassify: !!v }).catch(() => {});
    }
  };

  const stSetSectionThreshold = (v) => {
    const n = Math.max(3, Math.min(20, Number(v) || 5));
    setSectionThreshold(n);
    if (window.lore && window.lore.config && window.lore.config.set) {
      window.lore.config.set({ sectionThreshold: n }).catch(() => {});
    }
  };

  // Toggle whether Lore reads a given top-level folder (persists cfg.excludes).
  const stToggleFolderRead = (name) => {
    setExcludes((prev) => {
      const next = prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name];
      if (window.lore && window.lore.config && window.lore.config.set) {
        window.lore.config.set({ excludes: next }).catch(() => {});
      }
      return next;
    });
  };

  const stSetDefaultScope = (id) => {
    setDefScope(id);
    if (window.lore && window.lore.config && window.lore.config.set) {
      // cfg.scope is what the capture hooks read — persist it so new notes land here.
      window.lore.config.set({ scope: id }).then((next) => { if (onConfig) onConfig(next); }).catch(() => {});
    }
  };

  const stSetAdvancedMode = (v) => {
    setAdvancedMode(v);
    if (window.lore && window.lore.config && window.lore.config.set) {
      // onConfig re-renders the app with the new config so the rail updates live.
      window.lore.config.set({ advancedMode: !!v }).then((next) => { if (onConfig) onConfig(next); }).catch(() => {});
    }
  };

  const stSetBackupEnabled = (v) => {
    setBackupEnabled(v);
    if (window.lore && window.lore.config && window.lore.config.set) {
      window.lore.config.set({ backupEnabled: !!v }).then((next) => { if (onConfig) onConfig(next); }).catch(() => {});
    }
    if (v && backupDir) stRunBackup();
  };
  const stPickBackupDir = async () => {
    if (!window.lore || !window.lore.backup) return;
    const r = await window.lore.backup.pickDir();
    if (r && r.ok && r.dir) {
      setBackupDir(r.dir);
      if (window.lore.config && window.lore.config.set) {
        const next = await window.lore.config.set({ backupDir: r.dir }); if (onConfig) onConfig(next);
      }
      stRunBackup();
    }
  };
  const stRunBackup = async () => {
    if (!window.lore || !window.lore.backup) return;
    setBackupBusy(true);
    try { await window.lore.backup.run(); const b = await window.lore.backup.status(); setBackupStatus(b || null); }
    finally { setBackupBusy(false); }
  };

  const stLoadAudit = async () => {
    if (!window.lore || !window.lore.queryLog || !cfg || !cfg.tenant) { setAuditEntries([]); return; }
    try { const r = await window.lore.queryLog.list(cfg.tenant, 50); setAuditEntries((r && r.entries) || []); }
    catch { setAuditEntries([]); }
  };
  const stToggleAudit = () => {
    setAuditOpen((o) => { const next = !o; if (next) stLoadAudit(); return next; });
  };
  const stPurgeAudit = async () => {
    if (!window.lore || !window.lore.queryLog || !cfg || !cfg.tenant) return;
    await window.lore.queryLog.purge(cfg.tenant);
    setAuditEntries([]);
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
      setImportResult({ ok: false, reason: String((e && e.message) || e) });
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
      setCliResult({ ok: false, reason: String((e && e.message) || e) });
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
    if (!cfg || !cfg.tenant) { setEnrichResult({ error: 'tenant is not configured' }); return; }
    setEnrichRunning(true); setEnrichResult(null);
    try {
      const res = await window.lore.enrich.run({ tenant: cfg.tenant, limit: 8, provider: llmProvider });
      setEnrichResult(res || {});
    } catch (e) { setEnrichResult({ error: String((e && e.message) || e) }); }
    setEnrichRunning(false);
  };

  const ST_PROVIDERS = [
    { id: 'codex',  label: 'Codex subscription',  hint: 'Uses your Codex CLI login. No API key.', install: 'npm i -g @openai/codex   # then: codex login' },
    { id: 'claude', label: 'Claude subscription',  hint: 'Uses your Claude Code CLI login. No API key.', install: 'npm i -g @anthropic-ai/claude-code   # then: claude (sign in)' },
    { id: 'byok',   label: 'Bring your own key',   hint: 'Any OpenAI-compatible key (Together default).', install: 'set LORE_LLM_API_KEY=...   (optionally LORE_LLM_BASE_URL / LORE_LLM_MODEL)' },
  ];

  const ST_CLI_INSTALL = 'pip install -e ./core';
  const ST_CLI_SAMPLE = `lore ask "<question>" --scope ${(cfg && cfg.scope) || '<scope>'} --tenant ${(cfg && cfg.tenant) || '<tenant>'}`;
  const ST_MCP_JSON = '{\n  "mcpServers": {\n    "lore": {\n      "command": "python",\n      "args": ["-m", "lore.mcp_server"],\n      "cwd": "<path-to-core>"\n    }\n  }\n}';

  const stMcpIsActive = mcpStatus === 'installed';
  const stMcpTone = mcpStatus === 'installed' ? 'success' : mcpStatus === 'detected' ? 'info' : 'neutral';
  const stMcpLabel = mcpStatus === 'checking' ? 'checking…' : stText(mcpStatus, 'not configured');
  const identityReady = Boolean(cfg && cfg.tenant && cfg.scope);
  const ownerLabel = stText(cfg && cfg.owner, 'No identity configured');
  const tenantLabel = stText(cfg && cfg.tenant, 'No tenant');
  const scopeLabel = stText(cfg && cfg.scope, '');
  const displayNone = (v) => stText(v, 'None');

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
          <Row label="Google sign-in" hint={authUser ? `Signed in — ${(authUser.scopes && authUser.scopes.length) || 0} team space(s)` : 'Sign in to sync team/enterprise notes and ask across your team.'}>
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
          <Row label="New notes are saved as" hint="The permission every newly captured note gets — this is what your AI hooks write with. Change it per-note anytime from the editor's visibility control.">
            <div style={{ display: 'flex', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 2, gap: 2 }}>
              {[['private', 'Private'], ['team', 'Team'], ['company', 'Company']].map(([id, label]) => {
                const on = (defScope === id) || (id === 'private' && !['team', 'company', 'enterprise'].includes(defScope));
                return (
                  <button key={id} onClick={() => stSetDefaultScope(id)} style={{
                    border: 'none', cursor: 'pointer', padding: '4px 11px', borderRadius: 'var(--radius-xs)',
                    background: on ? 'var(--surface-raised)' : 'transparent',
                    color: on ? 'var(--brand-fg)' : 'var(--text-subtle)',
                    fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: on ? 600 : 400,
                  }}>{label}</button>
                );
              })}
            </div>
          </Row>
          <Row label="Advanced mode" hint="Show the developer surfaces — Connections (AI-tool capture), MCP, CLI, retrieval model internals, and the wizard store. Off by default; everything keeps working underneath.">
            <StSwitch checked={advancedMode} onChange={stSetAdvancedMode} />
          </Row>
        </Section>

        <Section icon="shield-check" title="Backup">
          <Row label="Back up my library" hint="Continuously mirror your notes into a folder you choose — point it at your OneDrive or SharePoint-synced folder and Microsoft syncs it off-device. Your files literally appear there; nothing is uploaded by Lore itself.">
            <StSwitch checked={backupEnabled} onChange={stSetBackupEnabled} />
          </Row>
          {backupEnabled && (
            <Row label="Backup folder" hint={backupDir || 'No folder chosen yet.'}>
              <StButton variant="secondary" size="sm" onClick={stPickBackupDir}>{backupDir ? 'Change…' : 'Choose folder…'}</StButton>
            </Row>
          )}
          {backupEnabled && backupDir && (
            <Row label="Status" last>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: backupStatus && backupStatus.ok === false ? 'var(--clay-400)' : 'var(--jade-400)' }}>
                  {backupStatus && backupStatus.ok === false
                    ? `⚠ ${backupStatus.error || 'backup failed'}`
                    : backupStatus && backupStatus.lastRun
                      ? `✓ ${stAgo(backupStatus.lastRun)} · ${backupStatus.count || 0} notes`
                      : 'not run yet'}
                </span>
                <StButton variant="secondary" size="sm" onClick={stRunBackup} disabled={backupBusy}>{backupBusy ? 'Backing up…' : 'Back up now'}</StButton>
              </div>
            </Row>
          )}
        </Section>

        <Section icon="shield" title="Security">
          <Row label="On-device lock" hint="Lore's local backend requires a per-install token, so no other app on this machine can read your knowledge base. Managed automatically." last={!auditOpen}>
            <StBadge tone="success" dot>locked</StBadge>
          </Row>
          <Row label="Access log" hint="Every search and question is recorded (as a hash — never the raw text) so you can audit what's been queried.">
            <StButton variant="secondary" size="sm" onClick={stToggleAudit}>{auditOpen ? 'Hide' : 'View log'}</StButton>
          </Row>
          {auditOpen && (
            <div style={{ padding: '4px 16px 14px' }}>
              {(!auditEntries || !auditEntries.length) ? (
                <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '6px 0' }}>No queries recorded yet.</div>
              ) : (
                <React.Fragment>
                  <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--divider)', borderRadius: 'var(--radius-sm)' }}>
                    {auditEntries.map((e, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderBottom: i < auditEntries.length - 1 ? '1px solid var(--divider)' : 'none', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
                        <span style={{ color: 'var(--text-faint)', width: 132, flexShrink: 0 }}>{stAgo(e.ts)}</span>
                        <StBadge tone="neutral">{e.endpoint}</StBadge>
                        <span style={{ color: 'var(--text-subtle)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(e.scopes || []).join(', ')}</span>
                        <span style={{ color: 'var(--text-faint)' }}>{e.hits} hits</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                    <StButton variant="secondary" size="sm" onClick={stPurgeAudit}>Clear log</StButton>
                  </div>
                </React.Fragment>
              )}
            </div>
          )}
        </Section>

        <Section icon="cpu" title="Remembering">
          <Row label="Remember changes automatically" hint="Refresh a note's memory automatically when its file changes on disk. Off: refresh manually (right-click a note → Refresh).">
            <StSwitch checked={autoIndexOnSave} onChange={stSetAutoIndex} />
          </Row>
          <Row label="Auto-file obvious notes" hint="While tidying, a note that unambiguously belongs to one of your existing sections is moved into that folder automatically — undoable, logged to the library worklog. Off (default): every move stays a suggestion you approve." last>
            <StSwitch checked={autoFileObvious} onChange={stSetAutoFile} />
          </Row>
        </Section>

        <Section icon="refresh-cw" title="Sync & storage">
          <Row label="Provider">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>{displayNone(s.sync.provider)}</span>
          </Row>
          <Row label="Encryption" hint="Libraries are encrypted at rest.">
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

        {/* ── Advanced (developer surfaces) — visible only with Advanced mode ON ── */}
        {advancedMode && (
        <React.Fragment>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '26px 0 12px' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Advanced</span>
          <div style={{ flex: 1, height: 1, background: 'var(--divider)' }} />
        </div>

        {/* ── Retrieval models ── */}
        <Section icon="cpu" title="Retrieval models">
          <Row label="Contextual retrieval" hint="Every chunk is stored with a situating context sentence for better recall. Built into the pipeline.">
            <StBadge tone={retrieval === null ? 'neutral' : retrieval.error ? 'neutral' : 'success'} dot={!!(retrieval && !retrieval.error)}>
              {retrieval === null ? 'checking…' : retrieval.error ? 'memory engine is starting…' : 'enabled'}
            </StBadge>
          </Row>
          <Row label="Embedding model">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>{stRetrievalModel(retrieval, 'embeddingModel')}</span>
          </Row>
          <Row label="Reranker">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>{stRetrievalModel(retrieval, 'reranker')}</span>
          </Row>
          <Row label="Local fallback" hint="On-device fastembed models. Always used for captures and imports; primary for search when no cloud key is set.">
            {(() => {
              const lf = retrieval && !retrieval.error ? retrieval.localFallback : null;
              const tone = !lf ? 'neutral' : lf.active ? 'success' : lf.available ? 'info' : 'neutral';
              const label = retrieval === null ? 'checking…' : retrieval.error ? 'memory engine is starting…'
                : lf && lf.active ? 'active' : lf && lf.available ? 'available' : 'not available';
              return <StBadge tone={tone} dot={!!(lf && lf.active)}>{label}</StBadge>;
            })()}
          </Row>
          <Row label="Import config" hint="Apply retrieval and tidying settings from a JSON file — another Lore install or a shared team config." last>
            <StButton variant="secondary" size="sm" icon="folder-open" onClick={stImportConfig}>Import…</StButton>
          </Row>
          {importResult && (
            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--divider)', fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.6, color: importResult.ok ? 'var(--text-muted)' : 'var(--clay-400)' }}>
              {importResult.ok
                ? `Applied: ${Object.keys(importResult.applied || {}).join(', ')}${(importResult.ignored || []).length ? ` · ignored: ${importResult.ignored.join(', ')}` : ''}`
                : `Import failed: ${stText(importResult.reason, 'unknown error')}`}
            </div>
          )}
        </Section>

        {/* ── CLI ── */}
        <Section icon="terminal" title="CLI">
          <Row label="Lore CLI" hint={cliStatus && cliStatus.installed ? `Installed at ${cliStatus.path}` : 'One click puts the `lore` command on your PATH — no sudo, no venv activation.'}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StBadge tone={cliStatus === null ? 'neutral' : cliStatus.installed ? 'success' : 'neutral'} dot={!!(cliStatus && cliStatus.installed)}>
                {cliStatus === null ? 'checking…' : cliStatus.installed ? 'installed' : 'not installed'}
              </StBadge>
              <StButton variant="secondary" size="sm" icon="download" disabled={cliInstalling} onClick={stInstallCli}>
                {cliInstalling ? 'Installing…' : cliStatus && cliStatus.installed ? 'Reinstall' : 'Install'}
              </StButton>
            </div>
          </Row>
          {(cliResult || (cliStatus && cliStatus.installed && !cliStatus.onPath)) && (
            <div style={{ padding: '0 16px 10px', fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.6, color: cliResult && cliResult.ok === false ? 'var(--clay-400)' : 'var(--text-muted)' }}>
              {cliResult && cliResult.ok === false && <div>Install failed: {stText(cliResult.reason, 'unknown error')}</div>}
              {cliResult && cliResult.ok && <div>Installed ({cliResult.mechanism}) at {cliResult.path}</div>}
              {((cliResult && cliResult.ok && !cliResult.onPath) || (!cliResult && cliStatus && !cliStatus.onPath)) && (
                <div>That folder isn’t on your PATH yet — run: <code>{(cliResult && cliResult.hint) || (cliStatus && cliStatus.hint) || ''}</code></div>
              )}
            </div>
          )}
          <Row label="Manual install" hint="Or run once in your terminal to make `lore` available globally.">
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

        {/* ── AI provider (graph enrichment) ── */}
        <Section icon="sparkles" title="AI provider">
          <div style={{ padding: '4px 16px 10px', fontSize: 12, color: 'var(--text-subtle)', lineHeight: 1.5 }}>
            Lore enriches your knowledge graph by inferring relationships from your notes. Pick how it runs —
            your existing Codex/Claude subscription (no key), or your own API key.
          </div>
          {ST_PROVIDERS.map((p, i) => {
            const avail = providers ? !!providers[p.id] : null;   // null while loading
            const selected = llmProvider === p.id;
            return (
              <Row key={p.id} label={p.label} hint={p.hint} last={i === ST_PROVIDERS.length - 1}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <StBadge tone={avail === null ? 'neutral' : avail ? 'success' : 'neutral'} dot>
                    {avail === null ? 'checking…' : avail ? 'detected' : 'not found'}
                  </StBadge>
                  <StButton variant={selected ? 'primary' : 'secondary'} size="sm" onClick={() => stPickProvider(p.id)}>
                    {selected ? 'Selected' : 'Use'}
                  </StButton>
                </div>
              </Row>
            );
          })}
          {(() => {
            const sel = ST_PROVIDERS.find((p) => p.id === llmProvider);
            const avail = providers ? !!providers[llmProvider] : null;
            return (
              <div style={{ padding: '10px 16px 14px', background: 'var(--surface-inset)', borderTop: '1px solid var(--divider)' }}>
                {avail === false && sel && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                    {sel.label} isn’t set up yet. Install / sign in:
                    <pre style={{ margin: '6px 0 0', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{sel.install}</pre>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {enrichRunning && <StIcon name="loader" size={14} style={{ color: 'var(--brand-fg)', animation: 'lore-pulse 1s linear infinite' }} />}
                  <StButton variant="secondary" size="sm" icon="sparkles" onClick={stRunEnrich} disabled={enrichRunning || !identityReady || avail === false}>
                    {enrichRunning ? 'Enriching…' : 'Enrich 8 notes (test)'}
                  </StButton>
                  {enrichResult && !enrichResult.error && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-muted)' }}>
                      +{enrichResult.edges ?? 0} edges from {enrichResult.notesProcessed ?? 0} notes
                    </span>
                  )}
                  {enrichResult && enrichResult.error && (
                    <span style={{ fontSize: 11.5, color: 'var(--clay-400)' }}>{stText(enrichResult.error, 'error')}</span>
                  )}
                </div>
              </div>
            );
          })()}
        </Section>
        </React.Fragment>
        )}

        {/* ── Tidy up & auto-organize ── */}
        <Section icon="refresh-ccw" title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            Tidy up & auto-organize
            {window.LoreHelpHint && <window.LoreHelpHint tip="Lore keeps your library tidy on its own: it folds throwaway date/session notes into durable topic pages, and when enough pages cluster around one subject it proposes grouping them into a Section (a folder/column). You stay in control — proposals only apply when you accept them." />}
          </span>
        }>
          <Row label="Tidy automatically" hint={identityReady ? 'Lore folds date/session notes into durable topic notes automatically after each capture.' : 'Finish setup before enabling automatic tidying.'}>
            <StSwitch checked={upkeepAuto && identityReady} onChange={stSetUpkeepAuto} disabled={!identityReady} />
          </Row>
          <Row label={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              Suggest Sections automatically
              {window.LoreHelpHint && <window.LoreHelpHint tip="When on, Lore watches for pages that cluster around the same subject and proposes a Section (a folder/column) to group them. Nothing moves until you accept the suggestion." />}
            </span>
          } hint="Propose grouping related pages into Sections (columns) as your library grows.">
            <StSwitch checked={autoClassify} onChange={stSetAutoClassify} disabled={!identityReady} />
          </Row>
          <Row label={`Group into a Section after ${sectionThreshold} related pages`}
            hint="How many pages must cluster around a subject before Lore proposes a Section for them.">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 190 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>3</span>
              <input type="range" min={3} max={20} step={1} value={sectionThreshold}
                onChange={(e) => stSetSectionThreshold(e.target.value)} disabled={!identityReady}
                style={{ flex: 1, accentColor: 'var(--brand-fg)', cursor: identityReady ? 'pointer' : 'not-allowed' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>20</span>
              <span style={{ minWidth: 20, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 600, color: 'var(--brand-fg)' }}>{sectionThreshold}</span>
            </div>
          </Row>
          {lastTidied && (
            <Row label="Last tidied" hint="When Lore last folded notes and refreshed the library.">
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>{stAgo(lastTidied) || '—'}</span>
            </Row>
          )}
          <Row label="Tidy up now" hint="Detect ephemeral notes (daily, session, sync) and consolidate them into durable topic notes." last>
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
                {upkeepRunning ? 'Tidying…' : 'Tidy up now'}
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
                <span style={{ color: 'var(--clay-400)' }}>Error: {stText(upkeepResult.error, 'Unknown error')}</span>
              )}
              {!upkeepResult && upkeepStatusLine && (
                <span>{upkeepStatusLine}</span>
              )}
            </div>
          )}
        </Section>

        {/* ── Folders Lore reads ── */}
        <Section icon="folder-tree" title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            Folders Lore reads
            {window.LoreHelpHint && <window.LoreHelpHint tip="Choose which top-level folders in your library Lore is allowed to read and index. Turn one off to keep it private from search, Ask, and the graph. Changes apply on the next Refresh (or restart)." />}
          </span>
        }>
          {folders === null && (
            <div style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)' }}>Loading folders…</div>
          )}
          {folders && folders.length === 0 && (
            <div style={{ padding: '12px 16px', fontSize: 12.5, color: 'var(--text-subtle)' }}>No sub-folders yet — everything in your library is read.</div>
          )}
          {folders && folders.map((name, i) => (
            <Row key={name} label={name}
              hint={excludes.includes(name) ? 'Hidden from Lore — not read, searched, or in the graph.' : 'Lore reads and indexes this folder.'}
              last={i === folders.length - 1}>
              <StSwitch checked={!excludes.includes(name)} onChange={() => stToggleFolderRead(name)} />
            </Row>
          ))}
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
