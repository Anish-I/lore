/* global React */
// Lore desktop — knowledge graph on CANVAS (Obsidian-style: zoom/pan, light, clean).
// Renders the whole graph in one canvas pass per frame (not thousands of SVG nodes),
// with real d3-zoom wheel zoom + pan, degree-scaled nodes, and a sim that sleeps when settled.
const grNS = window.VaultDesignSystem_ffbf58;
const { Icon: GrIcon, ScopeTag: GrScope, Button: GrButton } = grNS;

// Every edge kind Lore can produce → color (dark/light theme variants) + human
// label + whether it's a reasoned (LLM/cue-inferred) relation or a plain
// structural link (always present from plain indexing, no /enrich required).
// Single source of truth for the canvas draw AND the on-screen legend, so every
// line on the graph is explained — nothing renders as an unlabeled gray line.
// Reasoned kinds stay visually dominant (confidence-scaled opacity/width in the
// draw below); structural kinds are tasteful-but-muted, never the near-invisible
// `pal.edge` gray they used to be. Light-mode hexes are deliberately darker/more
// saturated than their dark-mode counterparts — a hue tuned for a near-black
// canvas washes out against a near-white one.
const GR_EDGE_KINDS = [
{ kind: 'depends_on', dark: '#5b8def', light: '#2f5fc7', label: 'depends on', structural: false },
{ kind: 'supersedes', dark: '#a36bd6', light: '#7a3fb0', label: 'supersedes', structural: false },
{ kind: 'causes', dark: '#e0883a', light: '#b8621a', label: 'causes', structural: false },
{ kind: 'supports', dark: '#3fa85f', light: '#1f7a3f', label: 'supports', structural: false },
{ kind: 'contradicts', dark: '#d6504f', light: '#b8302f', label: 'contradicts', structural: false },
{ kind: 'implements', dark: '#3fa89a', light: '#1f7a6e', label: 'implements', structural: false },
{ kind: 'relates_to', dark: '#c98a56', light: '#9c5f2e', label: 'relates to', structural: false },
{ kind: 'link', dark: '#c9a24b', light: '#8a6a1f', label: 'wikilink', structural: true },
{ kind: 'tag', dark: '#d6b34a', light: '#96781f', label: 'shared tag', structural: true },
// Grayscale hexes here would blend into the canvas and read as "uncolored" —
// folder is the most common edge kind by far, so it must be a real,
// distinguishable hue in both themes, not gray.
{ kind: 'folder', dark: '#6c7bb0', light: '#45568a', label: 'same folder', structural: true },
{ kind: 'topic', dark: '#3a8f8a', light: '#1f6b66', label: 'topic', structural: true }];

const GR_EDGE_STRUCTURAL = new Set(GR_EDGE_KINDS.filter((e) => e.structural).map((e) => e.kind));
function grEdgeColorMap(theme) {
  return Object.fromEntries(GR_EDGE_KINDS.map((e) => [e.kind, theme === 'light' ? e.light : e.dark]));
}
// Daily-thread / journal notes named by date — hidden by default so topics dominate the graph.
const GR_DATE_RE = /^(session:\s*)?\d{4}[-/]\d{2}[-/]\d{2}/i;

// Section (top-level folder) → node color: shared with the file explorer via
// window.LoreSectionColor (wired-data.js) so a section reads as the same color
// on both surfaces.
const grSectionColor = window.LoreSectionColor;

