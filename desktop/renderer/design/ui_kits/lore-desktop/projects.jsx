/* global React */
// Lore desktop — Teams (create/join a team, invites inbox, team-shared Wizards) + knowledge graph
const prNS = window.VaultDesignSystem_ffbf58;
const { Icon: PrIcon, Card, ScopeTag: PrScope, Badge: PrBadge, Button: PrButton, Tabs: PrTabs } = prNS;

const prS = {
  wrap: { flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--surface-canvas)' },
  head: { display: 'flex', alignItems: 'center', gap: 12, padding: '22px 28px 0' },
  body: { padding: '18px 28px 60px', maxWidth: 1040, margin: '0 auto' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 },
};

function TeamsView({ config, onConfig, buckets, onOpenWizard, pendingInvites, inviteBusy, onAcceptInvite, onRefreshInvites }) {
  const [tab, setTab] = React.useState('teams');
  const [authUser, setAuthUser] = React.useState(null); // {user_id, email, scopes} | null
  const [busy, setBusy] = React.useState('');            // '' | 'create' | 'join' | 'invite'
  const [error, setError] = React.useState('');
  const [createInput, setCreateInput] = React.useState(false);
  const [teamDraft, setTeamDraft] = React.useState('');
  const [inviteEmail, setInviteEmail] = React.useState('');
  const [inviteStatus, setInviteStatus] = React.useState('');

  React.useEffect(() => {
    let alive = true;
    if (window.lore?.auth?.status) {
      window.lore.auth.status().then((u) => { if (alive) setAuthUser(u || null); }).catch(() => {});
    }
    return () => { alive = false; };
  }, []);

  const team = (config && config.team && config.team.team_id) ? config.team : null;
  const teamScopes = (authUser && Array.isArray(authUser.scopes)) ? authUser.scopes : [];
  const inTeam = Boolean(team) || teamScopes.length > 0;
  const teamLabel = (team && (team.name || team.team_id)) || teamScopes[0] || 'Your team';
  const invites = pendingInvites || [];
  const teamWizards = (buckets || []).filter((b) => b.scope === 'team' || b.scope === 'enterprise');
  const WizardCard = window.LoreWizardParts && window.LoreWizardParts.BucketCard;

  const inpStyle = {
    padding: '5px 9px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)',
    background: 'var(--surface-inset)', color: 'var(--text-strong)',
    fontFamily: 'var(--font-sans)', fontSize: 13, outline: 'none', minWidth: 180,
  };

  // Signs in via the Google loopback flow if there is no session yet; returns the user or null.
  const ensureSignedIn = async () => {
    if (authUser) return authUser;
    if (!window.lore?.auth?.login) { setError('Sign-in is unavailable in this build.'); return null; }
    const r = await window.lore.auth.login();
    if (!r || !r.ok) { setError((r && r.reason) || 'Sign-in failed.'); return null; }
    const user = { user_id: r.user_id, email: r.email, scopes: r.scopes || [] };
    setAuthUser(user);
    return user;
  };

  // Create team: sign in first if needed, create the team server-side, then persist the
  // team into config (same shape the onboarding team step writes) so it survives restarts.
  const handleCreate = async () => {
    const name = teamDraft.trim();
    if (!name) return;
    setBusy('create'); setError('');
    try {
      const user = await ensureSignedIn();
      if (!user) {
        // Sign-in unavailable/failed (e.g. no Google OAuth client in this
        // build): don't dead-end — save the team locally as an INTENT. The
        // server-side team + invites activate when sign-in works; the name
        // and choice survive restarts either way.
        const teamCfg = { intent: 'create', name, pending: 'sign-in' };
        if (window.lore.config?.set) {
          try { const next = await window.lore.config.set({ team: teamCfg }); if (onConfig) onConfig(next); } catch { /* non-fatal */ }
        }
        setCreateInput(false); setTeamDraft('');
        setError(`Team "${name}" saved locally — team sync and invites activate once sign-in is available.`);
        setBusy('');
        return;
      }
      const res = await window.lore.teams.create(name);
      if (!res || !res.ok) { setError((res && res.body && res.body.detail) || 'Could not create the team.'); setBusy(''); return; }
      const teamCfg = { intent: 'create', name, team_id: res.body.team_id, scope: res.body.scope, ...(user.email ? { email: user.email } : {}) };
      if (window.lore.config?.set) {
        try { const next = await window.lore.config.set({ team: teamCfg }); if (onConfig) onConfig(next); } catch { /* non-fatal */ }
      }
      setCreateInput(false); setTeamDraft('');
      if (window.lore.auth?.status) { try { setAuthUser((await window.lore.auth.status()) || user); } catch { /* keep current */ } }
    } catch (e) { setError(String((e && e.message) || e)); }
    setBusy('');
  };

  // Join team: sign in, then refresh the invites inbox — accepting a pending invite is
  // how you actually join (there is no join-by-name endpoint).
  const handleJoin = async () => {
    setBusy('join'); setError('');
    try {
      const user = await ensureSignedIn();
      if (user && onRefreshInvites) await onRefreshInvites();
    } catch (e) { setError(String((e && e.message) || e)); }
    setBusy('');
  };

  const handleInvite = async () => {
    const email = inviteEmail.trim();
    if (!email || !team) return;
    setBusy('invite'); setInviteStatus('');
    try {
      const res = await window.lore.teams.invite(team.team_id, email);
      if (res && res.ok) { setInviteStatus(`Invite sent to ${email}.`); setInviteEmail(''); }
      else setInviteStatus((res && res.body && res.body.detail) || 'Could not send the invite.');
    } catch (e) { setInviteStatus(String((e && e.message) || e)); }
    setBusy('');
  };

  const invitesInbox = invites.length > 0 && (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <PrIcon name="mail" size={15} style={{ color: 'var(--brand-fg)' }} />
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)' }}>Pending invites</span>
        <PrBadge tone="info">{invites.length}</PrBadge>
      </div>
      {invites.map((inv) => (
        <div key={inv.invite_id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-body)' }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <strong style={{ color: 'var(--text-strong)' }}>{inv.team_name || inv.team_id}</strong>
            {inv.invited_by ? <span style={{ color: 'var(--text-subtle)' }}> · invited by {inv.invited_by}</span> : null}
          </span>
          <PrButton variant="primary" icon="check" disabled={inviteBusy === inv.invite_id} onClick={() => onAcceptInvite && onAcceptInvite(inv.invite_id)}>
            {inviteBusy === inv.invite_id ? 'Joining…' : 'Accept'}
          </PrButton>
        </div>
      ))}
    </Card>
  );

  const wizardsTabLabel = inTeam ? 'Team Wizards' : (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: 0.55 }}>
      <PrIcon name="lock" size={12} />Team Wizards
    </span>
  );

  return (
    <div style={prS.wrap}>
      <div style={prS.head}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-3xl)', fontWeight: 600, color: 'var(--text-strong)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>Teams
            {window.LoreHelpHint && <window.LoreHelpHint size={16} tip="A Team is a shared space. Sign in, create or join one, and Wizards pushed to the team become visible to everyone on it." />}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: '4px 0 0' }}>Create or join a team to share Wizards and ask across shared knowledge.</p>
        </div>
        <div style={{ flex: 1 }} />
      </div>
      <div style={prS.body}>
        <div style={{ marginBottom: 18 }}>
          <PrTabs value={tab} onChange={setTab} tabs={[
            { value: 'teams', label: 'Teams', ...(invites.length ? { count: invites.length } : {}) },
            { value: 'wizards', label: wizardsTabLabel, ...(inTeam ? { count: teamWizards.length } : {}) },
          ]} />
        </div>

        {tab === 'teams' && !inTeam && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '32px 0' }}>
            <Card style={{ width: 'min(520px, 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '36px 32px', textAlign: 'center', boxSizing: 'border-box' }}>
              <span style={{ width: 52, height: 52, borderRadius: 'var(--radius-md)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)' }}>
                <PrIcon name="users" size={26} style={{ color: 'var(--brand-fg)' }} />
              </span>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-strong)' }}>Join a team or create a team</div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--text-subtle)', maxWidth: 380 }}>Teams share Wizards — knowledge bases your whole team can browse and ask across. Sign in with Google to get started.</p>
              {!createInput ? (
                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                  <PrButton variant="primary" icon="plus" disabled={Boolean(busy)} onClick={() => { setCreateInput(true); setTeamDraft(''); setError(''); }}>Create team</PrButton>
                  <PrButton variant="secondary" icon="log-in" disabled={Boolean(busy)} onClick={handleJoin}>{busy === 'join' ? 'Opening browser…' : 'Join a team'}</PrButton>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <input autoFocus value={teamDraft} onChange={(e) => setTeamDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreateInput(false); }}
                    placeholder="Team name…" style={inpStyle} />
                  <PrButton variant="primary" size="sm" disabled={busy === 'create'} onClick={handleCreate}>{busy === 'create' ? 'Creating…' : 'Create'}</PrButton>
                  <PrButton variant="ghost" size="sm" onClick={() => setCreateInput(false)}>Cancel</PrButton>
                </div>
              )}
              {authUser && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>
                  Signed in as {authUser.email}{invites.length === 0 ? ' — no pending invites yet. Ask a teammate to invite you.' : ''}
                </div>
              )}
              {error && <div style={{ fontSize: 12, color: 'var(--clay-400)', fontFamily: 'var(--font-mono)' }}>{error}</div>}
            </Card>
            {invitesInbox && <div style={{ width: 'min(520px, 100%)' }}>{invitesInbox}</div>}
          </div>
        )}

        {tab === 'teams' && inTeam && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Card style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--scope-team-bg)' }}>
                <PrIcon name="users" size={20} style={{ color: 'var(--scope-team-fg)' }} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-strong)' }}>{teamLabel}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                  {(authUser && authUser.email) || (team && team.email) || 'signed out'}
                  {teamScopes.length ? ` · ${teamScopes.length} shared space${teamScopes.length !== 1 ? 's' : ''}` : ''}
                </div>
              </div>
              <PrScope scope="team" />
            </Card>
            {teamScopes.length > 0 && (
              <Card style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Shared spaces</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {teamScopes.map((s) => <PrBadge key={s} tone="info">{s}</PrBadge>)}
                </div>
              </Card>
            )}
            {team && (
              <Card style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <PrIcon name="user-plus" size={15} style={{ color: 'var(--brand-fg)' }} />
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)' }}>Invite a teammate</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleInvite(); }}
                    placeholder="teammate@example.com" type="email" style={{ ...inpStyle, flex: 1 }} />
                  <PrButton variant="primary" size="sm" icon="send" disabled={busy === 'invite'} onClick={handleInvite}>{busy === 'invite' ? 'Sending…' : 'Send invite'}</PrButton>
                </div>
                {inviteStatus && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>{inviteStatus}</div>}
              </Card>
            )}
            {invitesInbox}
            {error && <div style={{ fontSize: 12, color: 'var(--clay-400)', fontFamily: 'var(--font-mono)' }}>{error}</div>}
          </div>
        )}

        {tab === 'wizards' && (!inTeam ? (
          <div style={{ padding: '56px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <PrIcon name="lock" size={30} style={{ color: 'var(--text-faint)', opacity: 0.6 }} />
            <span style={{ fontSize: 14, color: 'var(--text-subtle)' }}>Join a team to share Wizards</span>
            <PrButton variant="secondary" icon="users" onClick={() => setTab('teams')}>Go to Teams</PrButton>
          </div>
        ) : (
          teamWizards.length > 0 && WizardCard ? (
            <div style={prS.grid}>
              {teamWizards.map((b) => <WizardCard key={b.id} b={b} onOpen={() => onOpenWizard && onOpenWizard(b)} />)}
            </div>
          ) : (
            <div style={{ padding: '40px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <PrIcon name="library" size={28} style={{ color: 'var(--text-faint)', opacity: 0.5 }} />
              <span style={{ fontSize: 13, color: 'var(--text-subtle)', maxWidth: 420, textAlign: 'center', lineHeight: 1.5 }}>No team Wizards yet. Wizards pushed to the team show up here for everyone in {teamLabel}.</span>
            </div>
          )
        ))}
      </div>
    </div>
  );
}

const SCOPE_FILL = { team: 'var(--jade-500)', enterprise: 'var(--azure-500)', private: 'var(--obsidian-400)' };
function prScopeFill(scope) { return SCOPE_FILL[scope] || 'var(--brand-fg)'; }

function GraphView({ graph, onOpen }) {
  const [hover, setHover] = React.useState(null);
  const [sel, setSel] = React.useState(graph.nodes[0] ? graph.nodes[0].id : null);
  const scopes = React.useMemo(() => {
    const out = [], seen = new Set();
    for (const n of graph.nodes || []) {
      const s = n.scope ? String(n.scope).trim() : '';
      if (!s) continue;
      const key = s.toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push(s); }
    }
    return out;
  }, [graph]);
  const [filters, setFilters] = React.useState({});
  React.useEffect(() => {
    setFilters((prev) => {
      const next = {};
      for (const s of scopes) next[s] = prev[s] !== false;
      return next;
    });
  }, [scopes.join('\u0000')]);
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  const neighbors = React.useMemo(() => {
    const s = new Set();
    if (sel) graph.edges.forEach(([a, b]) => { if (a === sel) s.add(b); if (b === sel) s.add(a); });
    return s;
  }, [sel, graph]);
  const visible = (id) => byId[id] && (!byId[id].scope || filters[byId[id].scope] !== false);
  const focus = hover || sel;
  const selNode = sel && byId[sel];

  return (
    <div style={{ flex: 1, minWidth: 0, position: 'relative', background: 'var(--surface-canvas)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 18, left: 22, zIndex: 2 }}>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-strong)', margin: 0 }}>Knowledge graph</h2>
        <p style={{ fontSize: 12.5, color: 'var(--text-subtle)', margin: '3px 0 0' }}>{graph.nodes.length} notes · {graph.edges.length} links you can see</p>
      </div>
      <div style={{ position: 'absolute', top: 18, right: 22, zIndex: 2, display: 'flex', gap: 8 }}>
        {scopes.map((k) => (
          <button key={k} onClick={() => setFilters((f) => ({ ...f, [k]: f[k] === false }))} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', cursor: 'pointer',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-full)',
            background: filters[k] !== false ? 'var(--surface-raised)' : 'transparent',
            opacity: filters[k] !== false ? 1 : 0.45, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)',
          }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: prScopeFill(k) }} />{k}
          </button>
        ))}
      </div>

      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
        {graph.edges.map(([a, b], i) => {
          if (!visible(a) || !visible(b)) return null;
          const na = byId[a], nb = byId[b];
          const lit = focus && (focus === a || focus === b);
          return <line key={i} x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
            stroke={lit ? 'var(--graph-edge)' : 'var(--border-strong)'} strokeWidth={lit ? 0.6 : 0.3}
            opacity={focus && !lit ? 0.4 : 1} />;
        })}
        {graph.nodes.map((n) => {
          if (!visible(n.id)) return null;
          const lit = focus === n.id;
          const near = focus && (neighbors.has(n.id) || focus === n.id);
          const dim = focus && !near;
          return (
            <g key={n.id} style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
              onClick={() => setSel(n.id)} onDoubleClick={() => onOpen && onOpen(n.id)}>
              {sel === n.id && <circle cx={n.x} cy={n.y} r={n.r / 4 + 3.4} fill="none" stroke="var(--brand-bg)" strokeWidth={0.6} />}
              <circle cx={n.x} cy={n.y} r={n.r / 4 + 1.6} fill={prScopeFill(n.scope)} stroke="var(--surface-canvas)" strokeWidth={0.5}
                opacity={dim ? 0.4 : 1} />
              <text x={n.x} y={n.y + n.r / 4 + 4.6} textAnchor="middle"
                style={{ fontFamily: 'var(--font-sans)', fontSize: 2.5, fontWeight: lit ? 600 : 500, fill: lit ? 'var(--text-strong)' : 'var(--text-muted)', opacity: dim ? 0.5 : 1 }}>{n.label}</text>
            </g>
          );
        })}
      </svg>

      {selNode && (
        <div style={{ position: 'absolute', right: 18, bottom: 18, width: 240, padding: 14, background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <PrIcon name="file-text" size={15} style={{ color: 'var(--brand-fg)' }} />
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>{selNode.label}</span>
            <PrScope scope={selNode.scope} size="sm" showLabel={false} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)', marginBottom: 12 }}>
            <span>{selNode.owner}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><PrIcon name="link-2" size={11} />{selNode.links} links</span>
            <span>{selNode.updated}</span>
          </div>
          <PrButton variant="secondary" size="sm" icon="arrow-up-right" fullWidth onClick={() => onOpen && onOpen(selNode.id)}>Open note</PrButton>
        </div>
      )}
    </div>
  );
}

// NOTE: the old SVG GraphView above is dead code — the canvas GraphView in
// graph.jsx owns window.LoreGraphView now (removed here so mount order can't
// silently swap implementations). Full deletion tracked for the cleanup pass.
Object.assign(window, { LoreTeamsView: TeamsView });
