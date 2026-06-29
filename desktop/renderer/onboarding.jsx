/* global React */
// Lore desktop — first-run onboarding modal (OB_ prefix for all top-level names)
const OB_NS = window.VaultDesignSystem_ffbf58;
const { Button: OB_Button, Icon: OB_Icon } = OB_NS;

// Shown to the user; the scraper ALSO hard-excludes secrets/system paths regardless (defense in depth).
const OB_EXCLUDE_DEFAULTS = ['node_modules', '.git', '.DS_Store', '__pycache__', 'dist', 'build', '.next', 'vendor', '.cache', '.env', '.ssh', '.aws', '.gnupg', 'AppData', 'Windows', 'Program Files', '*.key', '*.pem'];
// M1 supported set — must match the scraper's whitelist (desktop/scraper.js).
const OB_EXT_DEFAULTS = ['.md', '.markdown', '.txt', '.js', '.ts', '.py', '.json', '.yaml', '.yml', '.csv'];
// Internal caps — sensible defaults, larger for whole-drive Full.
const OB_MAXBYTES = 2 * 1024 * 1024;       // skip files > 2 MB
const OB_MAXFILES_DEFAULT = 5000;
const OB_MAXFILES_FULL = 200000;

const OB_SCAN_TIERS = [
  { id: 'lite',     label: 'Lite',     sub: 'One folder' },
  { id: 'standard', label: 'Standard', sub: 'A few folders' },
  { id: 'full',     label: 'Full',     sub: 'Entire drive' },
];

// Compact horizontal chip-picker for the scan tier, shown inline when the scan card is enabled.
function OB_TierChips({ tier, onTier }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {OB_SCAN_TIERS.map((t) => (
        <button
          key={t.id}
          onClick={() => onTier(t.id)}
          style={{
            flex: 1, padding: '6px 8px', borderRadius: 'var(--radius-sm)',
            border: `1px solid ${tier === t.id ? 'var(--brand-soft-border)' : 'var(--border)'}`,
            background: tier === t.id ? 'var(--brand-soft-bg)' : 'var(--surface-raised)',
            cursor: 'pointer', textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: tier === t.id ? 'var(--brand-fg)' : 'var(--text-body)' }}>{t.label}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', marginTop: 1 }}>{t.sub}</div>
        </button>
      ))}
    </div>
  );
}

