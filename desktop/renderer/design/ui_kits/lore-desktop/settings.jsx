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

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <StButton variant="danger" icon="log-out">Sign out</StButton>
        </div>
      </div>
    </div>
  );
}

window.LoreSettingsView = SettingsView;
