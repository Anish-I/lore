/* global React */
// Lore desktop - first-run setup wizard (OB_ prefix for all top-level names)
const OB_NS = window.VaultDesignSystem_ffbf58;
const { Button: OB_Button, Icon: OB_Icon } = OB_NS;

const OB_EXCLUDE_DEFAULTS = ['node_modules', '.git', '.DS_Store', '__pycache__', 'dist', 'build', '.next', 'vendor', '.cache', '.env', '.ssh', '.aws', '.gnupg', 'AppData', 'Windows', 'Program Files', '*.key', '*.pem'];
const OB_EXT_DEFAULTS = ['.md', '.markdown', '.txt', '.js', '.ts', '.py', '.json', '.yaml', '.yml', '.csv'];
const OB_MAXBYTES = 2 * 1024 * 1024;
const OB_MAXFILES_DEFAULT = 5000;

const OB_PURPOSES = [
  { id: 'engineering', icon: 'code', title: 'Engineering', description: 'Code, specs, bugs, releases.' },
  { id: 'research', icon: 'search', title: 'Research', description: 'Sources, papers, briefs.' },
  { id: 'writing', icon: 'pen-tool', title: 'Writing', description: 'Drafts, notes, references.' },
  { id: 'team-memory', icon: 'users', title: 'Team memory', description: 'Decisions, handoffs, rituals.' },
];

const OB_AI_CHOICES = [
  { id: 'claude', icon: 'terminal', title: 'Claude Code', description: 'Capture prompts and coding sessions.' },
  { id: 'chatgpt', icon: 'message-square', title: 'ChatGPT', description: 'Tune answers for ChatGPT workflows.' },
  { id: 'gemini', icon: 'sparkles', title: 'Gemini', description: 'Keep Google AI context in mind.' },
  { id: 'copilot', icon: 'bot', title: 'Copilot', description: 'Track IDE assistant work.' },
];

const OB_APP_CHOICES = [
  { id: 'github', icon: 'git-pull-request', title: 'GitHub', description: 'Repos, issues, PRs.', comingSoon: true },
  { id: 'drive', icon: 'folder', title: 'Drive', description: 'Docs and folders.', comingSoon: true },
  { id: 'slack', icon: 'messages-square', title: 'Slack', description: 'Threads and decisions.', comingSoon: true },
];

const OB_STEPS = [
  { id: 'account', eyebrow: 'Optional', title: 'How do you want to start?', next: 'Create a library' },
  { id: 'vault', eyebrow: 'Library', title: 'Where should Lore keep your library?', next: 'Tell Lore the purpose' },
  { id: 'purpose', eyebrow: 'Purpose', title: 'What is this library for?', next: 'Choose AIs' },
  { id: 'ai', eyebrow: 'AI', title: 'Which AIs should Lore connect to?', next: 'Import apps and files' },
  { id: 'sources', eyebrow: 'Sources', title: 'What should Lore import first?', next: null },
];

function OB_slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function OB_domainFromEmail(email) {
  const parts = String(email || '').toLowerCase().split('@');
  return parts[1] ? OB_slugify(parts[1].replace(/\.[^.]+$/, '')) : null;
}

function OB_validEmail(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || '').trim());
}

function OB_unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function OB_Input({ id, label, value, onChange, type, placeholder, autoComplete }) {
  return (
    <label htmlFor={id} style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>{label}</span>
      <input
        id={id}
        type={type || 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete || 'off'}
        style={{
          height: 40,
          minWidth: 0,
          border: '1px solid var(--border-field)',
          background: 'var(--surface-raised)',
          color: 'var(--text-body)',
          borderRadius: 'var(--radius-sm)',
          padding: '0 12px',
          fontSize: 14,
          outline: 'none',
        }}
      />
    </label>
  );
}

