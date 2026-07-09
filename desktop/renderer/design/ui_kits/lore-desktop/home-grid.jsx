/* global React */
// Lore desktop — Hybrid home: greeting, Ask hero, getting-started checklist,
// section header, page cards grid, per-place empty states, Team gate.
const hgNS = window.VaultDesignSystem_ffbf58;
const HgIcon = hgNS.Icon;

function hgAgo(ms) {
  if (!ms || !Number.isFinite(ms)) return null;
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return `${Math.round(s / (86400 * 30))}mo ago`;
}

function hgGreeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function HgButton({ icon, children, onClick, variant, style: extra }) {
  const [hover, setHover] = React.useState(false);
  const base = variant === 'primary'
    ? { background: hover ? 'var(--brand-bg-hover)' : 'var(--brand-bg)', color: 'var(--text-onbrand)', border: '1px solid transparent' }
    : variant === 'success'
      ? { background: 'var(--place-team-solid)', color: 'var(--place-team-on-solid)', border: '1px solid transparent', filter: hover ? 'brightness(1.08)' : 'none' }
      : variant === 'amber-ghost'
        ? { background: hover ? 'rgba(217,154,43,0.2)' : 'var(--brand-soft-bg)', color: 'var(--brand-fg)', border: '1px solid var(--brand-soft-border)' }
        : { background: 'transparent', color: 'var(--text-primary)', border: `1px solid ${hover ? 'var(--border-strong)' : 'var(--border)'}` };
  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 34,
        padding: '0 14px', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-sans)',
        fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', ...base, ...(extra || {}),
      }}>
      {icon && <HgIcon name={icon} size={15} />}
      {children}
    </button>
  );
}

