/* global React */
// Lore desktop - Buckets: shared knowledge collections pooled across libraries
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

function BkStars({ value, onRate }) {
  const [hover, setHover] = React.useState(0);
  return (
    <span style={{ display: 'inline-flex', gap: 1 }}>
      {[1, 2, 3, 4, 5].map((s) => (
        <span key={s} onMouseEnter={() => onRate && setHover(s)} onMouseLeave={() => setHover(0)} onClick={(e) => { e.stopPropagation(); onRate && onRate(s); }}
          style={{ cursor: onRate ? 'pointer' : 'default', display: 'inline-flex', color: (hover || value) >= s ? 'var(--amber-400)' : 'var(--text-faint)' }}>
          <BkIcon name="star" size={13} />
        </span>
      ))}
    </span>
  );
}

function WizardStoreCard({ w, onInstall, onRate }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <BkCard style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)' }}>
          <BkIcon name="sparkles" size={16} style={{ color: 'var(--brand-fg)' }} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--text-strong)' }}>{w.name}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}>{w.author} · {w.noteCount} notes</div>
        </div>
        <BkScope scope={w.scope} size="sm" showLabel={false} />
      </div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)', minHeight: 38 }}>{w.desc}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{(w.topics || []).slice(0, 4).map((t) => <BkBadge key={t} tone="info">#{t}</BkBadge>)}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
        <BkStars value={w.myRating || Math.round(w.rating || 0)} onRate={(s) => onRate(w.id, s)} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}>{w.rating} · {(w.installs || 0).toLocaleString()}</span>
        <div style={{ flex: 1 }} />
        {w.installed
          ? <BkBadge tone="success" dot>installed</BkBadge>
          : <BkButton variant="primary" size="sm" icon={busy ? 'loader' : 'download'} onClick={async () => { setBusy(true); await onInstall(w.id); setBusy(false); }}>{busy ? 'Installing…' : 'Install'}</BkButton>}
      </div>
    </BkCard>
  );
}

function WizardStore({ onChanged }) {
  const [catalog, setCatalog] = React.useState(null);
  const [q, setQ] = React.useState('');
  const [cat, setCat] = React.useState('all');
  const [shown, setShown] = React.useState(40);
  const load = React.useCallback(async () => {
    if (!window.lore || !window.lore.wizards || !window.lore.wizards.catalog) { setCatalog([]); return; }
    try { setCatalog(await window.lore.wizards.catalog()); } catch { setCatalog([]); }
  }, []);
  React.useEffect(() => { load(); }, [load]);
  const install = async (id) => { try { await window.lore.wizards.install(id); } catch { /* */ } await load(); if (onChanged) onChanged(); };
  const rate = async (id, s) => { try { await window.lore.wizards.rate(id, s); } catch { /* */ } load(); };
  if (catalog === null) return <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-faint)', padding: '24px 0' }}>Loading knowledge bases…</div>;
  if (!catalog.length) return null;

  const catOf = (w) => w.kind === 'wizard' ? 'featured' : ((w.topics && w.topics[0]) || 'tool');
  const cats = ['all', 'featured', 'skill', 'mcp', 'marketplace'];
  const ql = q.trim().toLowerCase();
  const filtered = catalog.filter((w) => {
    if (cat !== 'all' && catOf(w) !== cat) return false;
    if (!ql) return true;
    return (w.name + ' ' + (w.desc || '') + ' ' + (w.topics || []).join(' ')).toLowerCase().includes(ql);
  }).sort((a, b) => ((b.kind === 'wizard') - (a.kind === 'wizard')) || ((b.installs || 0) - (a.installs || 0)));
  const visible = filtered.slice(0, shown);
  const chip = (active) => ({ padding: '4px 11px', borderRadius: 'var(--radius-full)', cursor: 'pointer', border: `1px solid ${active ? 'var(--brand-soft-border)' : 'var(--border)'}`, background: active ? 'var(--brand-soft-bg)' : 'var(--surface-inset)', color: active ? 'var(--brand-fg)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'capitalize' });

  return (
    <div style={{ marginTop: 28 }}>
      <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-strong)', margin: '0 0 3px' }}>Discover knowledge bases & tools</h2>
      <p style={{ fontSize: 12.5, color: 'var(--text-subtle)', margin: '0 0 12px' }}>{catalog.length.toLocaleString()} available — curated knowledge bases + tools sourced from the web. Install to add into your library.</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: '1 1 220px', minWidth: 200, padding: '0 10px', height: 32, background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
          <BkIcon name="search" size={14} style={{ color: 'var(--text-faint)' }} />
          <input value={q} onChange={(e) => { setQ(e.target.value); setShown(40); }} placeholder="Search wizards & tools…" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-strong)', fontFamily: 'var(--font-sans)', fontSize: 13 }} />
        </div>
        {cats.map((c) => <button key={c} onClick={() => { setCat(c); setShown(40); }} style={chip(cat === c)}>{c}</button>)}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)', margin: '0 2px 8px' }}>{filtered.length.toLocaleString()} result{filtered.length !== 1 ? 's' : ''}{filtered.length > shown ? ` · showing ${shown}` : ''}</div>
      <div style={bkS.grid}>
        {visible.map((w) => <WizardStoreCard key={w.id} w={w} onInstall={install} onRate={rate} />)}
      </div>
      {filtered.length > shown && (
        <button onClick={() => setShown((s) => s + 60)} style={{ marginTop: 14, width: '100%', padding: '10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-inset)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          Show more · {(filtered.length - shown).toLocaleString()} more
        </button>
      )}
    </div>
  );
}

