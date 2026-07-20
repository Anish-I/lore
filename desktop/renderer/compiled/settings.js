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

function stInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stFmtInt(value) {
  return stInt(value, 0).toLocaleString();
}

function stLearnTodayRuns(status) {
  return stInt(
    status && (
    status.today_runs ?? status.todays_runs ?? status.runs_today ?? status.todayRuns ?? (
    status.today && (status.today.runs ?? status.today.count))),

    0
  );
}

function stLearnEstTokens(status) {
  return stInt(
    status && (
    status.est_tokens ?? status.estimated_tokens ?? status.tokens_est ?? status.today_est_tokens ?? (
    status.today && (status.today.est_tokens ?? status.today.estimated_tokens))),

    0
  );
}

function stLearnRecentRuns(status) {
  if (!status || typeof status !== 'object') return [];
  const runs = status.runs || status.recent_runs || status.recentRuns || status.last_runs;
  return Array.isArray(runs) ? runs : [];
}

function stLearnEnabled(status) {
  if (!status || typeof status !== 'object') return null;
  if (typeof status.enabled === 'boolean') return status.enabled;
  const raw = status.status || status.state || status.mode;
  if (typeof raw !== 'string') return null;
  if (/disabled|off|unavailable/i.test(raw)) return false;
  if (/enabled|ready|active|ok|on/i.test(raw)) return true;
  return null;
}

function stLearnPendingSkills(pending) {
  if (!pending || typeof pending !== 'object') return [];
  const skills = pending.skills || pending.pending || pending.items || pending.results;
  return Array.isArray(skills) ? skills : [];
}

function stLearnPendingCount(status, pending) {
  if (status && typeof status === 'object') {
    const n = status.pending_count ?? status.pendingCount ?? status.skills_pending;
    if (Number.isFinite(Number(n))) return Number(n);
  }
  return stLearnPendingSkills(pending).length;
}

function stLearnBudgetNotice(status) {
  const recent = stLearnRecentRuns(status);
  const budgetRun = recent.find((run) => String(run && (run.skip_reason || run.skipReason || '')).toLowerCase() === 'budget');
  if (budgetRun) return 'Daily Learn budget reached; new reviews are being skipped until tomorrow.';
  const msg = status && (status.notice || status.warning || status.message);
  return typeof msg === 'string' ? msg : '';
}

function stLearnDiffText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const direct = payload.diff || payload.patch || payload.unified_diff || payload.unifiedDiff;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const pendingBody = payload.pending_body || payload.pendingBody || payload.body || payload.proposed_body || payload.proposedBody;
  const currentBody = payload.current_body || payload.currentBody || payload.active_body || payload.activeBody;
  if (typeof pendingBody === 'string' && typeof currentBody === 'string') {
    return `--- current\n${currentBody}\n\n--- pending\n${pendingBody}`;
  }
  if (typeof pendingBody === 'string' && pendingBody.trim()) return pendingBody.trim();
  return '';
}

function stLearnSkillName(skill) {
  return String(skill && (skill.name || skill.id || skill.skill_name) || '').trim();
}

function stLearnSkillSummary(skill) {
  if (!skill || typeof skill !== 'object') return '';
  return String(skill.description || skill.summary || skill.reason || skill.note || '').trim();
}

