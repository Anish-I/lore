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
  const base = variant === 'primary' ?
  { background: hover ? 'var(--brand-bg-hover)' : 'var(--brand-bg)', color: 'var(--text-onbrand)', border: '1px solid transparent' } :
  variant === 'success' ?
  { background: 'var(--place-team-solid)', color: 'var(--place-team-on-solid)', border: '1px solid transparent', filter: hover ? 'brightness(1.08)' : 'none' } :
  variant === 'amber-ghost' ?
  { background: hover ? 'rgba(217,154,43,0.2)' : 'var(--brand-soft-bg)', color: 'var(--brand-fg)', border: '1px solid var(--brand-soft-border)' } :
  { background: 'transparent', color: 'var(--text-primary)', border: `1px solid ${hover ? 'var(--border-strong)' : 'var(--border)'}` };
  return (/*#__PURE__*/
    React.createElement("button", { onClick: onClick, onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
      style: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 34,
        padding: '0 14px', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-sans)',
        fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', ...base, ...(extra || {})
      } },
    icon && /*#__PURE__*/React.createElement(HgIcon, { name: icon, size: 15 }),
    children
    ));

}

// Amber-gradient Ask hero — inline input + suggestion chips, feeds the real ask().
function AskHero({ suggestions, onAsk }) {
  const [q, setQ] = React.useState('');
  const submit = () => {const v = q.trim();if (!v) return;setQ('');onAsk(v);};
  return (/*#__PURE__*/
    React.createElement("div", { style: {
        border: '1px solid var(--brand-soft-border)', borderRadius: 14, padding: '18px 20px',
        background: 'linear-gradient(180deg, rgba(217,154,43,0.07), rgba(217,154,43,0.02))',
        display: 'flex', flexDirection: 'column', gap: 12
      } }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 10 } }, /*#__PURE__*/
    React.createElement("span", { style: { width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)' } }, /*#__PURE__*/
    React.createElement(HgIcon, { name: "sparkles", size: 17, style: { color: 'var(--brand-fg)' } })
    ), /*#__PURE__*/
    React.createElement("input", { value: q, onChange: (e) => setQ(e.target.value),
      onKeyDown: (e) => {if (e.key === 'Enter') submit();},
      placeholder: "Ask anything about your pages\u2026",
      style: { flex: 1, minWidth: 0, height: 36, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-canvas)', color: 'var(--text-strong)', fontFamily: 'var(--font-sans)', fontSize: 13.5, outline: 'none' } }), /*#__PURE__*/
    React.createElement(HgButton, { variant: "primary", icon: "sparkles", onClick: submit }, "Ask")
    ),
    suggestions && suggestions.length > 0 && /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 7 } },
    suggestions.slice(0, 3).map((s) => /*#__PURE__*/
    React.createElement("button", { key: s, onClick: () => onAsk(s), style: {
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 999,
        border: '1px solid var(--border)', background: 'var(--surface-panel)', cursor: 'pointer',
        color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', fontSize: 12
      } }, /*#__PURE__*/
    React.createElement(HgIcon, { name: "message-circle-question", size: 12 }), s
    )
    )
    )

    ));

}