function BucketsView({ buckets, onAsk, onOpen, onChanged }) {
  const [tab, setTab] = React.useState('all');
  const scopes = React.useMemo(() => {
    const out = [], seen = new Set();
    for (const b of buckets || []) {
      const s = b.scope ? String(b.scope).trim() : '';
      if (!s) continue;
      const key = s.toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push(s); }
    }
    return out;
  }, [buckets]);
  const shown = tab === 'all' ? buckets : buckets.filter((b) => b.scope === tab);
  const tabs = [{ value: 'all', label: 'All', count: buckets.length }, ...scopes.map((s) => ({ value: s, label: s }))];
  return (
    <div style={bkS.wrap}>
      <div style={bkS.head}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-3xl)', fontWeight: 600, color: 'var(--text-strong)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="design/assets/sprites/codex-tome.png" alt="" style={{ width: 28, height: 28, objectFit: 'contain', verticalAlign: 'middle' }} onError={(e) => { e.target.style.display = 'none'; }} />
            Wizards
            {window.LoreHelpHint && <window.LoreHelpHint size={16} tip="A Wizard is a knowledge base — a curated collection of notes pooled across projects that you can ask across (e.g. a Security playbook or Trading strategies). A note can live in many Wizards, unlike a Saga (project) which it belongs to once." />}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: '4px 0 0' }}>Knowledge bases — curated collections you pool notes into and ask across.</p>
        </div>
        <div style={{ flex: 1 }} />
        <BkButton variant="secondary" icon="sparkles" onClick={onAsk}>Ask all wizards</BkButton>
        <BkButton variant="primary" icon="plus">New wizard</BkButton>
      </div>
      <div style={bkS.body}>
        <div style={{ marginBottom: 18 }}>
          <BkTabs value={tab} onChange={setTab} tabs={tabs} />
        </div>
        <div style={bkS.grid}>
          {shown.map((b) => <BucketCard key={b.id} b={b} onOpen={() => onOpen && onOpen(b)} />)}
        </div>
        <WizardStore onChanged={onChanged} />
      </div>
    </div>
  );
}

window.LoreBucketsView = BucketsView;
