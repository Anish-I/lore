/* global React */
// Lore desktop — knowledge graph on CANVAS (Obsidian-style: zoom/pan, light, clean).
// Renders the whole graph in one canvas pass per frame (not thousands of SVG nodes),
// with real d3-zoom wheel zoom + pan, degree-scaled nodes, and a sim that sleeps when settled.
const grNS = window.VaultDesignSystem_ffbf58;
const { Icon: GrIcon, ScopeTag: GrScope, Button: GrButton } = grNS;
const GR_SCOPE_VAR = { team: '--jade-500', enterprise: '--azure-500', private: '--obsidian-400' };
function grScopeKey(scope) { return scope == null ? '' : String(scope).trim(); }
function grScopeList(nodes) {
  const out = [], seen = new Set();
  for (const n of nodes || []) {
    const s = grScopeKey(n.scope);
    if (!s) continue;
    const key = s.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(s); }
  }
  return out.sort((a, b) => a.localeCompare(b));
}
function grScopeVar(scope) { return GR_SCOPE_VAR[scope] || '--brand-fg'; }
// Daily-thread / journal notes named by date — hidden by default so topics dominate the graph.
const GR_DATE_RE = /^(session:\s*)?\d{4}[-/]\d{2}[-/]\d{2}/i;

function GraphView({ graph, onOpen }) {
  const wrapRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const simRef = React.useRef(null);
  const zoomRef = React.useRef(null);
  const tRef = React.useRef(null);                 // current d3 zoom transform (CSS-px space)
  const dataRef = React.useRef({ nodes: [], links: [], byId: {} });
  const palRef = React.useRef({});
  const hoverRef = React.useRef(null);
  const dragRef = React.useRef(null);
  const drawRef = React.useRef(null);
  const filtersRef = React.useRef({});
  const selRef = React.useRef(null);

  const graphScopes = React.useMemo(() => grScopeList(graph.nodes), [graph]);

  // Content signature: the heavy simulation effect below rebuilds only when the
  // actual node/edge SET changes, not on every new `graph` object reference — so
  // a parent re-render that produces an identical filtered graph won't restart
  // (and re-scatter) the force layout.
  const graphSig = React.useMemo(() => {
    const ns = graph.nodes || [];
    return ns.length + '|' + ((graph.edges || []).length) + '|' + ns.map((n) => n.id).join(',');
  }, [graph]);
  const [filters, setFilters] = React.useState({});
  React.useEffect(() => {
    setFilters((prev) => {
      const next = {};
      for (const s of graphScopes) next[s] = prev[s] !== false;
      return next;
    });
  }, [graphScopes.join('\u0000')]);
  const [sel, setSel] = React.useState(null);
  // Version-control date scrubber: show only notes created on/before `cutoff` (by updated_at).
  const dateBounds = React.useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const n of (graph.nodes || [])) { const t = Date.parse(n.updated); if (!isNaN(t)) { if (t < lo) lo = t; if (t > hi) hi = t; } }
    if (!isFinite(lo)) { lo = 0; hi = Date.now(); }
    return { lo, hi };
  }, [graph]);
  const [cutoff, setCutoff] = React.useState(dateBounds.hi);
  const cutoffRef = React.useRef(dateBounds.hi);
  React.useEffect(() => { setCutoff(dateBounds.hi); }, [dateBounds]);

  const draw = React.useCallback(() => { if (drawRef.current) drawRef.current(); }, []);

  React.useEffect(() => { filtersRef.current = filters; draw(); }, [filters, draw]);
  React.useEffect(() => { cutoffRef.current = cutoff; draw(); }, [cutoff, draw]);
  React.useEffect(() => { selRef.current = sel; draw(); }, [sel, draw]);

  React.useEffect(() => {
    const d3 = window.d3;
    const cv = canvasRef.current, wrap = wrapRef.current;
    if (!d3 || !cv || !wrap) return;

    // ---- palette from CSS vars (canvas can't use var()) ----
    const readPalette = () => {
      const cs = getComputedStyle(document.documentElement);
      const v = (n, f) => (cs.getPropertyValue(n).trim() || f);
      palRef.current = {
        team: v('--jade-500', '#3fb27f'), enterprise: v('--azure-500', '#4a90d9'),
        private: v('--obsidian-400', '#8b8f9a'),
        custom: v('--brand-fg', '#c9a24b'),
        edge: v('--border-strong', '#2a2d34'), edgeLit: v('--brand-fg', '#c9a24b'),
        text: v('--text-muted', '#9aa0aa'), textStrong: v('--text-strong', '#f0f0f2'),
        brand: v('--brand-fg', '#c9a24b'),
      };
    };
    readPalette();

    // ---- semantic edge kind → color map ----
    const EDGE_KIND_COLORS = {
      depends_on: '#5b8def', supersedes: '#a36bd6', causes: '#e0883a',
      supports: '#3fa85f', contradicts: '#d6504f', implements: '#3fa89a', relates_to: '#888888',
    };
    const STRUCTURAL_KINDS = new Set(['link', 'folder', 'tag', 'topic']);

    // ---- data (d3 mutates node objects in place) ----
    const nodes = graph.nodes.map((n) => ({
      ...n, deg: n.links || 0,
      // importance (0–1) adds up to 4px to the base radius; min 2.4, max 11.
      r: Math.max(2.4, Math.min(11, 2.4 + Math.sqrt(n.links || 0) * 0.9 + (n.importance || 0) * 4)),
    }));
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const links = graph.edges
      .filter(([a, b]) => byId[a] && byId[b])
      // 4th element is confidence weight; default 0.9 when absent (older data or structural).
      .map(([a, b, kind, w]) => ({ source: a, target: b, kind: kind || 'link', weight: w != null ? w : 0.9 }));
    dataRef.current = { nodes, links, byId };

    const dpr = () => window.devicePixelRatio || 1;
    const resize = () => {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      cv.width = Math.max(1, Math.round(w * dpr()));
      cv.height = Math.max(1, Math.round(h * dpr()));
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
    };

    const visible = (n) => {
      if (!n) return false;
      const sc = grScopeKey(n.scope);
      if (sc && filtersRef.current[sc] === false) return false;
      if (GR_DATE_RE.test(n.label || '')) return false;           // date notes are folded into topics → never shown
      const t = Date.parse(n.updated);
      if (!isNaN(t) && t > cutoffRef.current) return false;        // version control: hide notes created after the cutoff
      return true;
    };

    const render = () => {
      const ctx = cv.getContext('2d');
      const t = tRef.current || d3.zoomIdentity;
      const pal = palRef.current;
      const { nodes: ns, links: ls } = dataRef.current;
      const focus = hoverRef.current || selRef.current;
      const nb = new Set();
      if (focus) for (const l of ls) {
        const a = l.source.id || l.source, b = l.target.id || l.target;
        if (a === focus) nb.add(b); if (b === focus) nb.add(a);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.setTransform(dpr() * t.k, 0, 0, dpr() * t.k, dpr() * t.x, dpr() * t.y);

      // edges — semantic kinds get typed color + confidence-scaled opacity/width
      for (const l of ls) {
        const a = l.source, b = l.target;
        if (a.x == null || !visible(a) || !visible(b)) continue;
        const lit = focus && (a.id === focus || b.id === focus);
        const isStructural = STRUCTURAL_KINDS.has(l.kind);
        const kindColor = isStructural ? pal.edge : (EDGE_KIND_COLORS[l.kind] || '#888888');
        const conf = l.weight != null ? l.weight : 0.9;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = lit ? pal.edgeLit : kindColor;
        ctx.globalAlpha = focus ? (lit ? 0.85 : 0.08) : (isStructural ? 0.42 : Math.max(0.15, conf * 0.85));
        ctx.lineWidth = (lit ? 1.3 : (isStructural ? 0.7 : 0.5 + conf * 0.9)) / t.k;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // nodes
      for (const n of ns) {
        if (n.x == null || !visible(n)) continue;
        const near = !focus || nb.has(n.id) || n.id === focus;
        ctx.globalAlpha = near ? 1 : 0.22;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 6.283185);
        ctx.fillStyle = pal[n.scope] || pal.custom || pal.private;
        ctx.fill();
        if (n.id === selRef.current) {
          ctx.lineWidth = 2 / t.k; ctx.strokeStyle = pal.brand; ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // labels — only when zoomed in, or for the focused node + its neighbors
      const showAll = t.k > 1.25;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const n of ns) {
        if (n.x == null || !visible(n)) continue;
        const isFocus = focus && (n.id === focus || nb.has(n.id));
        if (!showAll && !isFocus) continue;
        ctx.globalAlpha = (focus && !isFocus) ? 0.28 : 0.92;
        ctx.fillStyle = n.id === focus ? pal.textStrong : pal.text;
        ctx.font = `${n.id === focus ? 600 : 500} ${11 / t.k}px ui-sans-serif, system-ui, sans-serif`;
        const label = n.label || '';
        ctx.fillText(label.length > 42 ? label.slice(0, 40) + '…' : label, n.x, n.y + n.r + 2 / t.k);
      }
      ctx.globalAlpha = 1;
    };
    drawRef.current = render;

    // ---- simulation (sleeps when settled; tick redraws while hot) ----
    const sim = d3.forceSimulation(nodes)
      .force('charge', d3.forceManyBody().strength(-95).distanceMax(420))
      .force('link', d3.forceLink(links).id((d) => d.id).distance(42).strength(0.22))
      .force('center', d3.forceCenter(0, 0))
      .force('collide', d3.forceCollide((d) => d.r + 3))
      .force('x', d3.forceX(0).strength(0.018))
      .force('y', d3.forceY(0).strength(0.018))
      .alpha(1).alphaDecay(0.022).velocityDecay(0.4);
    sim.on('tick', render);
    simRef.current = sim;

    // ---- hit testing (CSS-px space) ----
    const pick = (clientX, clientY) => {
      const rect = cv.getBoundingClientRect();
      const t = tRef.current || d3.zoomIdentity;
      const wx = (clientX - rect.left - t.x) / t.k, wy = (clientY - rect.top - t.y) / t.k;
      let best = null, bd = Infinity;
      for (const n of dataRef.current.nodes) {
        if (n.x == null || !visible(n)) continue;
        const dx = n.x - wx, dy = n.y - wy, d = dx * dx + dy * dy, rr = (n.r + 4) * (n.r + 4);
        if (d < rr && d < bd) { bd = d; best = n; }
      }
      return best;
    };

    // ---- zoom + pan (pan only when not starting on a node) ----
    const zoom = d3.zoom().scaleExtent([0.08, 9])
      .filter((e) => {
        if (e.type === 'wheel') return !e.ctrlKey;          // wheel always zooms
        return !pick(e.clientX, e.clientY);                  // drag pans only on background
      })
      .on('zoom', (e) => { tRef.current = e.transform; render(); });
    const sel3 = d3.select(cv);
    sel3.call(zoom).on('dblclick.zoom', null);
    zoomRef.current = { zoom, sel: sel3 };
    tRef.current = d3.zoomIdentity;

    const fitView = () => {
      const ns = dataRef.current.nodes;
      if (!ns.length) return;
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const n of ns) {
        if (n.x == null || !visible(n)) continue;
        minx = Math.min(minx, n.x - n.r); maxx = Math.max(maxx, n.x + n.r);
        miny = Math.min(miny, n.y - n.r); maxy = Math.max(maxy, n.y + n.r);
      }
      if (!isFinite(minx)) return;
      const W = cv.width / dpr(), H = cv.height / dpr();
      const gw = (maxx - minx) || 1, gh = (maxy - miny) || 1;
      const k = Math.min(W / gw, H / gh) * 0.86;
      const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
      const t = d3.zoomIdentity.translate(W / 2 - k * cx, H / 2 - k * cy).scale(k);
      sel3.call(zoom.transform, t);   // syncs tRef via the zoom handler + redraws
    };
    zoomRef.current.fit = fitView;

    // ---- node drag + click-to-open (React-independent pointer handlers) ----
    let downX = 0, downY = 0, moved = false;
    const onDragMove = (e) => {
      const n = dragRef.current; if (!n) return;
      if (!moved && Math.hypot(e.clientX - downX, e.clientY - downY) > 3) moved = true;
      const rect = cv.getBoundingClientRect(); const t = tRef.current;
      n.fx = (e.clientX - rect.left - t.x) / t.k;
      n.fy = (e.clientY - rect.top - t.y) / t.k;
    };
    const onDragUp = () => {
      const n = dragRef.current; if (n) { n.fx = null; n.fy = null; }
      dragRef.current = null;
      if (simRef.current) simRef.current.alphaTarget(0);
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', onDragUp);
      if (n && !moved && onOpen) onOpen(n.id);   // a click (no drag) opens the note
    };
    const onDown = (e) => {
      const n = pick(e.clientX, e.clientY);
      if (!n) { if (selRef.current) setSel(null); return; }   // background → zoom pans
      downX = e.clientX; downY = e.clientY; moved = false;
      dragRef.current = n; n.fx = n.x; n.fy = n.y; setSel(n.id);
      if (simRef.current) simRef.current.alphaTarget(0.18).restart();
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', onDragUp);
    };
    const onHover = (e) => {
      if (dragRef.current) return;
      const n = pick(e.clientX, e.clientY);
      const id = n ? n.id : null;
      if (id !== hoverRef.current) { hoverRef.current = id; cv.style.cursor = n ? 'pointer' : 'grab'; render(); }
    };
    const onDbl = (e) => { const n = pick(e.clientX, e.clientY); if (n && onOpen) onOpen(n.id); };
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onHover);
    cv.addEventListener('dblclick', onDbl);

    // ---- resize + theme observers ----
    const ro = new ResizeObserver(() => { resize(); render(); });
    ro.observe(wrap);
    resize();
    const mo = new MutationObserver(() => { readPalette(); render(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const fitTimer = setTimeout(fitView, 420);   // fit once after initial layout

    return () => {
      clearTimeout(fitTimer);
      ro.disconnect(); mo.disconnect();
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onHover);
      cv.removeEventListener('dblclick', onDbl);
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', onDragUp);
      sim.on('tick', null); sim.stop();
      drawRef.current = null;
    };
  }, [graphSig, onOpen, setSel]);

  const reheat = () => { if (simRef.current) simRef.current.alpha(0.55).restart(); };
  const fit = () => { if (zoomRef.current && zoomRef.current.fit) zoomRef.current.fit(); };
  const selNode = sel && dataRef.current.byId[sel];

  const pill = (active) => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', cursor: 'pointer',
    border: '1px solid var(--border)', borderRadius: 'var(--radius-full)',
    background: active ? 'var(--surface-raised)' : 'transparent', opacity: active ? 1 : 0.45,
    fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)',
  });

  return (
    <div ref={wrapRef} style={{ flex: 1, minWidth: 0, position: 'relative', background: 'var(--surface-canvas)', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, touchAction: 'none', cursor: 'grab' }} />

      <div style={{ position: 'absolute', top: 18, left: 22, zIndex: 2, pointerEvents: 'none' }}>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-strong)', margin: 0 }}>Knowledge graph</h2>
        <p style={{ fontSize: 12.5, color: 'var(--text-subtle)', margin: '3px 0 0' }}>{dataRef.current.nodes.length} notes · {dataRef.current.links.length} links · scroll to zoom · drag to pan</p>
      </div>

      <div style={{ position: 'absolute', top: 18, right: 22, zIndex: 2, display: 'flex', gap: 8, alignItems: 'center' }}>
        {graphScopes.map((k) => (
          <button key={k} onClick={() => setFilters((f) => ({ ...f, [k]: f[k] === false }))} style={pill(filters[k] !== false)}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: `var(${grScopeVar(k)})` }} />{k}
          </button>
        ))}
        <div title="Scrub the graph by note creation date (version control) — drag to see knowledge as of any date" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 11px', border: '1px solid var(--border)', borderRadius: 'var(--radius-full)', background: 'var(--surface-raised)' }}>
          <GrIcon name="history" size={12} style={{ color: 'var(--text-faint)' }} />
          <input type="range" min={dateBounds.lo} max={dateBounds.hi} value={Math.min(cutoff, dateBounds.hi)} step={86400000}
            onChange={(e) => setCutoff(Number(e.target.value))}
            style={{ width: 118, accentColor: 'var(--brand-fg)', cursor: 'pointer' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: cutoff >= dateBounds.hi ? 'var(--text-faint)' : 'var(--brand-fg)', minWidth: 66 }}>{cutoff >= dateBounds.hi ? 'all' : new Date(cutoff).toISOString().slice(0, 10)}</span>
        </div>
        <button onClick={fit} title="Fit to view" style={pill(true)}><GrIcon name="maximize" size={12} />fit</button>
        <button onClick={reheat} title="Shake" style={pill(true)}><GrIcon name="sparkles" size={12} />shake</button>
      </div>

      {selNode && (
        <div style={{ position: 'absolute', right: 18, bottom: 18, width: 240, padding: 14, background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', zIndex: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <GrIcon name="file-text" size={15} style={{ color: 'var(--brand-fg)' }} />
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selNode.label}</span>
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