// 4-step getting-started checklist with amber progress bar. Steps + dismissal
// persist via config (wired-app owns the state).
function Checklist({ steps, onGo, onDismiss }) {
  const items = [
  { id: 'imported', label: 'Add your files', icon: 'upload' },
  { id: 'opened', label: 'Open a page', icon: 'file-text' },
  { id: 'asked', label: 'Ask Lore a question', icon: 'sparkles' },
  { id: 'moved', label: 'Move a page to share it', icon: 'corner-up-right' }];

  const done = items.filter((it) => steps[it.id]).length;
  return (/*#__PURE__*/
    React.createElement("div", { style: { border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', background: 'var(--surface-panel)' } }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 } }, /*#__PURE__*/
    React.createElement("span", { style: { fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)' } }, "Getting started"), /*#__PURE__*/
    React.createElement("span", { style: { fontSize: 12, color: 'var(--text-faint)' } }, done, " of ", items.length, " done"), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1 } }), /*#__PURE__*/
    React.createElement("button", { onClick: onDismiss, title: "Dismiss", style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', display: 'inline-flex', padding: 2 } }, /*#__PURE__*/
    React.createElement(HgIcon, { name: "x", size: 14 })
    )
    ), /*#__PURE__*/
    React.createElement("div", { style: { height: 5, borderRadius: 999, background: 'rgba(127,127,127,0.18)', marginBottom: 12, overflow: 'hidden' } }, /*#__PURE__*/
    React.createElement("div", { style: { height: '100%', width: `${done / items.length * 100}%`, background: 'var(--brand-bg)', borderRadius: 999, transition: 'width 400ms cubic-bezier(0.2,0.6,0.2,1)' } })
    ), /*#__PURE__*/
    React.createElement("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 } },
    items.map((it) => {
      const isDone = Boolean(steps[it.id]);
      return (/*#__PURE__*/
        React.createElement("div", { key: it.id, style: { display: 'flex', alignItems: 'center', gap: 9 } }, /*#__PURE__*/
        React.createElement("span", { style: {
            width: 21, height: 21, borderRadius: '50%', flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: isDone ? 'var(--brand-bg)' : 'transparent',
            border: isDone ? '1px solid transparent' : '1px solid var(--border-strong)'
          } },
        isDone && /*#__PURE__*/React.createElement(HgIcon, { name: "check", size: 12, style: { color: 'var(--text-onbrand)' } })
        ), /*#__PURE__*/
        React.createElement("span", { style: { flex: 1, fontSize: 12.5, color: isDone ? 'var(--text-faint)' : 'var(--text-body)', textDecoration: isDone ? 'line-through' : 'none' } }, it.label),
        !isDone && onGo && /*#__PURE__*/
        React.createElement("button", { onClick: () => onGo(it.id), style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--brand-fg)', fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 600, padding: 0 } }, "Go")

        ));

    })
    )
    ));

}

function PageCard({ note, section, sectionColor, snippet, fresh, placeMeta, onOpen, onChat }) {
  const [hover, setHover] = React.useState(false);
  const updated = hgAgo(note.mtimeMs);
  return (/*#__PURE__*/
    React.createElement("div", { onClick: onOpen, onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
      style: {
        display: 'flex', flexDirection: 'column', gap: 7, minHeight: 118, padding: '13px 14px',
        borderRadius: 12, cursor: 'pointer',
        border: `1px solid ${hover ? placeMeta ? placeMeta.border : 'var(--border-strong)' : 'var(--border)'}`,
        background: hover ? 'var(--surface-raised)' : 'var(--surface-panel)',
        transition: 'border-color 100ms ease, background 100ms ease'
      } }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 7, minHeight: 16 } },
    section && /*#__PURE__*/
    React.createElement("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-subtle)' } }, /*#__PURE__*/
    React.createElement("span", { style: { width: 8, height: 8, borderRadius: 2.5, background: sectionColor || 'var(--text-faint)', flexShrink: 0 } }),
    section
    ), /*#__PURE__*/

    React.createElement("div", { style: { flex: 1 } }),
    fresh && /*#__PURE__*/
    React.createElement("span", { style: { fontSize: 10.5, fontWeight: 600, color: placeMeta ? placeMeta.fg : 'var(--brand-fg)', background: placeMeta ? placeMeta.tint : 'var(--brand-soft-bg)', borderRadius: 999, padding: '1px 8px' } }, "Moved just now")

    ), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 14, fontWeight: 600, color: 'var(--text-strong)', lineHeight: 1.35 } }, note.name), /*#__PURE__*/
    React.createElement("div", { style: {
        flex: 1, fontSize: 12, color: 'var(--text-subtle)', lineHeight: 1.5,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
      } }, snippet || ''), /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8 } }, /*#__PURE__*/
    React.createElement("span", { style: { fontSize: 11, color: 'var(--text-faint)' } }, updated ? `Updated ${updated}` : ''), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1 } }), /*#__PURE__*/
    React.createElement("button", { onClick: (e) => {e.stopPropagation();onChat();}, style: {
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999,
        border: '1px solid var(--brand-soft-border)', background: 'var(--brand-soft-bg)',
        color: 'var(--brand-fg)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 11.5, fontWeight: 600,
        opacity: hover ? 1 : 0.75
      } }, /*#__PURE__*/
    React.createElement(HgIcon, { name: "sparkles", size: 11 }), "Chat"
    )
    )
    ));

}

