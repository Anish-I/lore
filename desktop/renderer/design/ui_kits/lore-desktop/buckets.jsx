/* global React */
// Lore desktop — Buckets: shared knowledge collections pooled across vaults
const bkNS = window.VaultDesignSystem_ffbf58;
const { Icon: BkIcon, Card: BkCard, ScopeTag: BkScope, Avatar: BkAvatar, Badge: BkBadge, Button: BkButton, Tabs: BkTabs } = bkNS;

const bkS = {
  wrap: { flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--surface-canvas)' },
  head: { display: 'flex', alignItems: 'center', gap: 12, padding: '22px 28px 0' },
  body: { padding: '18px 28px 60px', maxWidth: 1040, margin: '0 auto' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 },
};

function Recall({ value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <div style={{ width: 54, height: 5, borderRadius: 'var(--radius-full)', background: 'var(--surface-inset)', overflow: 'hidden' }}>
        <div style={{ width: (value * 100) + '%', height: '100%', background: 'var(--jade-500)', borderRadius: 'var(--radius-full)' }} />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}>recall {value.toFixed(2)}</span>
    </div>
  );
}

function BucketCard({ b, onOpen }) {
  return (
    <BkCard interactive onClick={() => onOpen && onOpen(b)} style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)' }}>
          <BkIcon name="library" size={17} style={{ color: 'var(--brand-fg)' }} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--text-strong)' }}>{b.name}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)', marginTop: 1 }}>{b.group} · {b.notes} notes</div>
        </div>
        <BkScope scope={b.scope} size="sm" showLabel={false} />
      </div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)', minHeight: 38 }}>{b.desc}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {b.topics.map((t) => <BkBadge key={t} tone="info">#{t}</BkBadge>)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
        <div style={{ display: 'flex' }}>
          {b.contributors.slice(0, 4).map((m, i) => (
            <div key={m} style={{ marginLeft: i ? -7 : 0, border: '2px solid var(--surface-panel)', borderRadius: '50%' }}><BkAvatar name={m} size={22} /></div>
          ))}
          {b.contributors.length > 4 && <span style={{ marginLeft: 4, alignSelf: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>+{b.contributors.length - 4}</span>}
        </div>
        <div style={{ flex: 1 }} />
        <Recall value={b.recall} />
      </div>
    </BkCard>
  );
}

function BucketsView({ buckets, onAsk }) {
  const [tab, setTab] = React.useState('all');
  const shown = tab === 'all' ? buckets : buckets.filter((b) => tab === 'mine' ? b.scope === 'private' : b.scope === tab);
  return (
    <div style={bkS.wrap}>
      <div style={bkS.head}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-3xl)', fontWeight: 600, color: 'var(--text-strong)', margin: 0 }}>Buckets</h1>
          <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: '4px 0 0' }}>Shared knowledge collections your team pools and asks across.</p>
        </div>
        <div style={{ flex: 1 }} />
        <BkButton variant="secondary" icon="sparkles" onClick={onAsk}>Ask all buckets</BkButton>
        <BkButton variant="primary" icon="plus">New bucket</BkButton>
      </div>
      <div style={bkS.body}>
        <div style={{ marginBottom: 18 }}>
          <BkTabs value={tab} onChange={setTab} tabs={[
            { value: 'all', label: 'All', count: buckets.length },
            { value: 'team', label: 'Team' },
            { value: 'enterprise', label: 'Enterprise' },
            { value: 'mine', label: 'Private' },
          ]} />
        </div>
        <div style={bkS.grid}>
          {shown.map((b) => <BucketCard key={b.id} b={b} onOpen={() => {}} />)}
        </div>
      </div>
    </div>
  );
}

window.LoreBucketsView = BucketsView;