function OB_Choice({ selected, icon, title, description, onClick, disabled, children }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: '100%',
        minHeight: 92,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 13,
        padding: '16px 16px',
        textAlign: 'left',
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${selected ? 'var(--brand-soft-border)' : 'var(--border)'}`,
        background: selected ? 'var(--brand-soft-bg)' : 'var(--surface-inset)',
        color: 'var(--text-body)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.48 : 1,
        transition: 'var(--transition-surface), transform var(--dur-fast) var(--ease-out)',
      }}
    >
      <span style={{
        width: 38,
        height: 38,
        borderRadius: 'var(--radius-md)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: selected ? 'var(--brand-bg)' : 'var(--surface-raised)',
        color: selected ? 'var(--text-onbrand)' : 'var(--text-muted)',
        border: `1px solid ${selected ? 'transparent' : 'var(--border)'}`,
        flexShrink: 0,
      }}>
        <OB_Icon name={icon} size={18} />
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-strong)' }}>{title}</span>
          {selected && <OB_Icon name="check" size={15} style={{ color: 'var(--brand-fg)' }} />}
        </span>
        <span style={{ display: 'block', marginTop: 5, fontSize: 12.5, lineHeight: 1.45, color: 'var(--text-subtle)' }}>{description}</span>
        {children}
      </span>
    </button>
  );
}

function OB_StepDots({ index }) {
  return (
    <div aria-label={`Setup step ${index + 1} of ${OB_STEPS.length}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {OB_STEPS.map((step, i) => (
        <span
          key={step.id}
          style={{
            width: i === index ? 22 : 7,
            height: 7,
            borderRadius: 'var(--radius-full)',
            background: i === index ? 'var(--brand-bg)' : i < index ? 'var(--brand-soft-border)' : 'var(--border-strong)',
            transition: 'width 180ms var(--ease-out), background 180ms var(--ease-out)',
          }}
        />
      ))}
    </div>
  );
}