// Centered card shown on the Team place before a team exists.
function TeamGate({ onCreateTeam, onJoinTeam, invites, inviteBusy, onAcceptInvite, busy, error }) {
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState('');
  const meta = window.LorePlaceMeta.team;
  return (/*#__PURE__*/
    React.createElement("div", { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 } }, /*#__PURE__*/
    React.createElement("div", { style: {
        width: 'min(460px, 100%)', borderRadius: 16, border: '1px solid var(--border)',
        background: 'var(--surface-panel)', padding: '30px 28px', display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 14, textAlign: 'center'
      } }, /*#__PURE__*/
    React.createElement("span", { style: { width: 54, height: 54, borderRadius: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: meta.tint, border: `1px solid ${meta.border}` } }, /*#__PURE__*/
    React.createElement(HgIcon, { name: "users", size: 26, style: { color: meta.fg } })
    ), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 17, fontWeight: 600, color: 'var(--text-strong)' } }, "Team is where shared pages live"), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 13, color: 'var(--text-subtle)', lineHeight: 1.55, maxWidth: 360 } }, "Create a team and every page you move here becomes readable by your teammates \u2014 nothing is shared until you move it."

    ),
    (invites || []).length > 0 && /*#__PURE__*/
    React.createElement("div", { style: { width: '100%', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 } },
    invites.map((iv) => /*#__PURE__*/
    React.createElement("div", { key: iv.invite_id, style: { display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', borderRadius: 10, border: `1px solid ${meta.border}`, background: meta.tint } }, /*#__PURE__*/
    React.createElement(HgIcon, { name: "mail", size: 14, style: { color: meta.fg, flexShrink: 0 } }), /*#__PURE__*/
    React.createElement("span", { style: { flex: 1, minWidth: 0, textAlign: 'left', fontSize: 12.5, color: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, "Invite to ", /*#__PURE__*/
    React.createElement("strong", null, iv.team_name || iv.team_id)
    ), /*#__PURE__*/
    React.createElement(HgButton, { variant: "success", onClick: () => onAcceptInvite(iv.invite_id), style: { height: 28, fontSize: 12 } },
    inviteBusy === iv.invite_id ? 'Joining…' : 'Accept'
    )
    )
    )
    ),

    creating ? /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', gap: 8, width: '100%', maxWidth: 360 } }, /*#__PURE__*/
    React.createElement("input", { autoFocus: true, value: name, onChange: (e) => setName(e.target.value),
      onKeyDown: (e) => {if (e.key === 'Enter' && name.trim()) onCreateTeam(name.trim());if (e.key === 'Escape') setCreating(false);},
      placeholder: "Team name\u2026",
      style: { flex: 1, minWidth: 0, height: 34, padding: '0 11px', border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--surface-canvas)', color: 'var(--text-strong)', fontFamily: 'var(--font-sans)', fontSize: 13, outline: 'none' } }), /*#__PURE__*/
    React.createElement(HgButton, { variant: "success", onClick: () => name.trim() && onCreateTeam(name.trim()) }, busy ? 'Creating…' : 'Create'), /*#__PURE__*/
    React.createElement(HgButton, { onClick: () => setCreating(false) }, "Cancel")
    ) : /*#__PURE__*/

    React.createElement("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' } }, /*#__PURE__*/
    React.createElement(HgButton, { variant: "success", icon: "users", onClick: () => setCreating(true) }, "Create our team"), /*#__PURE__*/
    React.createElement(HgButton, { icon: "mail", onClick: onJoinTeam }, "I have an invite")
    ),

    error && /*#__PURE__*/React.createElement("div", { style: { fontSize: 12, color: 'var(--danger-fg)', maxWidth: 380, lineHeight: 1.5 } }, error)
    )
    ));

}

// Soft variant of the Team gate — shown when Team pages already exist locally
// but no team is set up yet, so sharing isn't actually live.
function TeamSetupBanner({ onCreateTeam, onJoinTeam, busy, error }) {
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState('');
  const meta = window.LorePlaceMeta.team;
  return (/*#__PURE__*/
    React.createElement("div", { style: { border: `1px solid ${meta.border}`, background: meta.tint, borderRadius: 12, padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } }, /*#__PURE__*/
    React.createElement(HgIcon, { name: "users", size: 16, style: { color: meta.fg, flexShrink: 0 } }), /*#__PURE__*/
    React.createElement("span", { style: { flex: 1, minWidth: 220, fontSize: 12.5, color: 'var(--text-body)', lineHeight: 1.5 } }, "These pages are marked Team, but you haven\u2019t set up a team yet \u2014 teammates can\u2019t see them until you do."

    ),
    creating ? /*#__PURE__*/
    React.createElement("span", { style: { display: 'inline-flex', gap: 7 } }, /*#__PURE__*/
    React.createElement("input", { autoFocus: true, value: name, onChange: (e) => setName(e.target.value),
      onKeyDown: (e) => {if (e.key === 'Enter' && name.trim()) onCreateTeam(name.trim());if (e.key === 'Escape') setCreating(false);},
      placeholder: "Team name\u2026",
      style: { width: 160, height: 30, padding: '0 10px', border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--surface-canvas)', color: 'var(--text-strong)', fontFamily: 'var(--font-sans)', fontSize: 12.5, outline: 'none' } }), /*#__PURE__*/
    React.createElement(HgButton, { variant: "success", onClick: () => name.trim() && onCreateTeam(name.trim()), style: { height: 30, fontSize: 12 } }, busy ? 'Creating…' : 'Create')
    ) : /*#__PURE__*/

    React.createElement("span", { style: { display: 'inline-flex', gap: 7 } }, /*#__PURE__*/
    React.createElement(HgButton, { variant: "success", icon: "users", onClick: () => setCreating(true), style: { height: 30, fontSize: 12 } }, "Create our team"), /*#__PURE__*/
    React.createElement(HgButton, { icon: "mail", onClick: onJoinTeam, style: { height: 30, fontSize: 12 } }, "I have an invite")
    ),

    error && /*#__PURE__*/React.createElement("span", { style: { width: '100%', fontSize: 11.5, color: 'var(--danger-fg)' } }, error)
    ));

}

function HomeGrid({
  place, theme, ownerName, totalCount, newCount,
  suggestions, onAsk,
  checklist, onChecklistGo, onChecklistDismiss,
  sectionFilter, notes, noteMeta, baseOf, freshIds,
  onOpen, onChat, onNewPage, onAddFiles,
  teamGate, // null | {onCreateTeam,onJoinTeam,invites,inviteBusy,onAcceptInvite,busy,error} — full gate (no team pages yet)
  teamSetup // null | same handlers — soft banner (team pages exist but no team)
}) {
  const meta = window.LorePlaceMeta[place] || window.LorePlaceMeta.my;
  if (teamGate) return /*#__PURE__*/React.createElement(TeamGate, teamGate);

  const heading = sectionFilter && sectionFilter !== 'all' ? sectionFilter : meta.label;
  const showChecklist = place === 'my' && checklist && !checklist.dismissed &&
  !(checklist.imported && checklist.opened && checklist.asked && checklist.moved);
  const emptyCopy = {
    my: { title: 'No pages here yet', body: 'Add files or create a page — everything in My Notes stays on this computer until you move it.' },
    team: { title: 'Nothing shared with the team yet', body: 'Move a page here and your teammates can read it.' },
    company: { title: 'Nothing company-wide yet', body: 'Move a page here to share it with everyone at the company.' }
  }[place];

  return (/*#__PURE__*/
    React.createElement("div", { style: { flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--surface-canvas)' } }, /*#__PURE__*/
    React.createElement("div", { style: { maxWidth: 1060, margin: '0 auto', padding: '26px 30px 80px', display: 'flex', flexDirection: 'column', gap: 18 } },
    place === 'my' && /*#__PURE__*/
    React.createElement("div", null, /*#__PURE__*/
    React.createElement("h1", { style: { fontSize: 23, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text-strong)', margin: 0 } },
    hgGreeting(), ownerName ? `, ${ownerName}` : ''
    ), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 13, color: 'var(--text-subtle)', marginTop: 5 } }, "Lore keeps ",
    totalCount, " page", totalCount === 1 ? '' : 's', " for you", newCount > 0 ? ` — ${newCount} new since yesterday` : '', "."
    )
    ), /*#__PURE__*/


    React.createElement(AskHero, { suggestions: suggestions, onAsk: onAsk }),

    teamSetup && /*#__PURE__*/React.createElement(TeamSetupBanner, teamSetup),

    showChecklist && /*#__PURE__*/React.createElement(Checklist, { steps: checklist, onGo: onChecklistGo, onDismiss: onChecklistDismiss }), /*#__PURE__*/

    React.createElement("div", { style: { display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 } }, /*#__PURE__*/
    React.createElement("h2", { style: { fontSize: 17, fontWeight: 600, color: 'var(--text-strong)', margin: 0 } }, heading), /*#__PURE__*/
    React.createElement("span", { style: { fontSize: 12, color: 'var(--text-faint)' } }, notes.length, " page", notes.length === 1 ? '' : 's'), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1 } }), /*#__PURE__*/
    React.createElement(HgButton, { icon: "file-plus-2", onClick: onNewPage, style: { height: 30, fontSize: 12.5 } }, "New page")
    ),

    notes.length === 0 ? /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '48px 0', textAlign: 'center' } }, /*#__PURE__*/
    React.createElement("span", { style: { width: 46, height: 46, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: meta.tint, border: `1px solid ${meta.border}` } }, /*#__PURE__*/
    React.createElement(HgIcon, { name: meta.icon, size: 22, style: { color: meta.fg } })
    ), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 14.5, fontWeight: 600, color: 'var(--text-strong)' } }, emptyCopy.title), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 12.5, color: 'var(--text-subtle)', maxWidth: 380, lineHeight: 1.55 } }, emptyCopy.body),
    place === 'my' && /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', gap: 8, marginTop: 4 } }, /*#__PURE__*/
    React.createElement(HgButton, { variant: "primary", icon: "upload", onClick: onAddFiles }, "Add files"), /*#__PURE__*/
    React.createElement(HgButton, { icon: "file-plus-2", onClick: onNewPage }, "New page")
    )

    ) : /*#__PURE__*/

    React.createElement("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12 } },
    notes.map((n) => {
      const section = baseOf ? baseOf(n.id) : null;
      return (/*#__PURE__*/
        React.createElement(PageCard, { key: n.id, note: n,
          section: sectionFilter && sectionFilter !== 'all' ? null : section,
          sectionColor: section && window.LoreSectionColor ? window.LoreSectionColor(section, theme) : null,
          snippet: noteMeta && noteMeta[n.id] ? noteMeta[n.id].snippet : '',
          fresh: freshIds && freshIds.has(n.id), placeMeta: meta,
          onOpen: () => onOpen(n.id), onChat: () => onChat(n.id) }));

    })
    )

    )
    ));

}

Object.assign(window, { LoreHomeGrid: HomeGrid });