// Amber-gradient Ask hero — inline input + suggestion chips, feeds the real ask().
function AskHero({ suggestions, onAsk }) {
  const [q, setQ] = React.useState('');
  const submit = () => { const v = q.trim(); if (!v) return; setQ(''); onAsk(v); };
  return (
    <div style={{
      border: '1px solid var(--brand-soft-border)', borderRadius: 14, padding: '18px 20px',
      background: 'linear-gradient(180deg, rgba(217,154,43,0.07), rgba(217,154,43,0.02))',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)' }}>
          <HgIcon name="sparkles" size={17} style={{ color: 'var(--brand-fg)' }} />
        </span>
        <input value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="Ask anything about your pages…"
          style={{ flex: 1, minWidth: 0, height: 36, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-canvas)', color: 'var(--text-strong)', fontFamily: 'var(--font-sans)', fontSize: 13.5, outline: 'none' }} />
        <HgButton variant="primary" icon="sparkles" onClick={submit}>Ask</HgButton>
      </div>
      {suggestions && suggestions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {suggestions.slice(0, 3).map((s) => (
            <button key={s} onClick={() => onAsk(s)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 999,
              border: '1px solid var(--border)', background: 'var(--surface-panel)', cursor: 'pointer',
              color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', fontSize: 12,
            }}>
              <HgIcon name="message-circle-question" size={12} />{s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// 4-step getting-started checklist with amber progress bar. Steps + dismissal
// persist via config (wired-app owns the state).
function Checklist({ steps, onGo, onDismiss }) {
  const items = [
    { id: 'imported', label: 'Add your files', icon: 'upload' },
    { id: 'opened', label: 'Open a page', icon: 'file-text' },
    { id: 'asked', label: 'Ask Lore a question', icon: 'sparkles' },
    { id: 'moved', label: 'Move a page to share it', icon: 'corner-up-right' },
  ];
  const done = items.filter((it) => steps[it.id]).length;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', background: 'var(--surface-panel)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)' }}>Getting started</span>
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{done} of {items.length} done</span>
        <div style={{ flex: 1 }} />
        <button onClick={onDismiss} title="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', display: 'inline-flex', padding: 2 }}>
          <HgIcon name="x" size={14} />
        </button>
      </div>
      <div style={{ height: 5, borderRadius: 999, background: 'rgba(127,127,127,0.18)', marginBottom: 12, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${(done / items.length) * 100}%`, background: 'var(--brand-bg)', borderRadius: 999, transition: 'width 400ms cubic-bezier(0.2,0.6,0.2,1)' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
        {items.map((it) => {
          const isDone = Boolean(steps[it.id]);
          return (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{
                width: 21, height: 21, borderRadius: '50%', flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: isDone ? 'var(--brand-bg)' : 'transparent',
                border: isDone ? '1px solid transparent' : '1px solid var(--border-strong)',
              }}>
                {isDone && <HgIcon name="check" size={12} style={{ color: 'var(--text-onbrand)' }} />}
              </span>
              <span style={{ flex: 1, fontSize: 12.5, color: isDone ? 'var(--text-faint)' : 'var(--text-body)', textDecoration: isDone ? 'line-through' : 'none' }}>{it.label}</span>
              {!isDone && onGo && (
                <button onClick={() => onGo(it.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--brand-fg)', fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 600, padding: 0 }}>Go</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PageCard({ note, section, sectionColor, snippet, fresh, placeMeta, place, owner, editor, onOpen, onChat }) {
  const [hover, setHover] = React.useState(false);
  const updated = hgAgo(note.mtimeMs);
  // On Team/Company pages, reveal who owns the page and who last touched it
  // (greyed) on hover — you're looking at shared work, so authorship matters.
  const showByline = (place === 'team' || place === 'company') && (owner || editor);
  return (
    <div onClick={onOpen} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', flexDirection: 'column', gap: 7, minHeight: 118, padding: '13px 14px',
        borderRadius: 12, cursor: 'pointer',
        border: `1px solid ${hover ? (placeMeta ? placeMeta.border : 'var(--border-strong)') : 'var(--border)'}`,
        background: hover ? 'var(--surface-raised)' : 'var(--surface-panel)',
        transition: 'border-color 100ms ease, background 100ms ease',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 16 }}>
        {section && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-subtle)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2.5, background: sectionColor || 'var(--text-faint)', flexShrink: 0 }} />
            {section}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {fresh && (
          <span style={{ fontSize: 10.5, fontWeight: 600, color: placeMeta ? placeMeta.fg : 'var(--brand-fg)', background: placeMeta ? placeMeta.tint : 'var(--brand-soft-bg)', borderRadius: 999, padding: '1px 8px' }}>Moved just now</span>
        )}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)', lineHeight: 1.35 }}>{note.name}</div>
      <div style={{
        flex: 1, fontSize: 12, color: 'var(--text-subtle)', lineHeight: 1.5,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>{snippet || ''}</div>
      {showByline && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          fontSize: 10.5, color: 'var(--text-faint)',
          opacity: hover ? 1 : 0, maxHeight: hover ? 20 : 0, overflow: 'hidden',
          transition: 'opacity 120ms ease, max-height 120ms ease',
        }}>
          {owner && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title={`Created by ${owner}`}>
              <HgIcon name="user" size={10} />{owner}
            </span>
          )}
          {editor && editor !== owner && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title={`Last edited by ${editor}`}>
              <HgIcon name="pencil" size={10} />{editor}
            </span>
          )}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{updated ? `Updated ${updated}` : ''}</span>
        <div style={{ flex: 1 }} />
        <button onClick={(e) => { e.stopPropagation(); onChat(); }} style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999,
          border: '1px solid var(--brand-soft-border)', background: 'var(--brand-soft-bg)',
          color: 'var(--brand-fg)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 11.5, fontWeight: 600,
          opacity: hover ? 1 : 0.75,
        }}>
          <HgIcon name="sparkles" size={11} />Chat
        </button>
      </div>
    </div>
  );
}

// Centered card shown on the Team place before a team exists.
function TeamGate({ onCreateTeam, onJoinTeam, invites, inviteBusy, onAcceptInvite, busy, error }) {
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState('');
  const meta = window.LorePlaceMeta.team;
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{
        width: 'min(460px, 100%)', borderRadius: 16, border: '1px solid var(--border)',
        background: 'var(--surface-panel)', padding: '30px 28px', display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 14, textAlign: 'center',
      }}>
        <span style={{ width: 54, height: 54, borderRadius: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: meta.tint, border: `1px solid ${meta.border}` }}>
          <HgIcon name="users" size={26} style={{ color: meta.fg }} />
        </span>
        <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-strong)' }}>Team is where shared pages live</div>
        <div style={{ fontSize: 13, color: 'var(--text-subtle)', lineHeight: 1.55, maxWidth: 360 }}>
          Create a team and every page you move here becomes readable by your teammates — nothing is shared until you move it.
        </div>
        {(invites || []).length > 0 && (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 }}>
            {invites.map((iv) => (
              <div key={iv.invite_id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', borderRadius: 10, border: `1px solid ${meta.border}`, background: meta.tint }}>
                <HgIcon name="mail" size={14} style={{ color: meta.fg, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left', fontSize: 12.5, color: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Invite to <strong>{iv.team_name || iv.team_id}</strong>
                </span>
                <HgButton variant="success" onClick={() => onAcceptInvite(iv.invite_id)} style={{ height: 28, fontSize: 12 }}>
                  {inviteBusy === iv.invite_id ? 'Joining…' : 'Accept'}
                </HgButton>
              </div>
            ))}
          </div>
        )}
        {creating ? (
          <div style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 360 }}>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onCreateTeam(name.trim()); if (e.key === 'Escape') setCreating(false); }}
              placeholder="Team name…"
              style={{ flex: 1, minWidth: 0, height: 34, padding: '0 11px', border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--surface-canvas)', color: 'var(--text-strong)', fontFamily: 'var(--font-sans)', fontSize: 13, outline: 'none' }} />
            <HgButton variant="success" onClick={() => name.trim() && onCreateTeam(name.trim())}>{busy ? 'Creating…' : 'Create'}</HgButton>
            <HgButton onClick={() => setCreating(false)}>Cancel</HgButton>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <HgButton variant="success" icon="users" onClick={() => setCreating(true)}>Create our team</HgButton>
            <HgButton icon="mail" onClick={onJoinTeam}>I have an invite</HgButton>
          </div>
        )}
        {error && <div style={{ fontSize: 12, color: 'var(--danger-fg)', maxWidth: 380, lineHeight: 1.5 }}>{error}</div>}
      </div>
    </div>
  );
}

// Soft variant of the Team gate — shown when Team pages already exist locally
// but no team is set up yet, so sharing isn't actually live.
function TeamSetupBanner({ onCreateTeam, onJoinTeam, busy, error }) {
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState('');
  const meta = window.LorePlaceMeta.team;
  return (
    <div style={{ border: `1px solid ${meta.border}`, background: meta.tint, borderRadius: 12, padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <HgIcon name="users" size={16} style={{ color: meta.fg, flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 220, fontSize: 12.5, color: 'var(--text-body)', lineHeight: 1.5 }}>
        These pages are marked Team, but you haven’t set up a team yet — teammates can’t see them until you do.
      </span>
      {creating ? (
        <span style={{ display: 'inline-flex', gap: 7 }}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onCreateTeam(name.trim()); if (e.key === 'Escape') setCreating(false); }}
            placeholder="Team name…"
            style={{ width: 160, height: 30, padding: '0 10px', border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--surface-canvas)', color: 'var(--text-strong)', fontFamily: 'var(--font-sans)', fontSize: 12.5, outline: 'none' }} />
          <HgButton variant="success" onClick={() => name.trim() && onCreateTeam(name.trim())} style={{ height: 30, fontSize: 12 }}>{busy ? 'Creating…' : 'Create'}</HgButton>
        </span>
      ) : (
        <span style={{ display: 'inline-flex', gap: 7 }}>
          <HgButton variant="success" icon="users" onClick={() => setCreating(true)} style={{ height: 30, fontSize: 12 }}>Create our team</HgButton>
          <HgButton icon="mail" onClick={onJoinTeam} style={{ height: 30, fontSize: 12 }}>I have an invite</HgButton>
        </span>
      )}
      {error && <span style={{ width: '100%', fontSize: 11.5, color: 'var(--danger-fg)' }}>{error}</span>}
    </div>
  );
}

function HomeGrid({
  place, theme, ownerName, totalCount, newCount,
  suggestions, onAsk,
  checklist, onChecklistGo, onChecklistDismiss,
  sectionFilter, notes, noteMeta, baseOf, freshIds,
  onOpen, onChat, onNewPage, onAddFiles,
  teamGate,  // null | {onCreateTeam,onJoinTeam,invites,inviteBusy,onAcceptInvite,busy,error} — full gate (no team pages yet)
  teamSetup, // null | same handlers — soft banner (team pages exist but no team)
}) {
  const meta = window.LorePlaceMeta[place] || window.LorePlaceMeta.my;
  if (teamGate) return <TeamGate {...teamGate} />;

  const heading = sectionFilter && sectionFilter !== 'all' ? sectionFilter : meta.label;
  const showChecklist = place === 'my' && checklist && !checklist.dismissed
    && !(checklist.imported && checklist.opened && checklist.asked && checklist.moved);
  const emptyCopy = {
    my: { title: 'No pages here yet', body: 'Add files or create a page — everything in My Notes stays on this computer until you move it.' },
    team: { title: 'Nothing shared with the team yet', body: 'Move a page here and your teammates can read it.' },
    company: { title: 'Nothing company-wide yet', body: 'Move a page here to share it with everyone at the company.' },
  }[place];

  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--surface-canvas)' }}>
      <div style={{ maxWidth: 1060, margin: '0 auto', padding: '26px 30px 80px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {place === 'my' && (
          <div>
            <h1 style={{ fontSize: 23, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text-strong)', margin: 0 }}>
              {hgGreeting()}{ownerName ? `, ${ownerName}` : ''}
            </h1>
            <div style={{ fontSize: 13, color: 'var(--text-subtle)', marginTop: 5 }}>
              Lore keeps {totalCount} page{totalCount === 1 ? '' : 's'} for you{newCount > 0 ? ` — ${newCount} new since yesterday` : ''}.
            </div>
          </div>
        )}

        <AskHero suggestions={suggestions} onAsk={onAsk} />

        {teamSetup && <TeamSetupBanner {...teamSetup} />}

        {showChecklist && <Checklist steps={checklist} onGo={onChecklistGo} onDismiss={onChecklistDismiss} />}

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-strong)', margin: 0 }}>{heading}</h2>
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{notes.length} page{notes.length === 1 ? '' : 's'}</span>
          <div style={{ flex: 1 }} />
          <HgButton icon="file-plus-2" onClick={onNewPage} style={{ height: 30, fontSize: 12.5 }}>New page</HgButton>
        </div>

        {notes.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '48px 0', textAlign: 'center' }}>
            <span style={{ width: 46, height: 46, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: meta.tint, border: `1px solid ${meta.border}` }}>
              <HgIcon name={meta.icon} size={22} style={{ color: meta.fg }} />
            </span>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--text-strong)' }}>{emptyCopy.title}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', maxWidth: 380, lineHeight: 1.55 }}>{emptyCopy.body}</div>
            {place === 'my' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <HgButton variant="primary" icon="upload" onClick={onAddFiles}>Add files</HgButton>
                <HgButton icon="file-plus-2" onClick={onNewPage}>New page</HgButton>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12 }}>
            {notes.map((n) => {
              const section = baseOf ? baseOf(n.id) : null;
              return (
                <PageCard key={n.id} note={n} place={place}
                  section={sectionFilter && sectionFilter !== 'all' ? null : section}
                  sectionColor={section && window.LoreSectionColor ? window.LoreSectionColor(section, theme) : null}
                  snippet={noteMeta && noteMeta[n.id] ? noteMeta[n.id].snippet : ''}
                  owner={noteMeta && noteMeta[n.id] ? noteMeta[n.id].owner : null}
                  editor={noteMeta && noteMeta[n.id] ? noteMeta[n.id].editor : null}
                  fresh={freshIds && freshIds.has(n.id)} placeMeta={meta}
                  onOpen={() => onOpen(n.id)} onChat={() => onChat(n.id)} />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { LoreHomeGrid: HomeGrid });