// bases: top-level folder ("Section") names present in the library.
// kbFilter: the SAME array the sidebar's Sections switcher owns ([] = show all).
// onToggleBase: toggles one folder in/out of kbFilter.
// Scope filtering (All/Private/Team/Plugins) already happened one level up — the
// `graph` prop is pre-filtered by the parent's kbFilter+scopeFilter, so this
// component owns no filtering of its own beyond the date-cutoff scrubber below.
function GraphView({ graph, onOpen, bases, kbFilter, onToggleBase, baseOf, hideTitle, colorBy }) {
  const wrapRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const simRef = React.useRef(null);
  const zoomRef = React.useRef(null);
  const tRef = React.useRef(null); // current d3 zoom transform (CSS-px space)
  const dataRef = React.useRef({ nodes: [], links: [], byId: {} });
  const palRef = React.useRef({});
  const hoverRef = React.useRef(null);
  const dragRef = React.useRef(null);
  const drawRef = React.useRef(null);
  const selRef = React.useRef(null);

  // Content signature: the heavy simulation effect below rebuilds only when the
  // actual node/edge SET changes, not on every new `graph` object reference — so
  // a parent re-render that produces an identical filtered graph won't restart
  // (and re-scatter) the force layout.
  const graphSig = React.useMemo(() => {
    const ns = graph.nodes || [];
    // id+scope: a Move rewrites a node's scope without changing the node set —
    // the place-colored Map must rebuild (recolor) when that happens.
    return ns.length + '|' + (graph.edges || []).length + '|' + ns.map((n) => n.id + ':' + (n.scope || '')).join(',');
  }, [graph]);

  // Which edge kinds are actually present → the legend only lists relevant colors.
  // Any kind not in GR_EDGE_KINDS (future/unknown) folds into the 'link' row.
  const GR_EDGE_KIND_SET = React.useMemo(() => new Set(GR_EDGE_KINDS.map((e) => e.kind)), []);
  const legend = React.useMemo(() => {
    const present = new Set();
    const origins = { index: 0, capture: 0, llm: 0 };
    for (const e of graph.edges || []) {
      const k = e[2] || 'link';
      present.add(GR_EDGE_KIND_SET.has(k) ? k : 'link');
      const o = e[4] || 'index';
      origins[o] = (origins[o] || 0) + 1;
    }
    return { kinds: GR_EDGE_KINDS.filter((e) => present.has(e.kind)), origins };
  }, [graph, GR_EDGE_KIND_SET]);
  const [sel, setSel] = React.useState(null);
  // With many Sections the pill row would overflow the toolbar — show a capped
  // number inline (prioritizing whichever are actively filtered-on, so an
  // engaged filter never silently hides itself in the overflow) and collapse
  // the rest into a "+N more" popover, same pattern as the editor's tab overflow.
  const SECTION_PILL_CAP = 5;
  const [sectionMenuOpen, setSectionMenuOpen] = React.useState(false);
  const sectionRows = React.useMemo(() => {
    const all = bases || [];
    if (all.length <= SECTION_PILL_CAP) return { shown: all, overflow: [] };
    const active = kbFilter && kbFilter.length ? all.filter((n) => kbFilter.includes(n)) : [];
    const rest = all.filter((n) => !active.includes(n));
    const shown = [...active, ...rest].slice(0, SECTION_PILL_CAP);
    const overflow = all.filter((n) => !shown.includes(n));
    return { shown, overflow };
  }, [bases, kbFilter]);
  // Mirrors the canvas draw's data-theme observer so the React-rendered legend
  // and section pills also pick the light/dark-optimized swatch.
  const [theme, setThemeState] = React.useState(() =>
  document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  React.useEffect(() => {
    const mo = new MutationObserver(() => {
      setThemeState(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  // Version-control date scrubber: show only notes created on/before `cutoff`.
  // Scrubs on the note's real creation date (`created` — frontmatter created:/date:,
  // else file mtime, else first-seen; see core/lore/index.py derive_created_at) so
  // the slider reflects when knowledge was actually written, not when it was last
  // re-indexed. Falls back to `updated` for notes indexed before the created_at
  // column existed and not yet backfilled (see POST /backfill/created).
  const dateBounds = React.useMemo(() => {
    let lo = Infinity,hi = -Infinity;
    for (const n of graph.nodes || []) {const t = Date.parse(n.created || n.updated);if (!isNaN(t)) {if (t < lo) lo = t;if (t > hi) hi = t;}}
    if (!isFinite(lo)) {lo = 0;hi = Date.now();}
    return { lo, hi };
  }, [graph]);
  const [cutoff, setCutoff] = React.useState(dateBounds.hi);
  const cutoffRef = React.useRef(dateBounds.hi);
  React.useEffect(() => {setCutoff(dateBounds.hi);}, [dateBounds]);

  const draw = React.useCallback(() => {if (drawRef.current) drawRef.current();}, []);

  React.useEffect(() => {cutoffRef.current = cutoff;draw();}, [cutoff, draw]);
  React.useEffect(() => {selRef.current = sel;draw();}, [sel, draw]);

  React.useEffect(() => {
    const d3 = window.d3;
    const cv = canvasRef.current,wrap = wrapRef.current;
    if (!d3 || !cv || !wrap) return;

    // ---- palette from CSS vars (canvas can't use var()) + theme-aware edge colors ----
    const readPalette = () => {
      const cs = getComputedStyle(document.documentElement);
      const v = (n, f) => cs.getPropertyValue(n).trim() || f;
      const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      palRef.current = {
        team: v('--place-team-solid', '#3fae6e'), enterprise: v('--place-company-solid', '#5aa0ea'),
        company: v('--place-company-solid', '#5aa0ea'),
        private: v('--place-my-solid', '#d99a2b'),
        custom: v('--place-my-solid', '#d99a2b'),
        edge: v('--border-strong', '#2a2d34'), edgeLit: v('--brand-fg', '#c9a24b'),
        text: v('--text-muted', '#9aa0aa'), textStrong: v('--text-strong', '#f0f0f2'),
        brand: v('--brand-fg', '#c9a24b'),
        theme, edgeColors: grEdgeColorMap(theme)
      };
    };
    readPalette();

    // ---- edge kind → color map (shared with the legend, GR_EDGE_KINDS above) ----
    const STRUCTURAL_KINDS = GR_EDGE_STRUCTURAL;

    // ---- data (d3 mutates node objects in place) ----
    const nodes = graph.nodes.map((n) => ({
      ...n, deg: n.links || 0,
      // importance (0–1) adds up to 4px to the base radius; min 2.4, max 11.
      r: Math.max(2.4, Math.min(11, 2.4 + Math.sqrt(n.links || 0) * 0.9 + (n.importance || 0) * 4))
    }));
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const links = graph.edges.
    filter(([a, b]) => byId[a] && byId[b])
    // 4th element is confidence weight; default 0.9 when absent (older data or structural).
    // 5th element (origin ∈ index|capture|llm) is the edge's provenance tag;
    // tolerate 4-tuples from older backends.
    .map(([a, b, kind, w, origin]) => ({ source: a, target: b, kind: kind || 'link', weight: w != null ? w : 0.9, origin: origin || 'index' }));
    dataRef.current = { nodes, links, byId };

    const dpr = () => window.devicePixelRatio || 1;
    const resize = () => {
      const w = wrap.clientWidth,h = wrap.clientHeight;
      cv.width = Math.max(1, Math.round(w * dpr()));
      cv.height = Math.max(1, Math.round(h * dpr()));
      cv.style.width = w + 'px';cv.style.height = h + 'px';
    };

    const visible = (n) => {
      if (!n) return false;
      if (GR_DATE_RE.test(n.label || '')) return false; // date notes are folded into topics → never shown
      const t = Date.parse(n.created || n.updated);
      if (!isNaN(t) && t > cutoffRef.current) return false; // version control: hide notes created after the cutoff
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
        const a = l.source.id || l.source,b = l.target.id || l.target;
        if (a === focus) nb.add(b);if (b === focus) nb.add(a);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.setTransform(dpr() * t.k, 0, 0, dpr() * t.k, dpr() * t.x, dpr() * t.y);

      // edges — semantic kinds get typed color + confidence-scaled opacity/width
      for (const l of ls) {
        const a = l.source,b = l.target;
        if (a.x == null || !visible(a) || !visible(b)) continue;
        const lit = focus && (a.id === focus || b.id === focus);
        const isStructural = STRUCTURAL_KINDS.has(l.kind);
        // Every kind (reasoned AND structural) gets its own typed color from
        // GR_EDGE_KINDS — pal.edge is now only a last-resort fallback for a
        // genuinely unrecognized kind, not the default for structural edges.
        const kindColor = pal.edgeColors[l.kind] || pal.edge;
        const conf = l.weight != null ? l.weight : 0.9;
        ctx.beginPath();ctx.moveTo(a.x, a.y);ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = lit ? pal.edgeLit : kindColor;
        // Structural edges stay more muted than reasoned ones (dominant weight kept
        // on the /enrich-derived typed relations) but are no longer near-invisible.
        ctx.globalAlpha = focus ? lit ? 0.85 : 0.08 : isStructural ? 0.5 : Math.max(0.15, conf * 0.85);
        ctx.lineWidth = (lit ? 1.3 : isStructural ? 0.7 : 0.5 + conf * 0.9) / t.k;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // nodes
      for (const n of ns) {
        if (n.x == null || !visible(n)) continue;
        const near = !focus || nb.has(n.id) || n.id === focus;
        ctx.globalAlpha = near ? 1 : 0.22;
        // Exact 2π, not 6.283185: Electron 43's Chromium (Graphite rasterizer)
        // renders a near-full arc as a visibly open 'pac-man'; older Chromium
        // snapped it closed. closePath() belts-and-suspenders the fill.
        ctx.beginPath();ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);ctx.closePath();
        // colorBy 'place' (Map overlay): scope → place solid, matching the legend.
        // Default: color by Section (top-level folder) when known — the pills
        // filter by section, so node color matches what you're toggling; scope
        // colors are the fallback for notes outside any tracked folder.
        ctx.fillStyle = colorBy === 'place' ?
        pal[n.scope] || pal.custom || pal.private :
        baseOf && grSectionColor(baseOf(n.path), pal.theme) || pal[n.scope] || pal.custom || pal.private;
        ctx.fill();
        if (n.id === selRef.current) {
          ctx.lineWidth = 2 / t.k;ctx.strokeStyle = pal.brand;ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // labels — only when zoomed in, or for the focused node + its neighbors
      const showAll = t.k > 1.25;
      ctx.textAlign = 'center';ctx.textBaseline = 'top';
      for (const n of ns) {
        if (n.x == null || !visible(n)) continue;
        const isFocus = focus && (n.id === focus || nb.has(n.id));
        if (!showAll && !isFocus) continue;
        ctx.globalAlpha = focus && !isFocus ? 0.28 : 0.92;
        ctx.fillStyle = n.id === focus ? pal.textStrong : pal.text;
        ctx.font = `${n.id === focus ? 600 : 500} ${11 / t.k}px ui-sans-serif, system-ui, sans-serif`;
        const label = n.label || '';
        ctx.fillText(label.length > 42 ? label.slice(0, 40) + '…' : label, n.x, n.y + n.r + 2 / t.k);
      }
      ctx.globalAlpha = 1;
    };
    drawRef.current = render;

    // ---- simulation (sleeps when settled; tick redraws while hot) ----
    const sim = d3.forceSimulation(nodes).
    force('charge', d3.forceManyBody().strength(-95).distanceMax(420)).
    force('link', d3.forceLink(links).id((d) => d.id).distance(42).strength(0.22)).
    force('center', d3.forceCenter(0, 0)).
    force('collide', d3.forceCollide((d) => d.r + 3)).
    force('x', d3.forceX(0).strength(0.018)).
    force('y', d3.forceY(0).strength(0.018)).
    alpha(1).alphaDecay(0.022).velocityDecay(0.4);
    sim.on('tick', render);
    simRef.current = sim;

    // ---- hit testing (CSS-px space) ----
    const pick = (clientX, clientY) => {
      const rect = cv.getBoundingClientRect();
      const t = tRef.current || d3.zoomIdentity;
      const wx = (clientX - rect.left - t.x) / t.k,wy = (clientY - rect.top - t.y) / t.k;
      let best = null,bd = Infinity;
      for (const n of dataRef.current.nodes) {
        if (n.x == null || !visible(n)) continue;
        const dx = n.x - wx,dy = n.y - wy,d = dx * dx + dy * dy,rr = (n.r + 4) * (n.r + 4);
        if (d < rr && d < bd) {bd = d;best = n;}
      }
      return best;
    };

    // ---- zoom + pan (pan only when not starting on a node) ----
    const zoom = d3.zoom().scaleExtent([0.08, 9]).
    filter((e) => {
      if (e.type === 'wheel') return !e.ctrlKey; // wheel always zooms
      return !pick(e.clientX, e.clientY); // drag pans only on background
    }).
    on('zoom', (e) => {tRef.current = e.transform;render();});
    const sel3 = d3.select(cv);
    sel3.call(zoom).on('dblclick.zoom', null);
    zoomRef.current = { zoom, sel: sel3 };
    // First entry = no prior transform. Don't reset an existing one — a live
    // data refresh must not yank the viewport away from where the user panned.
    const firstEntry = !tRef.current;
    if (firstEntry) tRef.current = d3.zoomIdentity;

    const fitView = () => {
      const ns = dataRef.current.nodes;
      if (!ns.length) return;
      let minx = Infinity,miny = Infinity,maxx = -Infinity,maxy = -Infinity;
      for (const n of ns) {
        if (n.x == null || !visible(n)) continue;
        minx = Math.min(minx, n.x - n.r);maxx = Math.max(maxx, n.x + n.r);
        miny = Math.min(miny, n.y - n.r);maxy = Math.max(maxy, n.y + n.r);
      }
      if (!isFinite(minx)) return;
      const W = cv.width / dpr(),H = cv.height / dpr();
      const gw = maxx - minx || 1,gh = maxy - miny || 1;
      const k = Math.min(W / gw, H / gh) * 0.86;
      const cx = (minx + maxx) / 2,cy = (miny + maxy) / 2;
      const t = d3.zoomIdentity.translate(W / 2 - k * cx, H / 2 - k * cy).scale(k);
      sel3.call(zoom.transform, t); // syncs tRef via the zoom handler + redraws
    };
    zoomRef.current.fit = fitView;

    // ---- node drag + click-to-open (React-independent pointer handlers) ----
    let downX = 0,downY = 0,moved = false;
    const onDragMove = (e) => {
      const n = dragRef.current;if (!n) return;
      if (!moved && Math.hypot(e.clientX - downX, e.clientY - downY) > 3) moved = true;
      const rect = cv.getBoundingClientRect();const t = tRef.current;
      n.fx = (e.clientX - rect.left - t.x) / t.k;
      n.fy = (e.clientY - rect.top - t.y) / t.k;
    };
    const onDragUp = () => {
      const n = dragRef.current;if (n) {n.fx = null;n.fy = null;}
      dragRef.current = null;
      if (simRef.current) simRef.current.alphaTarget(0);
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', onDragUp);
      if (n && !moved && onOpen) onOpen(n.id); // a click (no drag) opens the note
    };
    const onDown = (e) => {
      const n = pick(e.clientX, e.clientY);
      if (!n) {if (selRef.current) setSel(null);return;} // background → zoom pans
      downX = e.clientX;downY = e.clientY;moved = false;
      dragRef.current = n;n.fx = n.x;n.fy = n.y;setSel(n.id);
      if (simRef.current) simRef.current.alphaTarget(0.18).restart();
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', onDragUp);
    };
    const onHover = (e) => {
      if (dragRef.current) return;
      const n = pick(e.clientX, e.clientY);
      const id = n ? n.id : null;
      if (id !== hoverRef.current) {hoverRef.current = id;cv.style.cursor = n ? 'pointer' : 'grab';render();}
    };
    const onDbl = (e) => {const n = pick(e.clientX, e.clientY);if (n && onOpen) onOpen(n.id);};
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onHover);
    cv.addEventListener('dblclick', onDbl);

    // ---- resize + theme observers ----
    const ro = new ResizeObserver(() => {resize();render();});
    ro.observe(wrap);
    resize();
    const mo = new MutationObserver(() => {readPalette();render();});
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // Auto-fit ONLY on first entry: fitting at 420ms mid-simulation zoomed to a
    // still-moving cluster then visibly bounced out; and re-fitting on every
    // live data refresh yanked the viewport away from wherever the user had
    // panned. 900ms lets the layout mostly settle first. (This used to check
    // tRef.current AFTER assigning zoomIdentity above — always truthy, so the
    // first fit never ran and the Map opened at 1:1 in a corner.)
    const fitTimer = firstEntry ? setTimeout(fitView, 900) : null;

    return () => {
      if (fitTimer) clearTimeout(fitTimer);
      ro.disconnect();mo.disconnect();
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onHover);
      cv.removeEventListener('dblclick', onDbl);
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', onDragUp);
      sim.on('tick', null);sim.stop();
      drawRef.current = null;
    };
  }, [graphSig, onOpen, setSel, baseOf, colorBy]);

  const reheat = () => {if (simRef.current) simRef.current.alpha(0.55).restart();};
  const fit = () => {if (zoomRef.current && zoomRef.current.fit) zoomRef.current.fit();};
  const selNode = sel && dataRef.current.byId[sel];

  const pill = (active) => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', cursor: 'pointer',
    border: '1px solid var(--border)', borderRadius: 'var(--radius-full)',
    background: active ? 'var(--surface-raised)' : 'transparent', opacity: active ? 1 : 0.45,
    fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)'
  });

  return (/*#__PURE__*/
    React.createElement("div", { ref: wrapRef, style: { flex: 1, minWidth: 0, position: 'relative', background: 'var(--surface-canvas)', overflow: 'hidden' } }, /*#__PURE__*/
    React.createElement("canvas", { ref: canvasRef, style: { position: 'absolute', inset: 0, touchAction: 'none', cursor: 'grab' } }),

    !hideTitle && /*#__PURE__*/
    React.createElement("div", { style: { position: 'absolute', top: 18, left: 22, zIndex: 2, pointerEvents: 'none' } }, /*#__PURE__*/
    React.createElement("h2", { style: { fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-strong)', margin: 0 } }, "Knowledge map"), /*#__PURE__*/
    React.createElement("p", { style: { fontSize: 12.5, color: 'var(--text-subtle)', margin: '3px 0 0' } }, dataRef.current.nodes.length, " pages \xB7 ", dataRef.current.links.length, " links \xB7 scroll to zoom \xB7 drag to pan")
    ), /*#__PURE__*/


    React.createElement("div", { style: { position: 'absolute', top: 18, right: 22, zIndex: 2, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '68%' } },
    sectionRows.shown.map((name) => /*#__PURE__*/
    React.createElement("button", { key: name, onClick: () => onToggleBase && onToggleBase(name), title: `Toggle the "${name}" section`,
      style: pill(!kbFilter || !kbFilter.length || kbFilter.includes(name)) }, /*#__PURE__*/
    React.createElement("span", { style: { width: 8, height: 8, borderRadius: '50%', background: grSectionColor(name, theme), flexShrink: 0 } }), name
    )
    ),
    sectionRows.overflow.length > 0 && /*#__PURE__*/
    React.createElement("div", { style: { position: 'relative' } }, /*#__PURE__*/
    React.createElement("button", { onClick: () => setSectionMenuOpen((o) => !o), style: pill(sectionRows.overflow.some((n) => !kbFilter || !kbFilter.length || kbFilter.includes(n))) }, "+",
    sectionRows.overflow.length, " more"
    ),
    sectionMenuOpen && /*#__PURE__*/
    React.createElement(React.Fragment, null, /*#__PURE__*/
    React.createElement("div", { onClick: () => setSectionMenuOpen(false), style: { position: 'fixed', inset: 0, zIndex: 40 } }), /*#__PURE__*/
    React.createElement("div", { style: { position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 41, minWidth: 180, maxHeight: 280, overflowY: 'auto', padding: 6, background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)' } },
    sectionRows.overflow.map((name) => {
      const active = !kbFilter || !kbFilter.length || kbFilter.includes(name);
      return (/*#__PURE__*/
        React.createElement("div", { key: name, onClick: () => onToggleBase && onToggleBase(name),
          style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', opacity: active ? 1 : 0.45, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-muted)' },
          onMouseEnter: (e) => e.currentTarget.style.background = 'var(--surface-hover)',
          onMouseLeave: (e) => e.currentTarget.style.background = 'transparent' }, /*#__PURE__*/
        React.createElement("span", { style: { width: 8, height: 8, borderRadius: '50%', background: grSectionColor(name, theme), flexShrink: 0 } }), name
        ));

    })
    )
    )

    ), /*#__PURE__*/

    React.createElement("div", { title: "Scrub the graph by note creation date \u2014 drag, or pick/type an exact date", style: { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 11px', border: '1px solid var(--border)', borderRadius: 'var(--radius-full)', background: 'var(--surface-raised)' } }, /*#__PURE__*/
    React.createElement(GrIcon, { name: "history", size: 12, style: { color: 'var(--text-faint)' } }), /*#__PURE__*/
    React.createElement("input", { type: "range", min: dateBounds.lo, max: dateBounds.hi, value: Math.min(cutoff, dateBounds.hi), step: 86400000,
      onChange: (e) => setCutoff(Number(e.target.value)),
      style: { width: 118, accentColor: 'var(--brand-fg)', cursor: 'pointer' } }),
    (() => {
      // Within one day-step of the max = "all". Live refreshes grow the
      // upper bound as new notes land; a slider parked at max must keep
      // reading "all", not flip to today's date.
      const atEnd = cutoff >= dateBounds.hi - 86400000;
      return (/*#__PURE__*/
        React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: atEnd ? 'var(--text-faint)' : 'var(--brand-fg)', minWidth: 34 } },
        atEnd ? 'all' : new Date(cutoff).toISOString().slice(0, 10)
        ));

    })(), /*#__PURE__*/
    React.createElement("input", { type: "date", value: cutoff >= dateBounds.hi - 86400000 ? '' : new Date(cutoff).toISOString().slice(0, 10),
      min: new Date(dateBounds.lo).toISOString().slice(0, 10),
      max: new Date(dateBounds.hi).toISOString().slice(0, 10),
      onChange: (e) => {
        const t = Date.parse(e.target.value);
        // Empty/cleared or out-of-range → back to "all".
        setCutoff(Number.isNaN(t) ? dateBounds.hi : t + 86399000); // end of picked day
      },
      title: "Jump to an exact date",
      style: { background: 'transparent', border: 'none', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10.5, width: 108, outline: 'none', colorScheme: 'dark' } })
    ), /*#__PURE__*/
    React.createElement("button", { onClick: fit, title: "Fit to view", style: pill(true) }, /*#__PURE__*/React.createElement(GrIcon, { name: "maximize", size: 12 }), "fit"), /*#__PURE__*/
    React.createElement("button", { onClick: reheat, title: "Shake", style: pill(true) }, /*#__PURE__*/React.createElement(GrIcon, { name: "sparkles", size: 12 }), "shake")
    ),

    legend.kinds.length > 0 && /*#__PURE__*/
    React.createElement("div", { style: { position: 'absolute', left: 18, bottom: 18, zIndex: 2, padding: '9px 11px', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', maxWidth: 190 } }, /*#__PURE__*/
    React.createElement("div", { style: { fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 } }, "Connection types"), /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
    legend.kinds.map((e) => /*#__PURE__*/
    React.createElement("div", { key: e.kind, style: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'var(--text-muted)' } }, /*#__PURE__*/
    React.createElement("span", { style: { width: 14, height: 2.5, borderRadius: 2, background: theme === 'light' ? e.light : e.dark, flexShrink: 0 } }), e.label
    )
    )
    ), /*#__PURE__*/

    React.createElement("div", { title: "index = deterministic (wikilinks/folders/tags) \xB7 capture = from agent sessions \xB7 llm = inferred by enrichment",
      style: { marginTop: 7, paddingTop: 6, borderTop: '1px solid var(--divider)', fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--text-faint)' } }, "origins: ",
    ['index', 'capture', 'llm'].filter((o) => legend.origins[o]).map((o) => `${o} ${legend.origins[o]}`).join(' · ') || 'none'
    )
    ),


    selNode && (() => {
      const pm = (window.LorePlaceMeta || {})[grPlaceOf(selNode.scope)] || {};
      return (/*#__PURE__*/
        React.createElement("div", { style: { position: 'absolute', right: 18, bottom: 18, width: 260, padding: 14, background: 'var(--surface-overlay)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-popover)', zIndex: 3, animation: 'lore-fade-in 140ms ease' } }, /*#__PURE__*/
        React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } }, /*#__PURE__*/
        React.createElement(GrIcon, { name: "file-text", size: 15, style: { color: pm.fg || 'var(--brand-fg)' } }), /*#__PURE__*/
        React.createElement("span", { style: { flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, selNode.label)
        ), /*#__PURE__*/
        React.createElement("div", { style: { fontSize: 11.5, color: 'var(--text-subtle)', marginBottom: 12 } }, "Lives in ", /*#__PURE__*/
        React.createElement("span", { style: { color: pm.fg || 'var(--text-body)', fontWeight: 600 } }, pm.label || 'My Notes'), " \xB7 ", selNode.links || 0, " connection", (selNode.links || 0) === 1 ? '' : 's'
        ), /*#__PURE__*/
        React.createElement(GrButton, { variant: "primary", size: "sm", icon: "arrow-up-right", fullWidth: true, onClick: () => onOpen && onOpen(selNode.id) }, "Open page")
        ));

    })()
    ));

}

function grPlaceOf(scope) {
  const s = String(scope || '').toLowerCase();
  if (s === 'team') return 'team';
  if (s === 'company' || s === 'enterprise') return 'company';
  return 'my';
}

// Full-screen knowledge Map overlay (Redesign C): mockup header + place legend
// around the existing canvas GraphView, colored by place. Esc closes.
function MapOverlay({ graph, onOpen, onClose, bases, kbFilter, onToggleBase, baseOf, loading }) {
  const meta = window.LorePlaceMeta || {};
  React.useEffect(() => {
    const onKey = (e) => {if (e.key === 'Escape') {e.stopPropagation();onClose();}};
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const empty = !graph || !graph.nodes || graph.nodes.length === 0;
  return (/*#__PURE__*/
    React.createElement("div", { style: { position: 'absolute', inset: 0, zIndex: 45, background: 'var(--surface-canvas)', display: 'flex', flexDirection: 'column', animation: 'lore-fade-in 160ms ease' } }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 } }, /*#__PURE__*/
    React.createElement(GrIcon, { name: "waypoints", size: 18, style: { color: 'var(--brand-fg)' } }), /*#__PURE__*/
    React.createElement("div", { style: { minWidth: 0 } }, /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 15, fontWeight: 600, color: 'var(--text-strong)' } }, "Knowledge map"), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 11.5, color: 'var(--text-faint)', marginTop: 1 } }, "Colors show where each page lives. Double-click a dot to open it.")
    ), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1 } }), /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 14 } },
    ['my', 'team', 'company'].map((id) => /*#__PURE__*/
    React.createElement("span", { key: id, style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-muted)' } }, /*#__PURE__*/
    React.createElement("span", { style: { width: 9, height: 9, borderRadius: '50%', background: (meta[id] || {}).solid || 'var(--text-faint)' } }),
    (meta[id] || {}).label || id
    )
    )
    ), /*#__PURE__*/
    React.createElement("button", { onClick: onClose, style: {
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 13px', borderRadius: 8,
        border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer',
        color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', fontSize: 12.5
      } }, /*#__PURE__*/
    React.createElement(GrIcon, { name: "x", size: 13 }), "Close"
    )
    ),
    empty ? /*#__PURE__*/
    React.createElement("div", { style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--text-subtle)' } }, /*#__PURE__*/
    React.createElement(GrIcon, { name: "waypoints", size: 30, style: { color: 'var(--text-faint)' } }), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 14 } }, loading ? 'Loading the map…' : 'No pages on the map yet.'), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 12, color: 'var(--text-faint)' } }, loading ? 'Fetching pages and connections…' : 'Add or import pages and they appear here automatically.')
    ) : /*#__PURE__*/

    React.createElement("div", { style: { flex: 1, minHeight: 0, display: 'flex' } }, /*#__PURE__*/
    React.createElement(GraphView, { graph: graph, onOpen: onOpen, bases: bases, kbFilter: kbFilter, onToggleBase: onToggleBase, baseOf: baseOf, hideTitle: true, colorBy: "place" })
    )

    ));

}

window.LoreGraphView = GraphView;
window.LoreMapOverlay = MapOverlay;