function OB_DropTarget({ dragging, onDrop, onDragEnter, onDragLeave, onDragOver, onBrowse, pendingCount, status, busy }) {
  return (
    <div
      onDrop={onDrop}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      style={{
        minHeight: 142,
        border: `2px dashed ${dragging ? 'var(--brand-fg)' : 'var(--border-strong)'}`,
        borderRadius: 'var(--radius-md)',
        background: dragging ? 'var(--brand-soft-bg)' : 'var(--surface-inset)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
        transition: 'border-color 150ms var(--ease-out), background 150ms var(--ease-out)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%' }}>
        <span style={{ width: 46, height: 46, borderRadius: 'var(--radius-md)', background: 'var(--surface-raised)', border: '1px solid var(--border)', color: dragging ? 'var(--brand-fg)' : 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <OB_Icon name={dragging ? 'folder-input' : 'upload-cloud'} size={23} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-strong)' }}>{dragging ? 'Drop to queue files' : 'Drop files or folders'}</div>
          <div style={{ marginTop: 5, fontSize: 12.5, color: 'var(--text-subtle)', lineHeight: 1.45 }}>
            {pendingCount > 0 ? `${pendingCount} item${pendingCount === 1 ? '' : 's'} queued for import.` : 'Markdown, text, code, JSON, YAML, CSV, and zip archives.'}
          </div>
          {status && <div role="status" style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>{status}</div>}
        </div>
        <OB_Button variant="secondary" icon="folder-open" disabled={busy} onClick={onBrowse}>Browse</OB_Button>
      </div>
    </div>
  );
}

function OB_Onboarding({ onDone }) {
  const [stepIndex, setStepIndex] = React.useState(0);
  const [accountMode] = React.useState('local');
  const [email] = React.useState('');
  const [vaultMode, setVaultMode] = React.useState('create');
  const [vaultName, setVaultName] = React.useState('');
  const [vaultPath, setVaultPath] = React.useState('');
  const [purpose, setPurpose] = React.useState('');
  const [selectedAI, setSelectedAI] = React.useState([]);
  const [backfillClaude, setBackfillClaude] = React.useState(false);
  const [selectedApps, setSelectedApps] = React.useState([]);
  const [pendingImportPaths, setPendingImportPaths] = React.useState([]);
  const [dragging, setDragging] = React.useState(false);
  const [error, setError] = React.useState('');
  const [importStatus, setImportStatus] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const step = OB_STEPS[stepIndex];
  const selectedPurpose = OB_PURPOSES.find((p) => p.id === purpose) || null;
  const signedIn = accountMode !== 'local' && OB_validEmail(email);
  const setupReady = Boolean(vaultPath) && Boolean(purpose);

  const toggleListValue = (setter, value) => {
    setter((items) => items.includes(value) ? items.filter((x) => x !== value) : [...items, value]);
  };

  const openExistingVault = async () => {
    setError('');
    try {
      if (!window.lore?.pickVault) { setError('Folder picker is not available.'); return; }
      const td = await window.lore.pickVault();
      if (td && td.root) setVaultPath(td.root);
    } catch {
      setError('Could not open the folder picker.');
    }
  };

  const createVault = async () => {
    setError('');
    const name = vaultName.trim();
    try {
      if (!window.lore?.createVault) { setError('Library creation is not available.'); return; }
      const td = await window.lore.createVault({ name });
      if (!td) return;
      if (td.ok === false) { setError(td.error || 'Could not create the library.'); return; }
      if (td.name && !name) setVaultName(td.name);
      if (td.root) setVaultPath(td.root);
    } catch {
      setError('Could not create the library folder.');
    }
  };

  const letLoreChooseVaultPath = async () => {
    setError('');
    setSaving(true);
    const name = vaultName.trim();
    try {
      if (!window.lore?.createVault) { setError('Library creation is not available.'); return; }
      const td = await window.lore.createVault({ name, autoPlace: true });
      if (!td) return;
      if (td.ok === false) { setError(td.error || 'Could not create the library.'); return; }
      if (td.name && !name) setVaultName(td.name);
      if (td.root) setVaultPath(td.root);
    } catch {
      setError('Could not create the library folder.');
    } finally {
      setSaving(false);
    }
  };

  const addPendingImportFiles = (files) => {
    const paths = Array.from(files || []).map((f) => f.path).filter(Boolean);
    if (!paths.length) {
      setImportStatus('No readable file paths found.');
      return;
    }
    setPendingImportPaths((items) => OB_unique([...items, ...paths]));
    setImportStatus(`${paths.length} item${paths.length === 1 ? '' : 's'} queued.`);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    addPendingImportFiles(e.dataTransfer && e.dataTransfer.files);
  };

  const buildCfg = () => {
    const accountEmail = signedIn ? email.trim().toLowerCase() : null;
    const scopeId = purpose ? OB_slugify(purpose) : null;
    const tenantId = accountEmail ? OB_domainFromEmail(accountEmail) : 'local';
    return {
      saga: null,
      tier: null,
      full: false,
      promptHistory: backfillClaude,
      roots: vaultPath ? [vaultPath] : [],
      excludes: OB_EXCLUDE_DEFAULTS.slice(),
      extensions: OB_EXT_DEFAULTS,
      maxFiles: OB_MAXFILES_DEFAULT,
      maxBytes: OB_MAXBYTES,
      scope: scopeId,
      owner: accountEmail || 'local-user',
      tenant: tenantId || 'local',
      sync: false,
      account: {
        mode: signedIn ? accountMode : 'local',
        email: accountEmail,
        skipped: !signedIn,
      },
      purpose: selectedPurpose ? {
        id: selectedPurpose.id,
        label: selectedPurpose.title,
      } : null,
      preferredAIProviders: selectedAI.slice(),
      backfillClaudePrompts: backfillClaude,
      connectedApps: selectedApps.slice(),
      setupVersion: 5,
      onboardedAt: new Date().toISOString(),
    };
  };

  const persistDraftConfig = async () => {
    const cfg = buildCfg();
    if (window.lore?.config?.set) return await window.lore.config.set(cfg);
    return cfg;
  };

  const stepError = () => {
    if (step.id === 'vault' && !vaultPath) return vaultMode === 'create' ? 'Choose where to create the library.' : 'Choose a library folder to continue.';
    if (step.id === 'purpose' && !purpose) return 'Choose what this library is for.';
    return '';
  };

  const nextStep = () => {
    const msg = stepError();
    setError(msg);
    if (msg) return;
    setStepIndex((i) => Math.min(i + 1, OB_STEPS.length - 1));
  };

  const previousStep = () => {
    setError('');
    setStepIndex((i) => Math.max(i - 1, 0));
  };

  const browseImport = async () => {
    setError('');
    setImportStatus('');
    if (!setupReady) {
      setImportStatus('Choose a library and purpose first.');
      return;
    }
    setSaving(true);
    try {
      await persistDraftConfig();
      if (window.lore?.importPick) {
        const result = await window.lore.importPick();
        if (result && result.ok === false) setImportStatus(result.error || 'Import could not start.');
        else setImportStatus('Import complete.');
      }
    } catch (e) {
      setImportStatus('Import failed: ' + String((e && e.message) || e));
    }
    setSaving(false);
  };

  const handleSkip = async () => {
    setSaving(true);
    const cfg = {
      saga: null,
      tier: null,
      full: false,
      promptHistory: false,
      roots: [],
      excludes: OB_EXCLUDE_DEFAULTS.slice(),
      extensions: OB_EXT_DEFAULTS,
      maxFiles: OB_MAXFILES_DEFAULT,
      maxBytes: OB_MAXBYTES,
      scope: null,
      owner: null,
      tenant: null,
      sync: false,
      setupVersion: 5,
      skippedSetupAt: new Date().toISOString(),
    };
    if (window.lore?.config?.set) { try { await window.lore.config.set(cfg); } catch { /* non-fatal */ } }
    setSaving(false);
    onDone(cfg, { scan: false });
  };

  const handleFinish = async () => {
    setError('');
    if (!vaultPath) { setStepIndex(1); setError('Choose a library folder to continue.'); return; }
    if (!purpose) { setStepIndex(2); setError('Choose what this library is for.'); return; }

    setSaving(true);
    const cfg = buildCfg();
    if (window.lore?.config?.set) { try { await window.lore.config.set(cfg); } catch { /* non-fatal */ } }

    if (backfillClaude && selectedAI.includes('claude') && window.lore?.hooks?.install) {
      try { await window.lore.hooks.install({ tool: 'claude', scope: cfg.scope }); } catch { /* non-fatal */ }
    }

    if (pendingImportPaths.length && window.lore?.importFiles) {
      try {
        const result = await window.lore.importFiles(pendingImportPaths);
        if (result && result.ok === false) setImportStatus(result.error || 'Queued import could not start.');
      } catch { /* non-fatal */ }
    }

    setSaving(false);
    onDone(cfg, { scan: backfillClaude, openImport: selectedApps.length > 0 && pendingImportPaths.length === 0 });
  };

  const renderStep = () => {
    if (step.id === 'account') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ minHeight: 240, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 220px', gap: 16, padding: 20, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--surface-inset)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14 }}>
              <span style={{ width: 54, height: 54, borderRadius: 'var(--radius-md)', background: 'var(--brand-bg)', color: 'var(--text-onbrand)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <OB_Icon name="laptop" size={25} />
              </span>
              <div>
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: 24, color: 'var(--text-strong)', fontWeight: 700, lineHeight: 1.15 }}>No account required.</div>
                <div style={{ marginTop: 8, maxWidth: 460, fontSize: 14, color: 'var(--text-subtle)', lineHeight: 1.55 }}>Lore starts local on this Mac. You can sign up or log in later from Settings if you want sync, sharing, or account features.</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10 }}>
              {[
                ['check', 'No password now'],
                ['folder-open', 'Create a library next'],
                ['settings', 'Account later'],
              ].map(([icon, label]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 11px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-raised)', color: 'var(--text-muted)', fontSize: 12.5, fontWeight: 700 }}>
                  <OB_Icon name={icon} size={14} style={{ color: 'var(--brand-fg)' }} />
                  {label}
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (step.id === 'vault') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <OB_Choice
              selected={vaultMode === 'create'}
              icon="folder-plus"
              title="Create new library"
              description="Name it, then choose where Lore should place the folder."
              onClick={() => { setVaultMode('create'); setVaultPath(''); setError(''); }}
            />
            <OB_Choice
              selected={vaultMode === 'open'}
              icon="folder-open"
              title="Open existing folder"
              description="Use a folder that already contains your notes or files."
              onClick={() => { setVaultMode('open'); setVaultPath(''); setError(''); }}
            />
          </div>

          <div style={{ minHeight: 176, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--surface-inset)', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {vaultMode === 'create' ? (
              <React.Fragment>
                <OB_Input
                  id="ob-vault-name"
                  label="Library name"
                  value={vaultName}
                  onChange={(v) => { setVaultName(v); setVaultPath(''); setError(''); }}
                  placeholder="Library name"
                  autoComplete="off"
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <OB_Button variant="secondary" icon="sparkles" disabled={saving} onClick={letLoreChooseVaultPath}>Let Lore choose</OB_Button>
                  <OB_Button variant="secondary" icon="folder-open" disabled={saving} onClick={createVault}>Choose location...</OB_Button>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)' }}>Name optional. Lore can create it under Documents.</span>
                </div>
              </React.Fragment>
            ) : (
              <React.Fragment>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-strong)' }}>Open a folder as your library</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', lineHeight: 1.5 }}>Choose any existing folder. Lore will index files inside it and keep new imports there.</div>
                <div>
                  <OB_Button variant="secondary" icon="folder-open" disabled={saving} onClick={openExistingVault}>Choose folder...</OB_Button>
                </div>
              </React.Fragment>
            )}

            <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', border: `1px solid ${vaultPath ? 'var(--brand-soft-border)' : 'var(--border)'}`, borderRadius: 'var(--radius-md)', background: vaultPath ? 'var(--brand-soft-bg)' : 'var(--surface-raised)' }}>
              <OB_Icon name={vaultPath ? 'check-circle-2' : 'map-pin'} size={16} style={{ color: vaultPath ? 'var(--brand-fg)' : 'var(--text-faint)' }} />
              <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: vaultPath ? 'var(--brand-fg)' : 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {vaultPath || 'No path selected yet'}
              </span>
            </div>
          </div>
        </div>
      );
    }

    if (step.id === 'purpose') {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          {OB_PURPOSES.map((item) => (
            <OB_Choice
              key={item.id}
              selected={purpose === item.id}
              icon={item.icon}
              title={item.title}
              description={item.description}
              onClick={() => { setPurpose(item.id); setError(''); }}
            />
          ))}
        </div>
      );
    }

    if (step.id === 'ai') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            {OB_AI_CHOICES.map((item) => (
              <OB_Choice
                key={item.id}
                selected={selectedAI.includes(item.id)}
                icon={item.icon}
                title={item.title}
                description={item.description}
                onClick={() => toggleListValue(setSelectedAI, item.id)}
              />
            ))}
          </div>
          <button
            type="button"
            aria-pressed={backfillClaude}
            onClick={() => {
              setBackfillClaude((v) => !v);
              setSelectedAI((items) => items.includes('claude') ? items : [...items, 'claude']);
            }}
            style={{
              minHeight: 64,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 14px',
              borderRadius: 'var(--radius-md)',
              border: `1px solid ${backfillClaude ? 'var(--brand-soft-border)' : 'var(--border)'}`,
              background: backfillClaude ? 'var(--brand-soft-bg)' : 'var(--surface-inset)',
              color: 'var(--text-body)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <span style={{ width: 36, height: 36, borderRadius: 'var(--radius-sm)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: backfillClaude ? 'var(--brand-bg)' : 'var(--surface-raised)', color: backfillClaude ? 'var(--text-onbrand)' : 'var(--text-muted)', border: `1px solid ${backfillClaude ? 'transparent' : 'var(--border)'}` }}>
              <OB_Icon name="history" size={17} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 800, color: 'var(--text-strong)' }}>Backfill Claude prompts</span>
              <span style={{ display: 'block', marginTop: 3, fontSize: 12.5, color: 'var(--text-subtle)' }}>Import prior Claude Code prompt history into this library.</span>
            </span>
            <span style={{ width: 38, height: 22, borderRadius: 'var(--radius-full)', background: backfillClaude ? 'var(--brand-bg)' : 'var(--surface-raised)', border: '1px solid var(--border-strong)', position: 'relative', flexShrink: 0 }}>
              <span style={{ position: 'absolute', top: 2, left: backfillClaude ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: backfillClaude ? 'var(--text-onbrand)' : 'var(--text-faint)', transition: 'left 150ms var(--ease-out)' }} />
            </span>
          </button>
          {backfillClaude && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)', fontSize: 12, color: 'var(--text-subtle)' }}>
              <OB_Icon name="info" size={13} style={{ color: 'var(--brand-fg)', flexShrink: 0 }} />
              <span>Claude Code capture + prompt backfill will be set up when you finish.</span>
            </div>
          )}
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          {OB_APP_CHOICES.map((item) => (
            <OB_Choice
              key={item.id}
              selected={!item.comingSoon && selectedApps.includes(item.id)}
              icon={item.icon}
              title={item.title}
              description={item.description}
              disabled={item.comingSoon}
              onClick={item.comingSoon ? undefined : () => toggleListValue(setSelectedApps, item.id)}
            >
              {item.comingSoon && (
                <span style={{ display: 'inline-block', marginTop: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-faint)', background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '2px 6px' }}>Coming soon</span>
              )}
            </OB_Choice>
          ))}
        </div>
        <OB_DropTarget
          dragging={dragging}
          onDrop={handleDrop}
          onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
          onDragOver={(e) => e.preventDefault()}
          onBrowse={browseImport}
          pendingCount={pendingImportPaths.length}
          status={importStatus}
          busy={saving}
        />
      </div>
    );
  };

  const supportText = {
    account: 'You can skip account setup. Lore works locally first.',
    vault: 'This is the one local folder Lore will organize.',
    purpose: 'Purpose helps Lore pick the right default scope.',
    ai: 'This is optional. You can connect more AIs later.',
    sources: 'Imports are optional. Drop files now or start clean.',
  }[step.id];

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 100, display: 'flex', flexDirection: 'column', background: 'var(--surface-canvas)', color: 'var(--text-body)', overflow: 'hidden' }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 16, padding: '18px 30px', borderBottom: '1px solid var(--divider)', background: 'var(--surface-base)' }}>
        <div style={{ width: 38, height: 38, borderRadius: 'var(--radius-md)', background: 'var(--surface-raised)', border: '1px solid var(--border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src="design/assets/logo/logomark.svg" alt="Lore" style={{ width: 24, height: 24 }} onError={(e) => { e.target.style.display = 'none'; }} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--brand-fg)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Start Lore</div>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 25, lineHeight: 1.1, color: 'var(--text-strong)' }}>Create your knowledge library</h1>
        </div>
        <OB_StepDots index={stepIndex} />
      </div>

      <main style={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center', overflow: 'auto', padding: '34px 30px 28px' }}>
        <section style={{ width: 'min(820px, 100%)', display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{step.eyebrow}</span>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--border-strong)' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>{stepIndex + 1} of {OB_STEPS.length}</span>
            </div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 34, lineHeight: 1.08, color: 'var(--text-strong)' }}>{step.title}</h2>
            <p style={{ margin: '10px 0 0', maxWidth: 560, fontSize: 14, lineHeight: 1.55, color: 'var(--text-subtle)' }}>{supportText}</p>
          </div>

          <div>{renderStep()}</div>

          {(error || importStatus) && (
            <div role={error ? 'alert' : 'status'} style={{ display: 'flex', alignItems: 'center', gap: 9, minHeight: 34, color: error ? 'var(--clay-400)' : 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
              <OB_Icon name={error ? 'alert-circle' : 'circle'} size={14} />
              {error || importStatus}
            </div>
          )}
        </section>
      </main>

      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, minHeight: 68, padding: '14px 30px', borderTop: '1px solid var(--divider)', background: 'var(--surface-base)' }}>
        <OB_Button variant="ghost" disabled={saving} onClick={handleSkip}>Skip setup</OB_Button>
        <div style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {step.next ? `Next: ${step.next}` : 'Last question: start Lore when you are ready.'}
        </div>
        {stepIndex > 0 && <OB_Button variant="secondary" icon="arrow-left" disabled={saving} onClick={previousStep}>Back</OB_Button>}
        {stepIndex < OB_STEPS.length - 1 ? (
          <OB_Button variant="primary" iconTrailing="arrow-right" disabled={saving} onClick={nextStep}>
            Next
          </OB_Button>
        ) : (
          <OB_Button variant="primary" icon="sparkles" disabled={saving} onClick={handleFinish}>
            {saving ? 'Starting...' : 'Start Lore'}
          </OB_Button>
        )}
      </div>
    </div>
  );
}

window.LoreOnboarding = OB_Onboarding;
