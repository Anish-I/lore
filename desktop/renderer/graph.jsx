/* global React */
// Lore desktop — force-directed knowledge graph (Obsidian-style: bouncy, draggable).
// Overrides the static design GraphView with a real d3-force physics simulation.
const grNS = window.VaultDesignSystem_ffbf58;
const { Icon: GrIcon, ScopeTag: GrScope, Button: GrButton } = grNS;
const GR_SCOPE_FILL = { team: 'var(--jade-500)', enterprise: 'var(--azure-500)', private: 'var(--obsidian-400)' };

function GraphView({ graph, onOpen }) {
  const svgRef = React.useRef(null);
  const simRef = React.useRef(null);
  const dragRef = React.useRef(null);
  const [, tick] = React.useReducer((x) => (x + 1) % 1e9, 0);
  const [hover, setHover] = React.useState(null);
  const [sel, setSel] = React.useState(null);
  const [filters, setFilters] = React.useState({ team: true, enterprise: true, private: true });

  // mutable node/link objects (d3 mutates these in place)
  const data = React.useMemo(() => {
    const nodes = graph.nodes.map((n) => ({ ...n, radius: (n.r / 4) + 1.7 }));
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const links = graph.edges.filter(([a, b]) => byId[a] && byId[b]).map(([a, b]) => ({ source: a, target: b }));
    return { nodes, links, byId };
  }, [graph]);

  React.useEffect(() => {
    const d3 = window.d3;
    if (!d3) return;
    const { nodes, links } = data;
    const sim = d3.forceSimulation(nodes)
      .force('charge', d3.forceManyBody().strength(-24).distanceMax(60))
      .force('link', d3.forceLink(links).id((d) => d.id).distance(13).strength(0.5))
      .force('center', d3.forceCenter(50, 50))
      .force('collide', d3.forceCollide((d) => d.radius + 1.6))
      .force('x', d3.forceX(50).strength(0.035))
      .force('y', d3.forceY(50).strength(0.035))
      .alpha(1).alphaDecay(0.015).velocityDecay(0.34);
    sim.on('tick', tick);
    simRef.current = sim;
    return () => { sim.on('tick', null); sim.stop(); };
  }, [data]);

  const focus = hover || sel;
  const neighbors = React.useMemo(() => {
    const s = new Set();
    if (focus) data.links.forEach((l) => {
      const a = l.source.id || l.source, b = l.target.id || l.target;
      if (a === focus) s.add(b); if (b === focus) s.add(a);
    });
    return s;
  }, [focus, data]);

  const toVB = (e) => {
    const svg = svgRef.current; const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: p.x, y: p.y };
  };
  const onMove = (e) => { const n = dragRef.current; if (!n) return; const { x, y } = toVB(e); n.fx = x; n.fy = y; };
  const onUp = () => {
    const n = dragRef.current; if (n) { n.fx = null; n.fy = null; }
    dragRef.current = null;
    if (simRef.current) simRef.current.alphaTarget(0);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  const onDown = (e, n) => {
    e.preventDefault(); e.stopPropagation();
    dragRef.current = n; const { x, y } = toVB(e); n.fx = x; n.fy = y;
    if (simRef.current) simRef.current.alphaTarget(0.3).restart();
    setSel(n.id);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const reheat = () => { if (simRef.current) simRef.current.alpha(0.7).restart(); };

  const visible = (id) => data.byId[id] && filters[data.byId[id].scope];
  const xy = (ref) => (typeof ref === 'object' ? ref : data.byId[ref]);
  const selNode = sel && data.byId[sel];

  return (
    <div style={{ flex: 1, minWidth: 0, position: 'relative', background: 'var(--surface-canvas)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 18, left: 22, zIndex: 2 }}>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-strong)', margin: 0 }}>Knowledge graph</h2>
        <p style={{ fontSize: 12.5, color: 'var(--text-subtle)', margin: '3px 0 0' }}>{data.nodes.length} notes · {data.links.length} links · drag to play</p>
      </div>
      <div style={{ position: 'absolute', top: 18, right: 22, zIndex: 2, display: 'flex', gap: 8, alignItems: 'center' }}>
        {['team', 'enterprise', 'private'].map((k) => (
          <button key={k} onClick={() => setFilters((f) => ({ ...f, [k]: !f[k] }))} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', cursor: 'pointer',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-full)',
            background: filters[k] ? 'var(--surface-raised)' : 'transparent',
            opacity: filters[k] ? 1 : 0.45, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)',
          }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: GR_SCOPE_FILL[k] }} />{k}
          </button>
        ))}
        <button onClick={reheat} title="Shake" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 'var(--radius-full)', background: 'var(--surface-raised)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
          <GrIcon name="sparkles" size={12} />shake
        </button>
      </div>

      <svg ref={svgRef} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"
        onClick={() => setSel(null)}
        style={{ width: '100%', height: '100%', cursor: dragRef.current ? 'grabbing' : 'default', touchAction: 'none' }}>
        {data.links.map((l, i) => {
          const a = xy(l.source), b = xy(l.target);
          if (!a || !b || a.x == null) return null;
          if (!visible(a.id) || !visible(b.id)) return null;
          const lit = focus && (focus === a.id || focus === b.id);
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={lit ? 'var(--graph-edge)' : 'var(--border-strong)'} strokeWidth={lit ? 0.55 : 0.3}
            opacity={focus && !lit ? 0.35 : 0.9} style={{ transition: 'stroke 120ms' }} />;
        })}
        {data.nodes.map((n) => {
          if (n.x == null || !visible(n.id)) return null;
          const lit = focus === n.id;
          const near = focus && (neighbors.has(n.id) || focus === n.id);
          const dim = focus && !near;
          return (
            <g key={n.id} style={{ cursor: 'grab' }}
              onPointerDown={(e) => onDown(e, n)}
              onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
              onDoubleClick={() => onOpen && onOpen(n.id)}>
              {sel === n.id && <circle cx={n.x} cy={n.y} r={n.radius + 1.8} fill="none" stroke="var(--brand-bg)" strokeWidth={0.55} />}
              <circle cx={n.x} cy={n.y} r={n.radius} fill={GR_SCOPE_FILL[n.scope]} stroke="var(--surface-canvas)" strokeWidth={0.5}
                opacity={dim ? 0.4 : 1} />
              <text x={n.x} y={n.y + n.radius + 3} textAnchor="middle"
                style={{ pointerEvents: 'none', fontFamily: 'var(--font-sans)', fontSize: 2.4, fontWeight: lit ? 600 : 500, fill: lit ? 'var(--text-strong)' : 'var(--text-muted)', opacity: dim ? 0.45 : 1 }}>{n.label}</text>
            </g>
          );
        })}
      </svg>

      {selNode && (
        <div style={{ position: 'absolute', right: 18, bottom: 18, width: 240, padding: 14, background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <GrIcon name="file-text" size={15} style={{ color: 'var(--brand-fg)' }} />
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>{selNode.label}</span>
            <GrScope scope={selNode.scope} size="sm" showLabel={false} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)', marginBottom: 12 }}>
            <span>{selNode.owner}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><GrIcon name="link-2" size={11} />{selNode.links} links</span>
            <span>{selNode.updated}</span>
          </div>
          <GrButton variant="secondary" size="sm" icon="arrow-up-right" fullWidth onClick={() => onOpen && onOpen(selNode.id)}>Open note</GrButton>
        </div>
      )}
    </div>
  );
}

window.LoreGraphView = GraphView;
