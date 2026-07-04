/* global React */
// Lore desktop — Home tab (the memory-first landing view).
// Greeting + "Lore remembers N things" line, an ask input that reuses the
// existing Ask machinery (answers open the side panel), personalized prompt
// chips (suggestPrompts — deterministic, no LLM), and the this-week digest
// (backend /digest: day × section groups, title-based summary lines).
const hmNS = window.VaultDesignSystem_ffbf58;
const { Icon: HmIcon, Button: HmButton } = hmNS;

function HM_greeting(name) {
  const h = new Date().getHours();
  const part = h < 5 ? 'evening' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  const who = String(name || '').trim().split(/\s+/)[0];
  return `Good ${part}${who ? `, ${who}` : ''}`;
}

function HM_dayLabel(dayIso) {
  const today = new Date();
  const d = new Date(dayIso + 'T00:00:00');
  const diff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

function HomeView({ config, tenant, identityReady, prompts, onAsk, onSetup, chat, chatActive }) {
  const [stats, setStats] = React.useState(null);      // {notes, chunks, edges}
  const [digest, setDigest] = React.useState(null);    // {rows, sinceYesterday, total}
  const [backup, setBackup] = React.useState(null);    // backup:status result
  const [draft, setDraft] = React.useState('');

  React.useEffect(() => {
    let live = true;
    (async () => {
      try { const s = window.lore?.stats ? await window.lore.stats(tenant) : null; if (live) setStats(s); } catch { /* engine starting */ }
      try { const d = window.lore?.digest ? await window.lore.digest(tenant, 7) : null; if (live) setDigest(d); } catch { /* engine starting */ }
      try { const b = window.lore?.backup?.status ? await window.lore.backup.status() : null; if (live) setBackup(b); } catch { /* non-fatal */ }
    })();
    return () => { live = false; };
  }, [tenant]);

  const submit = (q) => {
    const v = (q ?? draft).trim();
    if (!v) return;
    setDraft('');
    onAsk(v);
  };

  const remembered = stats && typeof stats.notes === 'number' ? stats.notes : null;
  const fresh = digest && typeof digest.sinceYesterday === 'number' ? digest.sinceYesterday : 0;
  const backedUp = backup && backup.enabled && backup.ok !== false && backup.lastRun;
  const rows = (digest && digest.rows) || [];

  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--surface-canvas)' }}>
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '9vh 28px 80px' }}>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-3xl)', fontWeight: 600, color: 'var(--text-strong)', margin: '0 0 6px' }}>
          {HM_greeting(config && config.owner)}
        </h1>
        <div style={{ fontSize: 13, color: 'var(--text-subtle)', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {remembered === null
            ? <span>Memory engine is starting…</span>
            : <span>
                Lore remembers <strong style={{ color: 'var(--text-body)' }}>{remembered.toLocaleString()}</strong> thing{remembered === 1 ? '' : 's'} for you
                {fresh > 0 ? ` · ${fresh} new since yesterday` : ''}
                {backedUp ? ' · backed up ✓' : ''}
              </span>}
        </div>

        {chat || null}
        {!identityReady && (
          <div style={{ margin: '14px 0' }}>
            <HmButton variant="secondary" icon="settings" onClick={onSetup}>Finish setup</HmButton>
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
            <HmIcon name="calendar-days" size={13} style={{ color: 'var(--text-faint)' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>This week</span>
          </div>
          {rows.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-faint)', lineHeight: 1.6 }}>
              Nothing new this week yet — new and changed notes show up here, grouped by day.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {rows.slice(0, 12).map((r, i) => (
                <div key={`${r.day}-${r.section}`} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 2px', borderTop: i === 0 ? 'none' : '1px solid var(--divider)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)', width: 74, flexShrink: 0 }}>{HM_dayLabel(r.day)}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-body)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <strong style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{r.section}</strong>
                    <span style={{ color: 'var(--text-subtle)' }}>: {(r.topTitles || []).join(', ')}{r.count > (r.topTitles || []).length ? ` +${r.count - r.topTitles.length} more` : ''}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 12, lineHeight: 1.5 }}>
            when teams join, this shows who worked on what, per team
          </div>
        </div>
      </div>
    </div>
  );
}

window.LoreHomeView = HomeView;