// Toggleable backfill-source card. Renders a toggle switch on the right; expands children when on.
function OB_SourceCard({ icon, title, description, enabled, onToggle, disabled, comingSoon, children }) {
  return (
    <div
      onClick={disabled ? undefined : onToggle}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 13, padding: '12px 14px',
        background: enabled && !disabled ? 'var(--brand-soft-bg)' : 'var(--surface-inset)',
        border: `1px solid ${enabled && !disabled ? 'var(--brand-soft-border)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-md)', cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1, userSelect: 'none',
      }}
    >
      <OB_Icon name={icon} size={16} style={{ color: enabled && !disabled ? 'var(--brand-fg)' : 'var(--text-faint)', marginTop: 2, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)' }}>{title}</span>
          {comingSoon && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '1px 6px' }}>coming soon</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 3, lineHeight: 1.45 }}>{description}</div>
        {enabled && !disabled && children && (
          <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 10 }}>
            {children}
          </div>
        )}
      </div>
      {!disabled && (
        <span style={{ width: 36, height: 20, borderRadius: 'var(--radius-full)', background: enabled ? 'var(--brand-fg)' : 'var(--surface-raised)', border: '1px solid var(--border-strong)', position: 'relative', flexShrink: 0, marginTop: 1, transition: 'background 150ms' }}>
          <span style={{ position: 'absolute', top: 2, left: enabled ? 18 : 2, width: 14, height: 14, borderRadius: '50%', background: enabled ? 'white' : 'var(--text-faint)', transition: 'left 150ms', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
        </span>
      )}
    </div>
  );
}

function OB_Field({ id, label, value, onChange, placeholder, autoComplete }) {
  return (
    <label htmlFor={id} style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete || 'off'}
        style={{ minWidth: 0, height: 34, border: '1px solid var(--border)', background: 'var(--surface-raised)', color: 'var(--text-body)', borderRadius: 'var(--radius-sm)', padding: '0 9px', fontFamily: 'var(--font-mono)', fontSize: 11 }}
      />
    </label>
  );
}

function OB_Onboarding({ onDone }) {
  const [vaultPath, setVaultPath]     = React.useState('');
  const [vaultErr, setVaultErr]       = React.useState('');
  const [owner, setOwner]             = React.useState('');
  const [tenant, setTenant]           = React.useState('');
  const [scope, setScope]             = React.useState('');
  const [identityErr, setIdentityErr] = React.useState('');
  const [hooksClaude, setHooksClaude] = React.useState(false);
  const [scanFiles, setScanFiles]     = React.useState(false);
  const [scanTier, setScanTier]       = React.useState('');
  const [openWizards, setOpenWizards] = React.useState(false);
  const [saving, setSaving]           = React.useState(false);

  const pickVault = async () => {
    setVaultErr('');
    try {
      if (!window.lore?.pickVault) { setVaultErr('Folder picker not available.'); return; }
      const td = await window.lore.pickVault();
      if (td && td.root) setVaultPath(td.root);
    } catch { setVaultErr('Could not open folder picker.'); }
  };

  // Build the config object shared by both Skip and Finish.
  const buildCfg = () => {
    const isFull = scanFiles && scanTier === 'full';
    return {
      saga: null,
      tier: scanFiles ? (scanTier || null) : null,
      full: isFull,
      promptHistory: isFull,
      roots: vaultPath ? [vaultPath] : [],
      excludes: OB_EXCLUDE_DEFAULTS.slice(),
      extensions: OB_EXT_DEFAULTS,
      maxFiles: isFull ? OB_MAXFILES_FULL : OB_MAXFILES_DEFAULT,
      maxBytes: OB_MAXBYTES,
      scope: scope.trim() || null,
      owner: owner.trim() || null,
      tenant: tenant.trim() || null,
      sync: false,
      onboardedAt: new Date().toISOString(),
    };
  };

  // Skip keeps everything unset. No scan starts unless the user explicitly enables one.
  const handleSkip = async () => {
    setSaving(true);
    const cfg = buildCfg();
    if (window.lore?.config?.set) { try { await window.lore.config.set(cfg); } catch { /* non-fatal */ } }
    setSaving(false);
    onDone(cfg, { scan: false });
  };

  // Finish: persist chosen vault + selected backfill options, run selected backfills, then onDone.
  // Passes { scan, openWizards } so handleOnboardingDone skips the scrape if scan=false.
  const handleFinish = async () => {
    setVaultErr('');
    setIdentityErr('');
    if (scanFiles && !vaultPath) {
      setVaultErr('Choose a vault before scanning files.');
      return;
    }
    if (hooksClaude && !scope.trim()) {
      setIdentityErr('Claude Code capture needs a scope. Add one or turn off the hook for now.');
      return;
    }
    setSaving(true);
    const cfg = buildCfg();
    if (window.lore?.config?.set) { try { await window.lore.config.set(cfg); } catch { /* non-fatal */ } }
    if (hooksClaude && cfg.scope && window.lore?.hooks?.install) {
      try { await window.lore.hooks.install({ tool: 'claude', scope: cfg.scope }); } catch { /* non-fatal */ }
    }
    setSaving(false);
    onDone(cfg, { scan: scanFiles, openWizards });
  };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--backdrop)', backdropFilter: 'blur(var(--backdrop-blur))' }}>
      <div style={{ width: 560, maxHeight: '92vh', display: 'flex', flexDirection: 'column', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)', overflow: 'hidden' }}>

        {/* Hero */}
        <div style={{ padding: '32px 32px 22px', textAlign: 'center', background: 'var(--surface-inset)', borderBottom: '1px solid var(--divider)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 16 }}>
            <img src="design/assets/logo/logomark.svg" alt="Lore" style={{ width: 36, height: 36 }}
              onError={(e) => { e.target.style.display = 'none'; }} />
            <img src="design/assets/sprites/lore-familiar.png" alt="" style={{ width: 56, height: 56, objectFit: 'contain', filter: 'drop-shadow(0 4px 14px rgba(0,0,0,0.32))' }}
              onError={(e) => { e.target.style.display = 'none'; }} />
          </div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--text-strong)', margin: '0 0 6px' }}>Welcome to Lore</h1>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-subtle)' }}>Your local knowledge OS.</p>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '22px 28px', display: 'flex', flexDirection: 'column', gap: 22 }}>

          {/* Vault — Obsidian-style vault-first picker */}
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>Vault</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-body)', lineHeight: 1.55 }}>Choose a folder to use as your vault. Lore indexes and links everything inside it.</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <OB_Button variant="secondary" icon="folder-open" onClick={pickVault}>Choose folder…</OB_Button>
                {vaultPath ? (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--brand-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{vaultPath}</span>
                ) : (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>none selected</span>
                )}
              </div>
              {vaultErr && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--clay-400)' }}>{vaultErr}</span>}
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.5 }}>
                Skipping leaves the vault unset. You can configure it later in Settings.
              </div>
            </div>
          </div>

          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>Identity</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <OB_Field id="ob-owner" label="Owner" value={owner} onChange={(v) => { setOwner(v); setIdentityErr(''); }} placeholder="none" />
                <OB_Field id="ob-tenant" label="Tenant" value={tenant} onChange={(v) => { setTenant(v); setIdentityErr(''); }} placeholder="none" />
                <OB_Field id="ob-scope" label="Scope" value={scope} onChange={(v) => { setScope(v); setIdentityErr(''); }} placeholder="none" />
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.5 }}>Leave these blank to keep identity unset. Ask, Graph, Hooks, and Import need tenant + scope later.</div>
              {identityErr && <div role="alert" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--clay-400)', lineHeight: 1.5 }}>{identityErr}</div>}
            </div>
          </div>

          {/* Backfill sources */}
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>
              Backfill sources <span style={{ color: 'var(--text-faint)', textTransform: 'none', letterSpacing: 0 }}>— all optional</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

              {/* 1. Connect Claude Code */}
              <OB_SourceCard
                icon="terminal"
                title="Connect Claude Code"
                description="Auto-capture every Claude Code session into Lore."
                enabled={hooksClaude}
                onToggle={() => setHooksClaude((v) => !v)}
              />

              {/* 2. Scan files & folders — inline tier picker when enabled */}
              <OB_SourceCard
                icon="hard-drive"
                title="Scan my files & folders"
                description="Index your vault so Lore can answer questions about your work."
                enabled={scanFiles}
                onToggle={() => setScanFiles((v) => {
                  const next = !v;
                  if (next && !scanTier) setScanTier('standard');
                  return next;
                })}
              >
                <OB_TierChips tier={scanTier} onTier={setScanTier} />
              </OB_SourceCard>

              {/* 3. Install knowledge bases — sets a flag to open Wizard store after setup */}
              <OB_SourceCard
                icon="book-open"
                title="Install knowledge bases"
                description="Browse Wizards — curated knowledge packs for frameworks, docs, and team playbooks."
                enabled={openWizards}
                onToggle={() => setOpenWizards((v) => !v)}
              />

              {/* 4. Connect apps — disabled / coming soon */}
              <OB_SourceCard
                icon="plug"
                title="Connect apps"
                description="Gmail, Drive, Slack, and 250+ integrations."
                enabled={false}
                onToggle={() => {}}
                disabled
                comingSoon
              />
            </div>
          </div>
        </div>

        {/* Footer — Skip (ghost, prominent) + Finish setup (primary) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 28px', borderTop: '1px solid var(--divider)', background: 'var(--surface-raised)', flexShrink: 0 }}>
          <OB_Button variant="ghost" disabled={saving} onClick={handleSkip}>Skip</OB_Button>
          <div style={{ flex: 1 }} />
          <OB_Button variant="primary" icon="zap" disabled={saving} onClick={handleFinish}>
            {saving ? 'Setting up…' : 'Finish setup'}
          </OB_Button>
        </div>
      </div>
    </div>
  );
}

window.LoreOnboarding = OB_Onboarding;
