/* global React */
// Lore desktop — Projects & Groups browser + knowledge graph
const prNS = window.VaultDesignSystem_ffbf58;
const { Icon: PrIcon, IconButton: PrIconBtn, Card, ScopeTag: PrScope, Avatar: PrAvatar, Badge: PrBadge, Button: PrButton, Tabs: PrTabs } = prNS;

const prS = {
  wrap: { flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--surface-canvas)' },
  head: { display: 'flex', alignItems: 'center', gap: 12, padding: '22px 28px 0' },
  body: { padding: '18px 28px 60px', maxWidth: 1040, margin: '0 auto' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 },
};

function MemberStack({ members }) {
  return (
    <div style={{ display: 'flex' }}>
      {members.slice(0, 3).map((m, i) => (
        <div key={m} style={{ marginLeft: i ? -7 : 0, border: '2px solid var(--surface-panel)', borderRadius: '50%' }}>
          <PrAvatar name={m} size={22} />
        </div>
      ))}
      {members.length > 3 && <span style={{ marginLeft: 4, alignSelf: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>+{members.length - 3}</span>}
    </div>
  );
}

function ProjectsView({ projects, groups, onOpen }) {
  const [tab, setTab] = React.useState('projects');
  return (
    <div style={prS.wrap}>
      <div style={prS.head}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-3xl)', fontWeight: 600, color: 'var(--text-strong)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>Sagas
            {window.LoreHelpHint && <window.LoreHelpHint size={16} tip="A Saga is a project — a body of work with a goal (e.g. Wingman, Kalshi Bot). A note belongs to ONE Saga. Contrast with a Wizard (knowledge base): a cross-project collection a note can appear in many of." />}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: '4px 0 0' }}>Focused workspaces that gather notes, people, and an Ask thread.</p>
        </div>
        <div style={{ flex: 1 }} />
        <PrButton variant="primary" icon="plus">New saga</PrButton>
      </div>
      <div style={prS.body}>
        <div style={{ marginBottom: 18 }}>
          <PrTabs value={tab} onChange={setTab} tabs={[
            { value: 'projects', label: 'Sagas', count: projects.length },
            { value: 'groups', label: 'Groups', count: groups.length },
          ]} />
        </div>

        {tab === 'projects' && (
          <div style={prS.grid}>
            {projects.map((p) => (
              <Card key={p.id} interactive onClick={() => onOpen && onOpen(p)} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ width: 30, height: 30, borderRadius: 'var(--radius-sm)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)' }}>
                    <PrIcon name="layout-grid" size={16} style={{ color: 'var(--brand-fg)' }} />
                  </span>
                  <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600, color: 'var(--text-strong)' }}>{p.name}</span>
                  <PrScope scope={p.scope} size="sm" showLabel={false} />
                </div>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)', minHeight: 38 }}>{p.desc}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
                  <MemberStack members={p.members} />
                  <div style={{ flex: 1 }} />
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>
                    <PrIcon name="file-text" size={12} />{p.notes}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>{p.updated}</span>
                </div>
              </Card>
            ))}
          </div>
        )}

        {tab === 'groups' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {groups.map((g) => (
              <Card key={g.id} interactive style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: g.scope === 'enterprise' ? 'var(--scope-ent-bg)' : 'var(--scope-team-bg)' }}>
                  <PrIcon name={g.scope === 'enterprise' ? 'building-2' : 'users'} size={18} style={{ color: g.scope === 'enterprise' ? 'var(--scope-ent-fg)' : 'var(--scope-team-fg)' }} />
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>{g.name}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{g.members} members · {g.vaults} vaults</div>
                </div>
                <PrScope scope={g.scope} />
                <PrButton variant="ghost" iconTrailing="chevron-right">Open</PrButton>
              </Card>
            ))}
          </div>
        )}
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
        <p style={{ fontSize: 12.5, color: 'var(--text-subtle)', margin: '3px 0 0' }}>{graph.nodes.length} notes · {graph.edges.length} links in your scope</p>
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

Object.assign(window, { LoreProjectsView: ProjectsView, LoreGraphView: GraphView });