function SettingsView({ settings, config, scopeOptions = [], onConfig, onOpenSetup }) {
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
  const [learnStatus, setLearnStatus] = React.useState(null);
  const [learnPending, setLearnPending] = React.useState(null);
  const [learnError, setLearnError] = React.useState('');
  const [learnPendingOpen, setLearnPendingOpen] = React.useState(false);
  const [learnSelected, setLearnSelected] = React.useState('');
  const [learnDiffs, setLearnDiffs] = React.useState({});
  const [learnDiffLoading, setLearnDiffLoading] = React.useState('');
  const [learnActionBusy, setLearnActionBusy] = React.useState('');
  const [personalDocs, setPersonalDocs] = React.useState([]);
  const [personalDrafts, setPersonalDrafts] = React.useState({ user: '', memory: '' });
  const [personalBusy, setPersonalBusy] = React.useState('');
  const [personalError, setPersonalError] = React.useState('');
  const [personalNotice, setPersonalNotice] = React.useState('');
  const [personalHistory, setPersonalHistory] = React.useState({ kind: '', versions: [] });
  const [pastOpen, setPastOpen] = React.useState(false);
  const [pastSessions, setPastSessions] = React.useState([]);
  const [pastQuery, setPastQuery] = React.useState('');
  const [pastBusy, setPastBusy] = React.useState(false);

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
  // Auto-apply (default ON): detected Sections create their folder and move notes
  // immediately — no Enable click. Off = classic propose→review flow.
  const [autoApplySections, setAutoApplySections] = React.useState(!(config && config.autoApplySections === false));
  const [sectionThreshold, setSectionThreshold] = React.useState(config && config.sectionThreshold || 5);
  const [lastTidied, setLastTidied] = React.useState(config && config.upkeepLastRun || null);
  // Folder read-scope: which top-level folders Lore is allowed to read/index.
  const [folders, setFolders] = React.useState(null); // [names] | null (loading)
  const [excludes, setExcludes] = React.useState(config && config.excludes || []);

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
      then((st) => {
        // Only surface a friendly line — never dump the raw status object (a
        // bare {lastRun:null} used to render as JSON). The "Last tidied" row
        // below carries the timestamp.
        if (st && st.lastRun) setUpkeepStatusLine(`Last run ${stAgo(st.lastRun) || ''}.`);else
        if (st && st.error) setUpkeepStatusLine('');
      }).
      catch(() => {});
    }
    if (window.lore && window.lore.config && window.lore.config.get) {
      window.lore.config.get().
      then((c) => {
        setCfg(c || null);
        setDefScope(c && c.scope || '');
        setAutoIndexOnSave(!(c && c.autoIndexOnSave === false));
        setAdvancedMode(!!(c && c.advancedMode === true));
        setBackupEnabled(!!(c && c.backupEnabled));
        setBackupDir(c && c.backupDir || '');
        setAutoFileObvious(!!(c && c.autoFileObvious === true));
        setUpkeepAuto(!(c && c.upkeepAuto === false));
        setAutoClassify(!!(c && c.autoClassify === true));
        setAutoApplySections(!(c && c.autoApplySections === false));
        setSectionThreshold(c && c.sectionThreshold || 5);
        setLastTidied(c && c.upkeepLastRun || null);
        setExcludes(c && c.excludes || []);
        // Load the vault's top-level folders for the read-scope picker.
        const root = c && Array.isArray(c.roots) && c.roots[0];
        if (root && window.lore && window.lore.readTree) {
          window.lore.readTree(root).
          then((t) => setFolders((t && t.tree ? t.tree : []).filter((n) => n.kind === 'folder').map((n) => n.name).sort((a, b) => a.localeCompare(b)))).
          catch(() => setFolders([]));
        } else setFolders([]);
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
    if (window.lore && window.lore.backup && window.lore.backup.status) {
      window.lore.backup.status().then((b) => setBackupStatus(b || null)).catch(() => {});
    }
  }, []);

  const stRefreshLearn = async (tenantOverride) => {
    const tenant = tenantOverride || cfg && cfg.tenant || '';
    if (!tenant) {
      setLearnStatus(null);
      setLearnPending(null);
      setLearnError('');
      setLearnPendingOpen(false);
      setLearnSelected('');
      return;
    }
    if (!(window.lore && window.lore.learn)) {
      setLearnStatus(null);
      setLearnPending(null);
      setLearnError('Learn review bridge unavailable in this build.');
      setLearnPendingOpen(false);
      setLearnSelected('');
      return;
    }
    setLearnError('');
    const [statusRes, pendingRes] = await Promise.allSettled([
    window.lore.learn.status(tenant, cfg && cfg.scope),
    window.lore.learn.pending(tenant, cfg && cfg.scope)]
    );
    if (statusRes.status === 'fulfilled') setLearnStatus(statusRes.value || {});else
    setLearnStatus(null);
    if (pendingRes.status === 'fulfilled') {
      const nextPending = pendingRes.value || {};
      const nextSkills = stLearnPendingSkills(nextPending);
      setLearnPending(nextPending);
      if (learnSelected && !nextSkills.some((skill) => stLearnSkillName(skill) === learnSelected)) {
        setLearnSelected('');
      }
      if (!nextSkills.length) setLearnPendingOpen(false);
    } else {
      setLearnPending(null);
    }
    const fail = [statusRes, pendingRes].find((res) => res.status === 'rejected');
    if (fail) {
      const msg = fail.reason && (fail.reason.message || fail.reason.detail || String(fail.reason));
      setLearnError(msg || 'Lore Learn is unavailable.');
    }
  };

  const stRefreshPersonal = async (identity = cfg) => {
    if (!(identity && identity.tenant && identity.owner && identity.scope &&
    window.lore && window.lore.personalMemory)) {
      setPersonalDocs([]);
      setPersonalDrafts({ user: '', memory: '' });
      return;
    }
    setPersonalError('');
    try {
      const result = await window.lore.personalMemory.list(
        identity.tenant, identity.owner, identity.scope);
      const docs = result && result.documents || [];
      const drafts = { user: '', memory: '' };
      docs.forEach((doc) => {if (doc && drafts[doc.kind] !== undefined) drafts[doc.kind] = doc.text || '';});
      setPersonalDocs(docs);
      setPersonalDrafts(drafts);
    } catch (e) {
      setPersonalError(String(e && e.message || e));
    }
  };

  const stSavePersonal = async (kind) => {
    if (!(cfg && window.lore && window.lore.personalMemory)) return;
    setPersonalBusy(kind);
    setPersonalError('');
    setPersonalNotice('');
    try {
      await window.lore.personalMemory.replace(
        kind, personalDrafts[kind], cfg.tenant, cfg.owner, cfg.scope);
      await stRefreshPersonal(cfg);
      setPersonalHistory({ kind: '', versions: [] });
    } catch (e) {
      setPersonalError(String(e && e.message || e));
    }
    setPersonalBusy('');
  };

  const stUndoPersonal = async (kind) => {
    if (!(cfg && window.lore && window.lore.personalMemory)) return;
    setPersonalBusy(`undo:${kind}`);
    setPersonalError('');
    setPersonalNotice('');
    try {
      const result = await window.lore.personalMemory.history(
        kind, cfg.tenant, cfg.owner, cfg.scope);
      const versions = result && result.versions || [];
      if (versions.length < 2) throw new Error('No earlier version to restore.');
      await window.lore.personalMemory.rollback(
        kind, versions[1].version, cfg.tenant, cfg.owner, cfg.scope);
      await stRefreshPersonal(cfg);
      setPersonalHistory({ kind: '', versions: [] });
    } catch (e) {
      setPersonalError(String(e && e.message || e));
    }
    setPersonalBusy('');
  };

  const stForgetPersonal = async (kind) => {
    if (!(cfg && window.lore && window.lore.personalMemory)) return;
    setPersonalBusy(`forget:${kind}`);
    setPersonalError('');
    setPersonalNotice('');
    try {
      await window.lore.personalMemory.forget(
        kind, cfg.tenant, cfg.owner, cfg.scope);
      await stRefreshPersonal(cfg);
      setPersonalHistory({ kind: '', versions: [] });
    } catch (e) {
      setPersonalError(String(e && e.message || e));
    }
    setPersonalBusy('');
  };

  const stShowPersonalHistory = async (kind) => {
    if (!(cfg && window.lore && window.lore.personalMemory)) return;
    if (personalHistory.kind === kind) {
      setPersonalHistory({ kind: '', versions: [] });
      return;
    }
    setPersonalBusy(`history:${kind}`);
    setPersonalError('');
    setPersonalNotice('');
    try {
      const result = await window.lore.personalMemory.history(
        kind, cfg.tenant, cfg.owner, cfg.scope);
      setPersonalHistory({ kind, versions: result && result.versions || [] });
    } catch (e) {
      setPersonalError(String(e && e.message || e));
    }
    setPersonalBusy('');
  };

  const stRestorePersonal = async (kind, version) => {
    if (!(cfg && window.lore && window.lore.personalMemory)) return;
    setPersonalBusy(`restore:${kind}:${version}`);
    setPersonalError('');
    setPersonalNotice('');
    try {
      await window.lore.personalMemory.rollback(
        kind, version, cfg.tenant, cfg.owner, cfg.scope);
      await stRefreshPersonal(cfg);
      setPersonalHistory({ kind: '', versions: [] });
    } catch (e) {
      setPersonalError(String(e && e.message || e));
    }
    setPersonalBusy('');
  };

  const stExportPersonal = async () => {
    if (!(cfg && window.lore && window.lore.personalMemory)) return;
    setPersonalBusy('export');
    setPersonalError('');
    setPersonalNotice('');
    try {
      const result = await window.lore.personalMemory.export(
        cfg.tenant, cfg.owner, cfg.scope);
      if (result && result.ok) setPersonalNotice('Export complete.');
    } catch (e) {
      setPersonalError(String(e && e.message || e));
    }
    setPersonalBusy('');
  };

  const stLoadPast = async (mode = 'browse') => {
    if (!(cfg && cfg.tenant && cfg.scope && window.lore && window.lore.sessions)) return;
    setPastBusy(true);
    try {
      const result = await window.lore.sessions.recall(mode, {
        tenant: cfg.tenant, scopes: [cfg.scope], query: pastQuery || null, limit: 8
      });
      setPastSessions(result && result.sessions || []);
      setPastOpen(true);
    } catch (e) {
      setPersonalError(String(e && e.message || e));
    }
    setPastBusy(false);
  };

  React.useEffect(() => {
    const tenant = cfg && cfg.tenant || '';
    if (!tenant) {
      setLearnStatus(null);
      setLearnPending(null);
      setLearnError('');
      setLearnPendingOpen(false);
      setLearnSelected('');
      return;
    }
    stRefreshLearn(tenant).catch((e) => setLearnError(String(e && e.message || e)));
  }, [cfg ? cfg.tenant : '']);

  React.useEffect(() => {
    stRefreshPersonal(cfg);
  }, [cfg ? `${cfg.tenant || ''}:${cfg.owner || ''}:${cfg.scope || ''}` : '']);

  const stOpenLearnReview = async (skill) => {
    const name = stLearnSkillName(skill);
    if (!name || !(window.lore && window.lore.learn)) return;
    setLearnPendingOpen(true);
    setLearnSelected(name);
    if (learnDiffs[name]) return;
    setLearnDiffLoading(name);
    try {
      const diff = await window.lore.learn.diff(name, cfg && cfg.tenant, cfg && cfg.scope);
      setLearnDiffs((prev) => ({ ...prev, [name]: diff || {} }));
    } catch (e) {
      setLearnDiffs((prev) => ({ ...prev, [name]: { error: String(e && e.message || e) } }));
    }
    setLearnDiffLoading('');
  };

  const stResolveLearn = async (skill, action) => {
    const name = typeof skill === 'string' ? skill : stLearnSkillName(skill);
    if (!name || !(window.lore && window.lore.learn) || !cfg || !cfg.tenant) return;
    setLearnActionBusy(`${action}:${name}`);
    setLearnError('');
    try {
      if (action === 'approve') await window.lore.learn.approve(name, cfg.tenant, cfg.scope, cfg.owner);else
      await window.lore.learn.reject(name, cfg.tenant, cfg.scope, cfg.owner);
      setLearnDiffs((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      if (learnSelected === name) setLearnSelected('');
      await stRefreshLearn(cfg.tenant);
    } catch (e) {
      setLearnError(String(e && e.message || e));
    }
    setLearnActionBusy('');
  };

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
      setAdvancedMode(config.advancedMode === true);
      setAutoFileObvious(config.autoFileObvious === true);
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

  const stSetAutoApplySections = (v) => {
    setAutoApplySections(v);
    if (window.lore && window.lore.config && window.lore.config.set) {
      window.lore.config.set({ autoApplySections: !!v }).catch(() => {});
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
      window.lore.config.set({ scope: id }).then((next) => {if (onConfig) onConfig(next);}).catch(() => {});
    }
  };

  const stSetAdvancedMode = (v) => {
    setAdvancedMode(v);
    if (window.lore && window.lore.config && window.lore.config.set) {
      // onConfig re-renders the app with the new config so the rail updates live.
      window.lore.config.set({ advancedMode: !!v }).then((next) => {if (onConfig) onConfig(next);}).catch(() => {});
    }
  };

  const stSetBackupEnabled = (v) => {
    setBackupEnabled(v);
    if (window.lore && window.lore.config && window.lore.config.set) {
      window.lore.config.set({ backupEnabled: !!v }).then((next) => {if (onConfig) onConfig(next);}).catch(() => {});
    }
    if (v && backupDir) stRunBackup();
  };
  const stPickBackupDir = async () => {
    if (!window.lore || !window.lore.backup) return;
    const r = await window.lore.backup.pickDir();
    if (r && r.ok && r.dir) {
      setBackupDir(r.dir);
      if (window.lore.config && window.lore.config.set) {
        const next = await window.lore.config.set({ backupDir: r.dir });if (onConfig) onConfig(next);
      }
      stRunBackup();
    }
  };
  const stRunBackup = async () => {
    if (!window.lore || !window.lore.backup) return;
    setBackupBusy(true);
    try {await window.lore.backup.run();const b = await window.lore.backup.status();setBackupStatus(b || null);} finally
    {setBackupBusy(false);}
  };

  const stLoadAudit = async () => {
    if (!window.lore || !window.lore.queryLog || !cfg || !cfg.tenant) {setAuditEntries([]);return;}
    try {const r = await window.lore.queryLog.list(cfg.tenant, 50);setAuditEntries(r && r.entries || []);}
    catch {setAuditEntries([]);}
  };
  const stToggleAudit = () => {
    setAuditOpen((o) => {const next = !o;if (next) stLoadAudit();return next;});
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
  // The raw `tenant · scope` pair (e.g. "local · engineering") is internal
  // plumbing — tenant is the data namespace, scope the default note permission —
  // and reads as gibberish under the account name. Show the account KIND
  // instead: "Enterprise" only when signed into enterprise/company spaces,
  // otherwise this is a personal on-device library. Internals stay on hover.
  const accountKind = authUser && Array.isArray(authUser.scopes) &&
  authUser.scopes.some((s) => /enterprise|company/i.test(String(s))) ?
  'Enterprise' : 'Personal — on this computer';
  const displayNone = (v) => stText(v, 'None');
  const learnPendingSkills = stLearnPendingSkills(learnPending);
  const learnPendingCount = stLearnPendingCount(learnStatus, learnPending);
  const learnTodayRuns = stLearnTodayRuns(learnStatus);
  const learnEstTokens = stLearnEstTokens(learnStatus);
  const learnEnabled = stLearnEnabled(learnStatus);
  const learnNotice = stLearnBudgetNotice(learnStatus);
  const learnSelectedDiff = learnSelected ? learnDiffs[learnSelected] : null;
  const learnSelectedText = stLearnDiffText(learnSelectedDiff);
  const learnSelectedSummary = learnPendingSkills.find((skill) => stLearnSkillName(skill) === learnSelected) || null;
  const learnConfigured = Boolean(cfg && cfg.tenant);
  const learnTone = !learnConfigured ? 'neutral' :
  learnError ? 'neutral' :
  learnEnabled === false ? 'neutral' :
  learnEnabled === true ? 'success' :
  'info';
  const learnLabel = !learnConfigured ? 'configure account' :
  learnError ? 'unavailable' :
  learnEnabled === false ? 'disabled' :
  learnEnabled === true ? 'enabled' :
  'checking';
  const personalConfigured = Boolean(cfg && cfg.tenant && cfg.owner && cfg.scope);
  const personalVersion = (kind) => {
    const doc = personalDocs.find((item) => item && item.kind === kind);
    return doc ? Number(doc.version || 0) : 0;
  };

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
    React.createElement("div", { title: `${tenantLabel}${scopeLabel ? ` · ${scopeLabel}` : ''}`,
      style: { fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 } }, accountKind)
    ), /*#__PURE__*/
    React.createElement(StBadge, { tone: identityReady ? 'success' : 'neutral' }, identityReady ? 'configured' : 'not configured'), /*#__PURE__*/
    React.createElement(StButton, { variant: "secondary", size: "sm", onClick: onOpenSetup }, "Configure")
    ), /*#__PURE__*/
    React.createElement(Row, { label: "Google sign-in", hint: authUser ? `Signed in — ${authUser.scopes && authUser.scopes.length || 0} team space(s)` : 'Sign in to sync team/enterprise notes and ask across your team.' }, /*#__PURE__*/
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
    React.createElement(Row, { label: "New notes are saved as", hint: "The permission every newly captured note gets \u2014 this is what your AI hooks write with. Change it per-note anytime from the editor's visibility control." }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 2, gap: 2 } },
    [['private', 'Private'], ['team', 'Team'], ['company', 'Company']].map(([id, label]) => {
      const on = defScope === id || id === 'private' && !['team', 'company', 'enterprise'].includes(defScope);
      return (/*#__PURE__*/
        React.createElement("button", { key: id, onClick: () => stSetDefaultScope(id), style: {
            border: 'none', cursor: 'pointer', padding: '4px 11px', borderRadius: 'var(--radius-xs)',
            background: on ? 'var(--surface-raised)' : 'transparent',
            color: on ? 'var(--brand-fg)' : 'var(--text-subtle)',
            fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: on ? 600 : 400
          } }, label));

    })
    )
    ), /*#__PURE__*/
    React.createElement(Row, { label: "Advanced mode", hint: "Show the developer surfaces \u2014 Connections (AI-tool capture), MCP, CLI, retrieval model internals, and the wizard store. Off by default; everything keeps working underneath." }, /*#__PURE__*/
    React.createElement(StSwitch, { checked: advancedMode, onChange: stSetAdvancedMode })
    )
    ), /*#__PURE__*/

    React.createElement(Section, { icon: "shield-check", title: "Backup" }, /*#__PURE__*/
    React.createElement(Row, { label: "Back up my library", hint: "Continuously mirror your notes into a folder you choose \u2014 point it at your OneDrive or SharePoint-synced folder and Microsoft syncs it off-device. Your files literally appear there; nothing is uploaded by Lore itself." }, /*#__PURE__*/
    React.createElement(StSwitch, { checked: backupEnabled, onChange: stSetBackupEnabled })
    ),
    backupEnabled && /*#__PURE__*/
    React.createElement(Row, { label: "Backup folder", hint: backupDir || 'No folder chosen yet.' }, /*#__PURE__*/
    React.createElement(StButton, { variant: "secondary", size: "sm", onClick: stPickBackupDir }, backupDir ? 'Change…' : 'Choose folder…')
    ),

    backupEnabled && backupDir && /*#__PURE__*/
    React.createElement(Row, { label: "Status", last: true }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 10 } }, /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 11.5, color: backupStatus && backupStatus.ok === false ? 'var(--clay-400)' : 'var(--jade-400)' } },
    backupStatus && backupStatus.ok === false ?
    `⚠ ${backupStatus.error || 'backup failed'}` :
    backupStatus && backupStatus.lastRun ?
    `✓ ${stAgo(backupStatus.lastRun)} · ${backupStatus.count || 0} notes` :
    'not run yet'
    ), /*#__PURE__*/
    React.createElement(StButton, { variant: "secondary", size: "sm", onClick: stRunBackup, disabled: backupBusy }, backupBusy ? 'Backing up…' : 'Back up now')
    )
    )

    ), /*#__PURE__*/

    React.createElement(Section, { icon: "shield", title: "Security" }, /*#__PURE__*/
    React.createElement(Row, { label: "On-device lock", hint: "Lore's local backend requires a per-install token, so no other app on this machine can read your knowledge base. Managed automatically.", last: !auditOpen }, /*#__PURE__*/
    React.createElement(StBadge, { tone: "success", dot: true }, "locked")
    ), /*#__PURE__*/
    React.createElement(Row, { label: "Access log", hint: "Every search and question is recorded (as a hash \u2014 never the raw text) so you can audit what's been queried." }, /*#__PURE__*/
    React.createElement(StButton, { variant: "secondary", size: "sm", onClick: stToggleAudit }, auditOpen ? 'Hide' : 'View log')
    ),
    auditOpen && /*#__PURE__*/
    React.createElement("div", { style: { padding: '4px 16px 14px' } },
    !auditEntries || !auditEntries.length ? /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 12, color: 'var(--text-faint)', padding: '6px 0' } }, "No queries recorded yet.") : /*#__PURE__*/

    React.createElement(React.Fragment, null, /*#__PURE__*/
    React.createElement("div", { style: { maxHeight: 220, overflowY: 'auto', border: '1px solid var(--divider)', borderRadius: 'var(--radius-sm)' } },
    auditEntries.map((e, i) => /*#__PURE__*/
    React.createElement("div", { key: i, style: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderBottom: i < auditEntries.length - 1 ? '1px solid var(--divider)' : 'none', fontFamily: 'var(--font-mono)', fontSize: 10.5 } }, /*#__PURE__*/
    React.createElement("span", { style: { color: 'var(--text-faint)', width: 132, flexShrink: 0 } }, stAgo(e.ts)), /*#__PURE__*/
    React.createElement(StBadge, { tone: "neutral" }, e.endpoint), /*#__PURE__*/
    React.createElement("span", { style: { color: 'var(--text-subtle)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, (e.scopes || []).join(', ')), /*#__PURE__*/
    React.createElement("span", { style: { color: 'var(--text-faint)' } }, e.hits, " hits")
    )
    )
    ), /*#__PURE__*/
    React.createElement("div", { style: { marginTop: 8, display: 'flex', justifyContent: 'flex-end' } }, /*#__PURE__*/
    React.createElement(StButton, { variant: "secondary", size: "sm", onClick: stPurgeAudit }, "Clear log")
    )
    )

    )

    ), /*#__PURE__*/

    React.createElement(Section, { icon: "user-round", title: "What Lore knows" }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', justifyContent: 'flex-end', padding: '8px 16px', borderBottom: '1px solid var(--divider)' } }, /*#__PURE__*/
    React.createElement(StButton, { variant: "secondary", size: "sm", icon: "download", disabled: !personalConfigured || !!personalBusy, onClick: stExportPersonal },
    personalBusy === 'export' ? 'Exporting...' : 'Export'
    )
    ), /*#__PURE__*/
    React.createElement("div", { style: { padding: '12px 16px', borderBottom: '1px solid var(--divider)' } }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 6 } }, /*#__PURE__*/
    React.createElement("div", null, /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' } }, "About you"), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 2 } }, "Preferences and facts Lore should use when helping you.")
    ), /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' } },
    (personalDrafts.user || '').length, "/1375"
    )
    ), /*#__PURE__*/
    React.createElement("textarea", {
      value: personalDrafts.user,
      maxLength: 1375,
      disabled: !personalConfigured || personalBusy === 'user',
      onChange: (e) => setPersonalDrafts((prev) => ({ ...prev, user: e.target.value })),
      placeholder: "For example: I prefer concise answers with verification details.",
      style: { width: '100%', minHeight: 78, resize: 'vertical', boxSizing: 'border-box', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-inset)', color: 'var(--text-body)', padding: '9px 10px', fontFamily: 'var(--font-sans)', fontSize: 12.5, lineHeight: 1.5 } }
    ), /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 } },
    personalVersion('user') > 0 && /*#__PURE__*/React.createElement(StButton, { variant: "ghost", size: "sm", icon: "history", disabled: !!personalBusy, onClick: () => stShowPersonalHistory('user') }, "History"),
    personalVersion('user') > 0 && /*#__PURE__*/React.createElement(StButton, { variant: "ghost", size: "sm", disabled: !!personalBusy, onClick: () => stForgetPersonal('user') }, "Forget"),
    personalVersion('user') > 1 && /*#__PURE__*/React.createElement(StButton, { variant: "ghost", size: "sm", disabled: !!personalBusy, onClick: () => stUndoPersonal('user') }, "Undo last change"), /*#__PURE__*/
    React.createElement(StButton, { variant: "primary", size: "sm", disabled: !personalConfigured || !!personalBusy || !(personalDrafts.user || '').trim(), onClick: () => stSavePersonal('user') },
    personalBusy === 'user' ? 'Saving...' : 'Save'
    )
    )
    ), /*#__PURE__*/
    React.createElement("div", { style: { padding: '12px 16px', borderBottom: '1px solid var(--divider)' } }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 6 } }, /*#__PURE__*/
    React.createElement("div", null, /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' } }, "Working context"), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 2 } }, "Current priorities and context to carry into future conversations.")
    ), /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' } },
    (personalDrafts.memory || '').length, "/2200"
    )
    ), /*#__PURE__*/
    React.createElement("textarea", {
      value: personalDrafts.memory,
      maxLength: 2200,
      disabled: !personalConfigured || personalBusy === 'memory',
      onChange: (e) => setPersonalDrafts((prev) => ({ ...prev, memory: e.target.value })),
      placeholder: "For example: We are preparing the desktop beta and testing upgrade paths.",
      style: { width: '100%', minHeight: 92, resize: 'vertical', boxSizing: 'border-box', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-inset)', color: 'var(--text-body)', padding: '9px 10px', fontFamily: 'var(--font-sans)', fontSize: 12.5, lineHeight: 1.5 } }
    ), /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 } },
    personalVersion('memory') > 0 && /*#__PURE__*/React.createElement(StButton, { variant: "ghost", size: "sm", icon: "history", disabled: !!personalBusy, onClick: () => stShowPersonalHistory('memory') }, "History"),
    personalVersion('memory') > 0 && /*#__PURE__*/React.createElement(StButton, { variant: "ghost", size: "sm", disabled: !!personalBusy, onClick: () => stForgetPersonal('memory') }, "Forget"),
    personalVersion('memory') > 1 && /*#__PURE__*/React.createElement(StButton, { variant: "ghost", size: "sm", disabled: !!personalBusy, onClick: () => stUndoPersonal('memory') }, "Undo last change"), /*#__PURE__*/
    React.createElement(StButton, { variant: "primary", size: "sm", disabled: !personalConfigured || !!personalBusy || !(personalDrafts.memory || '').trim(), onClick: () => stSavePersonal('memory') },
    personalBusy === 'memory' ? 'Saving...' : 'Save'
    )
    )
    ),
    !!personalHistory.kind && /*#__PURE__*/
    React.createElement("div", { style: { padding: '10px 16px', borderBottom: '1px solid var(--divider)' } }, /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--text-strong)', marginBottom: 4 } },
    personalHistory.kind === 'user' ? 'About you history' : 'Working context history'
    ),
    personalHistory.versions.map((version, index) => /*#__PURE__*/
    React.createElement("div", { key: version.version, style: { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: index ? '1px solid var(--divider)' : 'none' } }, /*#__PURE__*/
    React.createElement("div", { style: { minWidth: 0, flex: 1 } }, /*#__PURE__*/
    React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' } }, "Version ",
    version.version, " \xB7 ", stAgo(version.created_at) || 'saved', " \xB7 ", version.origin || 'user'
    ), /*#__PURE__*/
    React.createElement("div", { style: { marginTop: 2, fontSize: 11.5, color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
    version.text || ''
    )
    ),
    index > 0 && /*#__PURE__*/React.createElement(StButton, { variant: "secondary", size: "sm", disabled: !!personalBusy, onClick: () => stRestorePersonal(personalHistory.kind, version.version) }, "Restore")
    )
    )
    ), /*#__PURE__*/

    React.createElement("div", { style: { padding: '12px 16px' } }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8 } }, /*#__PURE__*/
    React.createElement("input", {
      value: pastQuery,
      onChange: (e) => setPastQuery(e.target.value),
      onKeyDown: (e) => {if (e.key === 'Enter') stLoadPast(pastQuery.trim() ? 'discovery' : 'browse');},
      placeholder: "Find past work",
      style: { flex: 1, minWidth: 0, height: 32, boxSizing: 'border-box', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-inset)', color: 'var(--text-body)', padding: '0 9px', fontFamily: 'var(--font-sans)', fontSize: 12.5 } }
    ), /*#__PURE__*/
    React.createElement(StButton, { variant: "secondary", size: "sm", icon: "search", disabled: !personalConfigured || pastBusy, onClick: () => stLoadPast(pastQuery.trim() ? 'discovery' : 'browse') },
    pastBusy ? 'Searching...' : 'Search'
    )
    ),
    pastOpen && /*#__PURE__*/
    React.createElement("div", { style: { marginTop: 10, display: 'flex', flexDirection: 'column' } },
    !pastSessions.length && /*#__PURE__*/React.createElement("div", { style: { fontSize: 12, color: 'var(--text-faint)' } }, "No matching past work."),
    pastSessions.map((session, index) => /*#__PURE__*/
    React.createElement("div", { key: `${session.note_id || 'session'}:${index}`, style: { padding: '8px 0', borderTop: index ? '1px solid var(--divider)' : 'none' } }, /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--text-strong)' } }, session.title || 'Past conversation'), /*#__PURE__*/
    React.createElement("div", { style: { marginTop: 2, fontSize: 11.5, lineHeight: 1.45, color: 'var(--text-subtle)' } }, session.excerpt || session.text || ''),
    (session.why || session.heading_path) && /*#__PURE__*/React.createElement("div", { style: { marginTop: 3, fontSize: 10.5, color: 'var(--text-faint)' } }, [session.why, session.heading_path].filter(Boolean).join(' · '))
    )
    )
    )

    ),
    personalNotice && /*#__PURE__*/React.createElement("div", { style: { padding: '0 16px 10px', color: 'var(--jade-400)', fontSize: 12 } }, personalNotice),
    personalError && /*#__PURE__*/React.createElement("div", { style: { padding: '0 16px 12px', color: 'var(--clay-400)', fontSize: 12 } }, personalError)
    ), /*#__PURE__*/

    React.createElement(Section, { icon: "cpu", title: "Remembering" }, /*#__PURE__*/
    React.createElement(Row, { label: "Remember changes automatically", hint: "Refresh a note's memory automatically when its file changes on disk. Off: refresh manually (right-click a note \u2192 Refresh)." }, /*#__PURE__*/
    React.createElement(StSwitch, { checked: autoIndexOnSave, onChange: stSetAutoIndex })
    ), /*#__PURE__*/
    React.createElement(Row, { label: "Auto-file obvious notes", hint: "While tidying, a note that unambiguously belongs to one of your existing sections is moved into that folder automatically \u2014 undoable, logged to the library worklog. Off (default): every move stays a suggestion you approve.", last: true }, /*#__PURE__*/
    React.createElement(StSwitch, { checked: autoFileObvious, onChange: stSetAutoFile })
    )
    ), /*#__PURE__*/

    React.createElement(Section, { icon: "sparkles", title: "Lore Learn" }, /*#__PURE__*/
    React.createElement(Row, { label: "Status", hint: learnConfigured ? 'Post-session review worker for staged skill learning.' : 'Configure your library identity first so Learn can scope runs to a tenant.' }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8 } }, /*#__PURE__*/
    React.createElement(StBadge, { tone: learnTone, dot: learnEnabled === true }, learnLabel), /*#__PURE__*/
    React.createElement(StButton, { variant: "secondary", size: "sm", icon: "refresh-cw", disabled: !learnConfigured, onClick: () => stRefreshLearn(cfg && cfg.tenant) }, "Refresh"

    )
    )
    ), /*#__PURE__*/
    React.createElement(Row, { label: "Today's runs" }, /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' } }, stFmtInt(learnTodayRuns))
    ), /*#__PURE__*/
    React.createElement(Row, { label: "Estimated tokens" }, /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' } }, stFmtInt(learnEstTokens))
    ), /*#__PURE__*/
    React.createElement(Row, { label: "Pending skills", hint: learnPendingCount ? 'Pending Lore-created skills waiting for human review.' : 'No staged skills waiting for review.', last: !learnPendingOpen && !learnNotice && !learnError }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8 } }, /*#__PURE__*/
    React.createElement(StBadge, { tone: learnPendingCount ? 'info' : 'neutral' }, stFmtInt(learnPendingCount)), /*#__PURE__*/
    React.createElement(StButton, { variant: "secondary", size: "sm", disabled: !learnConfigured, onClick: () => setLearnPendingOpen((open) => !open) },
    learnPendingOpen ? 'Hide review' : 'Review'
    )
    )
    ),
    (learnNotice || learnError || learnPendingOpen) && /*#__PURE__*/
    React.createElement("div", { style: { padding: '10px 16px 14px', borderTop: '1px solid var(--divider)', background: 'var(--surface-base)' } },
    learnNotice && /*#__PURE__*/
    React.createElement("div", { style: { marginBottom: learnError || learnPendingOpen ? 10 : 0, fontSize: 12, color: 'var(--text-subtle)', lineHeight: 1.5 } },
    learnNotice
    ),

    learnError && /*#__PURE__*/
    React.createElement("div", { style: { marginBottom: learnPendingOpen ? 10 : 0, fontSize: 12, color: 'var(--clay-400)', lineHeight: 1.5 } },
    learnError
    ),

    learnPendingOpen && /*#__PURE__*/
    React.createElement(React.Fragment, null,
    !learnPendingSkills.length && /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 12, color: 'var(--text-faint)' } }, "No pending skill proposals."),

    learnPendingSkills.length > 0 && /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
    learnPendingSkills.map((skill) => {
      const name = stLearnSkillName(skill);
      const summary = stLearnSkillSummary(skill);
      const selected = learnSelected === name;
      const diffBusy = learnDiffLoading === name;
      const approveBusy = learnActionBusy === `approve:${name}`;
      const rejectBusy = learnActionBusy === `reject:${name}`;
      const meta = [];
      if (skill.version || skill.pending_version) meta.push(`v${skill.pending_version || skill.version}`);
      if (skill.updated_at || skill.created_at) meta.push(stAgo(skill.updated_at || skill.created_at));
      return (/*#__PURE__*/
        React.createElement("div", { key: name, style: { border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-panel)' } }, /*#__PURE__*/
        React.createElement("div", { style: { display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 12px' } }, /*#__PURE__*/
        React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /*#__PURE__*/
        React.createElement("div", { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
        name
        ),
        summary && /*#__PURE__*/
        React.createElement("div", { style: { marginTop: 2, fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.45 } },
        summary
        ),

        meta.length > 0 && /*#__PURE__*/
        React.createElement("div", { style: { marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' } },
        meta.join(' · ')
        )

        ), /*#__PURE__*/
        React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' } }, /*#__PURE__*/
        React.createElement(StButton, { variant: selected ? 'primary' : 'secondary', size: "sm", onClick: () => stOpenLearnReview(skill), disabled: diffBusy || approveBusy || rejectBusy },
        diffBusy ? 'Loadingâ€¦' : selected ? 'Reviewing' : 'Review'
        ), /*#__PURE__*/
        React.createElement(StButton, { variant: "secondary", size: "sm", onClick: () => stResolveLearn(skill, 'approve'), disabled: approveBusy || rejectBusy || diffBusy },
        approveBusy ? 'Approvingâ€¦' : 'Approve'
        ), /*#__PURE__*/
        React.createElement(StButton, { variant: "ghost", size: "sm", onClick: () => stResolveLearn(skill, 'reject'), disabled: approveBusy || rejectBusy || diffBusy },
        rejectBusy ? 'Rejectingâ€¦' : 'Reject'
        )
        )
        ),
        selected && /*#__PURE__*/
        React.createElement("div", { style: { borderTop: '1px solid var(--divider)', background: 'var(--surface-inset)', padding: '10px 12px' } }, /*#__PURE__*/
        React.createElement("div", { style: { fontSize: 11, color: 'var(--text-faint)', marginBottom: 6 } },
        learnSelectedSummary && stLearnSkillSummary(learnSelectedSummary) ? 'Pending diff' : 'Pending body'
        ),
        learnSelectedDiff && learnSelectedDiff.error && /*#__PURE__*/
        React.createElement("div", { style: { fontSize: 12, color: 'var(--clay-400)' } }, learnSelectedDiff.error),

        !learnSelectedDiff && diffBusy && /*#__PURE__*/
        React.createElement("div", { style: { fontSize: 12, color: 'var(--text-subtle)' } }, "Loading diff\xE2\u20AC\xA6"),

        learnSelectedDiff && !learnSelectedDiff.error && /*#__PURE__*/
        React.createElement("pre", { style: { margin: 0, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.55, color: 'var(--text-muted)' } },
        learnSelectedText || 'No diff returned by backend.'
        )

        )

        ));

    })
    )

    )

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
    ),


    advancedMode && /*#__PURE__*/
    React.createElement(React.Fragment, null, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8, margin: '26px 0 12px' } }, /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em' } }, "Advanced"), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1, height: 1, background: 'var(--divider)' } })
    ), /*#__PURE__*/


    React.createElement(Section, { icon: "cpu", title: "Retrieval models" }, /*#__PURE__*/
    React.createElement(Row, { label: "Contextual retrieval", hint: "Every chunk is stored with a situating context sentence for better recall. Built into the pipeline." }, /*#__PURE__*/
    React.createElement(StBadge, { tone: retrieval === null ? 'neutral' : retrieval.error ? 'neutral' : 'success', dot: !!(retrieval && !retrieval.error) },
    retrieval === null ? 'checking…' : retrieval.error ? 'memory engine is starting…' : 'enabled'
    )
    ), /*#__PURE__*/
    React.createElement(Row, { label: "Embedding model" }, /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' } }, stRetrievalModel(retrieval, 'embeddingModel'))
    ), /*#__PURE__*/
    React.createElement(Row, { label: "Reranker" }, /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' } }, stRetrievalModel(retrieval, 'reranker'))
    ), /*#__PURE__*/
    React.createElement(Row, { label: "Local fallback", hint: "On-device fastembed models. Always used for captures and imports; primary for search when no cloud key is set." },
    (() => {
      const lf = retrieval && !retrieval.error ? retrieval.localFallback : null;
      const tone = !lf ? 'neutral' : lf.active ? 'success' : lf.available ? 'info' : 'neutral';
      const label = retrieval === null ? 'checking…' : retrieval.error ? 'memory engine is starting…' :
      lf && lf.active ? 'active' : lf && lf.available ? 'available' : 'not available';
      return /*#__PURE__*/React.createElement(StBadge, { tone: tone, dot: !!(lf && lf.active) }, label);
    })()
    ), /*#__PURE__*/
    React.createElement(Row, { label: "Import config", hint: "Apply retrieval and tidying settings from a JSON file \u2014 another Lore install or a shared team config.", last: true }, /*#__PURE__*/
    React.createElement(StButton, { variant: "secondary", size: "sm", icon: "folder-open", onClick: stImportConfig }, "Import\u2026")
    ),
    importResult && /*#__PURE__*/
    React.createElement("div", { style: { padding: '10px 16px', borderTop: '1px solid var(--divider)', fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.6, color: importResult.ok ? 'var(--text-muted)' : 'var(--clay-400)' } },
    importResult.ok ?
    `Applied: ${Object.keys(importResult.applied || {}).join(', ')}${(importResult.ignored || []).length ? ` · ignored: ${importResult.ignored.join(', ')}` : ''}` :
    `Import failed: ${stText(importResult.reason, 'unknown error')}`
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
    )
    ), /*#__PURE__*/



    React.createElement(Section, { icon: "refresh-ccw", title: /*#__PURE__*/
      React.createElement("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 7 } }, "Tidy up & auto-organize",

      window.LoreHelpHint && /*#__PURE__*/React.createElement(window.LoreHelpHint, { tip: "Lore keeps your library tidy on its own: it folds throwaway date/session notes into durable topic pages, and when enough pages cluster around one subject it groups them into a Section (a folder/column). With auto-apply on, Sections happen on their own \u2014 Undo always puts everything back. Turn auto-apply off to review each Section first." })
      ) }, /*#__PURE__*/

    React.createElement(Row, { label: "Tidy automatically", hint: identityReady ? 'Lore folds date/session notes into durable topic notes automatically after each capture.' : 'Finish setup before enabling automatic tidying.' }, /*#__PURE__*/
    React.createElement(StSwitch, { checked: upkeepAuto && identityReady, onChange: stSetUpkeepAuto, disabled: !identityReady })
    ), /*#__PURE__*/
    React.createElement(Row, { label: /*#__PURE__*/
      React.createElement("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 7 } }, "Suggest Sections automatically",

      window.LoreHelpHint && /*#__PURE__*/React.createElement(window.LoreHelpHint, { tip: "When on, Lore watches for pages that cluster around the same subject and detects a Section (a folder/column) to group them. Whether it applies itself or waits for your OK is the next toggle." })
      ),
      hint: "Detect groups of related pages as your library grows." }, /*#__PURE__*/
    React.createElement(StSwitch, { checked: autoClassify, onChange: stSetAutoClassify, disabled: !identityReady })
    ), /*#__PURE__*/
    React.createElement(Row, { label: /*#__PURE__*/
      React.createElement("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 7 } }, "Apply Sections automatically",

      window.LoreHelpHint && /*#__PURE__*/React.createElement(window.LoreHelpHint, { tip: "Detected Sections create their folder and move their notes right away \u2014 no approval step. Undo on a Section puts every note back where it was and retires that Section for good. Turn this off to review each Section before anything moves." })
      ),
      hint: "Sections happen on their own; Undo always restores the original layout." }, /*#__PURE__*/
    React.createElement(StSwitch, { checked: autoApplySections && autoClassify && identityReady, onChange: stSetAutoApplySections, disabled: !identityReady || !autoClassify })
    ), /*#__PURE__*/
    React.createElement(Row, { label: `Group into a Section after ${sectionThreshold} related pages`,
      hint: "How many pages must cluster around a subject before Lore proposes a Section for them." }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 190 } }, /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' } }, "3"), /*#__PURE__*/
    React.createElement("input", { type: "range", min: 3, max: 20, step: 1, value: sectionThreshold,
      onChange: (e) => stSetSectionThreshold(e.target.value), disabled: !identityReady,
      style: { flex: 1, accentColor: 'var(--brand-fg)', cursor: identityReady ? 'pointer' : 'not-allowed' } }), /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' } }, "20"), /*#__PURE__*/
    React.createElement("span", { style: { minWidth: 20, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 600, color: 'var(--brand-fg)' } }, sectionThreshold)
    )
    ),
    lastTidied && /*#__PURE__*/
    React.createElement(Row, { label: "Last tidied", hint: "When Lore last folded notes and refreshed the library." }, /*#__PURE__*/
    React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' } }, stAgo(lastTidied) || '—')
    ), /*#__PURE__*/

    React.createElement(Row, { label: "Tidy up now", hint: "Detect ephemeral notes (daily, session, sync) and consolidate them into durable topic notes.", last: true }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8 } },
    upkeepRunning && /*#__PURE__*/
    React.createElement(StIcon, { name: "loader", size: 14, style: { color: 'var(--brand-fg)', animation: 'lore-pulse 1s linear infinite' } }), /*#__PURE__*/

    React.createElement(StButton, {
      variant: "secondary",
      size: "sm",
      icon: "zap",
      onClick: stRunUpkeep,
      disabled: upkeepRunning || !identityReady },

    upkeepRunning ? 'Tidying…' : 'Tidy up now'
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

    ), /*#__PURE__*/


    React.createElement(Section, { icon: "folder-tree", title: /*#__PURE__*/
      React.createElement("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 7 } }, "Folders Lore reads",

      window.LoreHelpHint && /*#__PURE__*/React.createElement(window.LoreHelpHint, { tip: "Choose which top-level folders in your library Lore is allowed to read and index. Turn one off to keep it private from search, Ask, and the graph. Changes apply on the next Refresh (or restart)." })
      ) },

    folders === null && /*#__PURE__*/
    React.createElement("div", { style: { padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)' } }, "Loading folders\u2026"),

    folders && folders.length === 0 && /*#__PURE__*/
    React.createElement("div", { style: { padding: '12px 16px', fontSize: 12.5, color: 'var(--text-subtle)' } }, "No sub-folders yet \u2014 everything in your library is read."),

    folders && folders.map((name, i) => /*#__PURE__*/
    React.createElement(Row, { key: name, label: name,
      hint: excludes.includes(name) ? 'Hidden from Lore — not read, searched, or in the graph.' : 'Lore reads and indexes this folder.',
      last: i === folders.length - 1 }, /*#__PURE__*/
    React.createElement(StSwitch, { checked: !excludes.includes(name), onChange: () => stToggleFolderRead(name) })
    )
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