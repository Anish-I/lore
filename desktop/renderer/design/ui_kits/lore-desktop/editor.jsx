/* global React */
// Lore desktop — center editor (reading view) + right context pane
const edNS = window.VaultDesignSystem_ffbf58;
const { Icon: EdIcon, IconButton: EdIconBtn, WikiLink, ScopeTag: EdScope, Tabs: EdTabs, Avatar: EdAvatar, Badge: EdBadge, ScopePicker, Tooltip: EdTip } = edNS;

const edS = {
  center: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface-canvas)' },
  tabbar: { display: 'flex', alignItems: 'center', flexWrap: 'nowrap', overflow: 'hidden', height: 38, background: 'var(--surface-base)', borderBottom: '1px solid var(--border-subtle)', paddingRight: 8, flexShrink: 0 },
  tab: (on) => ({
    display: 'flex', alignItems: 'center', gap: 7, height: '100%', padding: '0 14px',
    minWidth: 0, flexShrink: 1,
    borderRight: '1px solid var(--border-subtle)', cursor: 'pointer',
    background: on ? 'var(--surface-canvas)' : 'transparent',
    color: on ? 'var(--text-strong)' : 'var(--text-subtle)', fontSize: 13,
    boxShadow: on ? 'inset 0 2px 0 var(--brand-bg)' : 'none',
  }),
  toolbar: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 18px', borderBottom: '1px solid var(--divider)', flexShrink: 0 },
  scroll: { flex: 1, overflowY: 'auto', padding: '48px 0 120px' },
  col: { maxWidth: 720, width: '100%', margin: '0 auto', padding: '0 48px', boxSizing: 'border-box' },
  context: { width: 'var(--context-width)', flexShrink: 0, background: 'var(--surface-panel)', borderLeft: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column' },
};

function Runs({ runs, onOpen }) {
  return runs.map((r, i) => {
    if (r.link) return <WikiLink key={i} onClick={() => onOpen && onOpen(r.link)}>{r.x}</WikiLink>;
    if (r.mark) return <mark key={i} style={{ background: 'var(--highlight-bg)', color: 'var(--text-strong)', borderRadius: 2, padding: '0 2px' }}>{r.x}</mark>;
    if (r.code) return <code key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.86em', background: 'var(--surface-inset)', padding: '0.1em 0.35em', borderRadius: 'var(--radius-sm)' }}>{r.x}</code>;
    return <span key={i}>{r.x}</span>;
  });
}

function Block({ b, note, onOpen }) {
  if (b.t === 'h1') return <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-4xl)', fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.01em', margin: '0 0 14px', color: 'var(--text-strong)' }}>{b.s}</h1>;
  if (b.t === 'meta') return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 26px', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)' }}>
      <EdScope scope={note.scope} size="sm" />
      <span>{note.owner}</span><span>· updated {note.updated}</span>
      <span style={{ color: 'var(--link-fg)' }}>{note.tags.map((t) => '#' + t).join('  ')}</span>
    </div>
  );
  if (b.t === 'h2') return <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-2xl)', fontWeight: 600, margin: '30px 0 12px', color: 'var(--text-strong)' }}>{b.s}</h2>;
  if (b.t === 'h3') return <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-xl)', fontWeight: 600, margin: '24px 0 10px', color: 'var(--text-strong)' }}>{b.s}</h3>;
  if (b.t === 'quote') return <blockquote style={{ margin: '20px 0', padding: '4px 18px', borderLeft: '3px solid var(--brand-soft-border)', color: 'var(--text-muted)', fontStyle: 'italic', fontFamily: 'var(--font-serif)' }}>{b.runs ? <Runs runs={b.runs} onOpen={onOpen} /> : b.s}</blockquote>;
  if (b.t === 'code') return <pre style={{ margin: '16px 0', padding: '12px 14px', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflowX: 'auto', fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-body)' }}>{b.s}</pre>;
  if (b.t === 'li') return (
    <div style={{ display: 'flex', gap: 10, margin: '6px 0', fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', lineHeight: 1.6, color: 'var(--text-body)' }}>
      <span style={{ color: 'var(--brand-fg)', marginTop: 1 }}>—</span>
      <span>{b.runs ? <Runs runs={b.runs} onOpen={onOpen} /> : b.s}</span>
    </div>
  );
  return <p style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', lineHeight: 1.65, margin: '0 0 16px', color: 'var(--text-body)' }}>{b.runs ? <Runs runs={b.runs} onOpen={onOpen} /> : b.s}</p>;
}

// Overflow: past ED_TAB_MAX open tabs, the strip shows the first ED_TAB_SHOW pills
// (plus the active tab, pulled forward even when it sits beyond them) and folds the
// rest into an "N more…" dropdown — endless VS-Code-style pill rows got confusing.
const ED_TAB_MAX = 6, ED_TAB_SHOW = 5;

function TabStrip({ tabs, activeId, onTab, onCloseTab, onCloseOthers, onTogglePane }) {
  const all = tabs || [];
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [hoverTab, setHoverTab] = React.useState(null); // reveals the per-tab "close others" icon
  let visible = all, hidden = [];
  if (all.length > ED_TAB_MAX) {
    visible = all.slice(0, ED_TAB_SHOW);
    hidden = all.slice(ED_TAB_SHOW);
    const active = hidden.find((t) => t.id === activeId);
    if (active) {
      visible = [...visible, active];
      hidden = hidden.filter((t) => t.id !== activeId);
    }
  }
  return (
    <div style={edS.tabbar}>
      {visible.map((t) => {
        const on = t.id === activeId;
        return (
          <div key={t.id} style={edS.tab(on)} onClick={() => onTab && onTab(t.id)} title={t.title}
            onMouseEnter={() => setHoverTab(t.id)} onMouseLeave={() => setHoverTab((h) => h === t.id ? null : h)}>
            <EdIcon name={t.kind === 'bucket' ? 'library' : 'file-text'} size={13} style={{ color: on ? 'var(--brand-fg)' : 'var(--text-faint)' }} />
            <span style={{ maxWidth: 150, minWidth: 18, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
            {onCloseOthers && all.length > 1 && (
              <span onClick={(e) => { e.stopPropagation(); onCloseOthers(t.id); }} title="Close other tabs"
                style={{ display: 'inline-flex', marginLeft: 2, opacity: 0.55, borderRadius: 3, visibility: hoverTab === t.id ? 'visible' : 'hidden' }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; e.currentTarget.style.background = 'var(--surface-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = 0.55; e.currentTarget.style.background = 'transparent'; }}>
                <EdIcon name="copy-x" size={12} />
              </span>
            )}
            <span onClick={(e) => { e.stopPropagation(); onCloseTab && onCloseTab(t.id); }} style={{ display: 'inline-flex', marginLeft: 2, opacity: 0.55, borderRadius: 3 }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; e.currentTarget.style.background = 'var(--surface-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = 0.55; e.currentTarget.style.background = 'transparent'; }}>
              <EdIcon name="x" size={12} />
            </span>
          </div>
        );
      })}
      {hidden.length > 0 && (
        <div style={{ position: 'relative', height: '100%' }}>
          <div onClick={() => setMoreOpen((o) => !o)} title={`${hidden.length} more open tab${hidden.length !== 1 ? 's' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: 5, height: '100%', padding: '0 12px', borderRight: '1px solid var(--border-subtle)', cursor: 'pointer', color: 'var(--text-subtle)', fontSize: 12, whiteSpace: 'nowrap' }}>
            {hidden.length} more…
            <EdIcon name="chevron-down" size={12} style={{ color: 'var(--text-faint)' }} />
          </div>
          {moreOpen && (
            <React.Fragment>
              <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setMoreOpen(false)} />
              <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 41, minWidth: 200, maxWidth: 280, maxHeight: 320, overflowY: 'auto', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-xl)', padding: 4 }}>
                {hidden.map((t) => (
                  <div key={t.id} onClick={() => { setMoreOpen(false); onTab && onTab(t.id); }} title={t.title}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 12.5, color: 'var(--text-body)' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                    <EdIcon name={t.kind === 'bucket' ? 'library' : 'file-text'} size={13} style={{ color: 'var(--text-faint)' }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                    <span onClick={(e) => { e.stopPropagation(); onCloseTab && onCloseTab(t.id); }} style={{ display: 'inline-flex', opacity: 0.55, borderRadius: 3 }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; e.currentTarget.style.background = 'var(--surface-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = 0.55; e.currentTarget.style.background = 'transparent'; }}>
                      <EdIcon name="x" size={12} />
                    </span>
                  </div>
                ))}
              </div>
            </React.Fragment>
          )}
        </div>
      )}
      <div style={{ flex: 1 }} />
      <EdIconBtn icon="panel-right-close" label="Toggle context pane" size="sm" onClick={onTogglePane} />
    </div>
  );
}

function BucketBody({ bucket: b, onOpen }) {
  return (
    <div style={edS.scroll}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 36px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft-bg)', border: '1px solid var(--brand-soft-border)' }}>
            <EdIcon name="library" size={22} style={{ color: 'var(--brand-fg)' }} />
          </span>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-3xl)', fontWeight: 600, color: 'var(--text-strong)', margin: 0 }}>{b.name}</h1>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)', marginTop: 4 }}>{b.group} · {b.notes} notes · recall {b.recall.toFixed(2)}</div>
          </div>
          <EdScope scope={b.scope} />
        </div>
        <p style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', lineHeight: 1.6, color: 'var(--text-body)', margin: '0 0 18px' }}>{b.desc}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
          {b.topics.map((t) => <EdBadge key={t} tone="info">#{t}</EdBadge>)}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-subtle)', marginBottom: 8 }}>contributors</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
          {b.contributors.map((m) => <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 4px', border: '1px solid var(--border)', borderRadius: 'var(--radius-full)' }}><EdAvatar name={m} size={20} /><span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{m}</span></div>)}
        </div>
        <button onClick={() => onOpen && onOpen()} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 36, padding: '0 16px', border: '1px solid var(--brand-soft-border)', background: 'var(--brand-soft-bg)', color: 'var(--brand-fg)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600 }}>
          <EdIcon name="sparkles" size={15} />Ask this bucket
        </button>
      </div>
    </div>
  );
}

// Confidentiality picker: the note's real "who can see this" control. Maps the
// internal scope value to plain business words (Private / Team / Company) and
// persists the change via onSetScope (rewrites frontmatter + reindex). Any scope
// that isn't team/company reads as Private (a solo library's purpose scope like
// "engineering" is just "your private notes").
const VIS_LEVELS = [
  { id: 'private', label: 'Private', icon: 'lock', hint: 'Only you' },
  { id: 'team', label: 'Team', icon: 'users', hint: 'Your team can see it' },
  { id: 'company', label: 'Company', icon: 'building-2', hint: 'Everyone in your org' },
];
function visOf(scope) {
  const s = String(scope || '').toLowerCase();
  return (s === 'team' || s === 'company' || s === 'enterprise') ? (s === 'enterprise' ? 'company' : s) : 'private';
}
function VisibilityControl({ note, onSetScope }) {
  const [open, setOpen] = React.useState(false);
  const cur = visOf(note && note.scope);
  const active = VIS_LEVELS.find((v) => v.id === cur) || VIS_LEVELS[0];
  if (!onSetScope) return null;
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} title="Change who can see this note"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-inset)', color: 'var(--text-body)', fontFamily: 'var(--font-sans)', fontSize: 12, cursor: 'pointer' }}>
        <EdIcon name={active.icon} size={13} style={{ color: cur === 'private' ? 'var(--text-faint)' : 'var(--brand-fg)' }} />{active.label}
        <EdIcon name="chevron-down" size={12} style={{ color: 'var(--text-faint)' }} />
      </button>
      {open && (
        <React.Fragment>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 41, minWidth: 190, background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-xl)', padding: 4 }}>
            {VIS_LEVELS.map((v) => (
              <div key={v.id} onClick={async () => {
                setOpen(false);
                if (v.id === cur) return;
                await onSetScope(v.id);
              }} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', background: v.id === cur ? 'var(--surface-hover)' : 'transparent' }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = v.id === cur ? 'var(--surface-hover)' : 'transparent'}>
                <EdIcon name={v.icon} size={14} style={{ color: v.id === 'private' ? 'var(--text-faint)' : 'var(--brand-fg)', flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--text-strong)', fontWeight: v.id === cur ? 600 : 400 }}>{v.label}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>{v.hint}</div>
                </div>
              </div>
            ))}
          </div>
        </React.Fragment>
      )}
    </div>
  );
}

function Editor({ note, bucket, tabs, activeId, onTab, onCloseTab, onCloseOthers, onTogglePane, mode, onMode, onOpen, scope, onScope, scopeOptions, onSetScope }) {
  if (bucket) {
    return (
      <div style={edS.center}>
        <TabStrip tabs={tabs} activeId={activeId} onTab={onTab} onCloseTab={onCloseTab} onCloseOthers={onCloseOthers} onTogglePane={onTogglePane} />
        <BucketBody bucket={bucket} onOpen={onOpen} />
      </div>
    );
  }
  return (
    <div style={edS.center}>
      <TabStrip tabs={tabs} activeId={activeId} onTab={onTab} onCloseTab={onCloseTab} onCloseOthers={onCloseOthers} onTogglePane={onTogglePane} />
      <div style={edS.toolbar}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>{note.path || (note.title + '.md')}</span>
        <div style={{ flex: 1 }} />
        {note.tags && note.tags.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '46%' }}>
            {note.tags.slice(0, 6).map((t) => <EdBadge key={t} tone="info">#{t}</EdBadge>)}
            {note.tags.length > 6 && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}>+{note.tags.length - 6}</span>}
          </div>
        )}
        {/* Confidentiality control — changing this actually re-writes the note's
            visibility on disk and refreshes the memory (see wired-app
            onSetNoteScope), so it is the real "who can see this" switch. */}
        <VisibilityControl note={note} onSetScope={onSetScope} />
        {mode === 'edit' && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>editing · click away or ⌘S to save</span>
        )}
      </div>

      {/* The demo's calm editor: no Read/Edit toggle. Reading view by default;
          CLICK the body to edit (textarea autofocuses); blur or Cmd/Ctrl-S saves
          and returns to reading. */}
      <div style={edS.scroll}>
        {mode === 'edit'
          ? <div style={edS.col}>
              <textarea autoFocus value={note.raw || ''} onChange={(e) => note.onEdit && note.onEdit(e.target.value)}
                onBlur={() => onMode && onMode('read')}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 's') { e.preventDefault(); onMode && onMode('read'); }
                }}
                style={{ display: 'block', width: '100%', minHeight: 'calc(100vh - 180px)', resize: 'none', border: 'none', borderRadius: 0, background: 'transparent', color: 'var(--text-body)', fontFamily: 'var(--font-mono)', fontSize: 14, lineHeight: 1.8, padding: 0, outline: 'none', boxSizing: 'border-box', caretColor: 'var(--brand-fg)' }} />
            </div>
          : <div style={edS.col} onClick={() => onMode && onMode('edit')} title="Click to edit">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 18px', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{note.path || (note.title + '.md')}</span>
                {note.updated && <span style={{ flexShrink: 0 }}>· updated {note.updated}</span>}
              </div>
              {note.body.map((b, i) => <Block key={i} b={b} note={note} onOpen={onOpen} />)}
            </div>}
      </div>
    </div>
  );
}

// Small free-form (force-directed) "local graph" of a note's connections (center = this note).
// Nodes are draggable — dragging pins a node to the pointer and reheats the
// simulation, so the layout physically reacts (push/settle) like the main graph.
// `cameFromPath`: when set, the node the user just navigated FROM (via a backlink
// click) is ringed in a distinct color — a breadcrumb so clicking "back" is legible.
function EdMiniGraph({ connections, onOpen, centerLabel, cameFromPath }) {
  const [hover, setHover] = React.useState(null);
  const [, tickRender] = React.useReducer((x) => (x + 1) % 1e9, 0);
  const dataRef = React.useRef({ nodes: [], links: [] });
  const simRef = React.useRef(null);
  const svgRef = React.useRef(null);
  const draggingRef = React.useRef(null);
  const movedRef = React.useRef(false);
  const W = 120, H = 112, cx = 60, cy = 52;
  const colOf = (k) => k === 'tag' ? 'var(--amber-400)' : k === 'folder' ? 'var(--jade-500)' : 'var(--azure-500)';
  const items = connections.slice(0, 18);

  React.useEffect(() => {
    const d3 = window.d3; if (!d3) return;
    const center = { nid: '__self', fx: cx, fy: cy };
    const ns = items.map((c, i) => ({ ...c, nid: c.id || ('n' + i), x: cx + (i % 2 ? 1 : -1) * (8 + i), y: cy + (i % 3 - 1) * (8 + i) }));
    const nodes = [center, ...ns];
    const links = ns.map((c) => ({ source: '__self', target: c.nid }));
    dataRef.current = { nodes, links };
    const sim = d3.forceSimulation(nodes)
      .force('charge', d3.forceManyBody().strength(-34))
      .force('link', d3.forceLink(links).id((d) => d.nid).distance(20).strength(0.75))
      .force('collide', d3.forceCollide(6.5))
      .force('x', d3.forceX(cx).strength(0.05))
      .force('y', d3.forceY(cy).strength(0.05))
      .alpha(1).alphaDecay(0.045);
    sim.on('tick', tickRender);
    simRef.current = sim;
    return () => { sim.on('tick', null); sim.stop(); simRef.current = null; };
  }, [connections]);

  const { nodes, links } = dataRef.current;
  const byId = {}; nodes.forEach((n) => { byId[n.nid] = n; });
  const clampX = (v) => Math.max(5, Math.min(W - 5, v));
  const clampY = (v) => Math.max(5, Math.min(H - 12, v));
  const self = byId['__self'];
  const hov = hover ? byId[hover] : null;

  // Convert a pointer event's client coords to the SVG's local viewBox space.
  const toLocal = (clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return { x: cx, y: cy };
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: cx, y: cy };
    return { x: ((clientX - rect.left) / rect.width) * W, y: ((clientY - rect.top) / rect.height) * H };
  };

  const startDrag = (n) => (e) => {
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    draggingRef.current = n.nid;
    movedRef.current = false;
    if (simRef.current) simRef.current.alphaTarget(0.5).restart();
    const p = toLocal(e.clientX, e.clientY);
    n.fx = p.x; n.fy = p.y;
    tickRender();
  };
  const onDrag = (n) => (e) => {
    if (draggingRef.current !== n.nid) return;
    movedRef.current = true;
    const p = toLocal(e.clientX, e.clientY);
    n.fx = p.x; n.fy = p.y;
    tickRender();
  };
  const endDrag = (n) => (e) => {
    if (draggingRef.current !== n.nid) return;
    draggingRef.current = null;
    n.fx = null; n.fy = null; // release back into the simulation instead of staying pinned
    if (simRef.current) simRef.current.alphaTarget(0);
    if (!movedRef.current) onOpen(n.path); // a click, not a drag
  };

  return (
    <svg ref={svgRef} viewBox="0 0 120 112" style={{ width: '100%', height: 168, display: 'block', touchAction: 'none' }}>
      {links.map((l, i) => {
        const tid = (l.target && l.target.nid) || l.target;
        const a = self, b = byId[tid];
        if (!a || !b || a.x == null || b.x == null) return null;
        const lit = hover === tid;
        return <line key={i} x1={clampX(a.x)} y1={clampY(a.y)} x2={clampX(b.x)} y2={clampY(b.y)}
          stroke={lit ? colOf(b.kind) : 'var(--border-strong)'} strokeWidth={lit ? 1.2 : 0.55} opacity={hover && !lit ? 0.22 : 0.8} />;
      })}
      {nodes.filter((n) => n.nid !== '__self').map((n) => {
        if (n.x == null) return null;
        const lit = hover === n.nid;
        const isTrail = cameFromPath && n.path && String(n.path).toLowerCase() === String(cameFromPath).toLowerCase();
        return <circle key={n.nid} cx={clampX(n.x)} cy={clampY(n.y)} r={lit ? 5.6 : (isTrail ? 5.2 : 4)} fill={colOf(n.kind)}
          stroke={isTrail ? 'var(--brand-fg)' : 'var(--surface-panel)'} strokeWidth={isTrail ? 1.6 : 0.6}
          opacity={hover && !lit ? 0.4 : 1} style={{ cursor: 'grab' }}
          onMouseEnter={() => setHover(n.nid)} onMouseLeave={() => setHover((h) => h === n.nid ? null : h)}
          onPointerDown={startDrag(n)} onPointerMove={onDrag(n)} onPointerUp={endDrag(n)} onPointerCancel={endDrag(n)} />;
      })}
      {self && self.x != null && <circle cx={clampX(self.x)} cy={clampY(self.y)} r={6.5} fill="var(--brand-fg)" stroke="var(--surface-panel)" strokeWidth={1} />}
      <text x={cx} y={107} textAnchor="middle" style={{ fontFamily: 'var(--font-sans)', fontSize: 6.4, fontWeight: 600, fill: 'var(--text-strong)', pointerEvents: 'none' }}>
        {(hov ? hov.label : (centerLabel || 'this note')).slice(0, 32)}
      </text>
    </svg>
  );
}

function ContextPane({ note, onAsk, connections, onOpenNote, cameFromId, onHide }) {
  const [tab, setTab] = React.useState('backlinks');
  const conns = connections || [];
  return (
    <div style={edS.context}>
      {/* Header: chat opens the Ask panel (same as the bottom CTA, reachable
          without scrolling); hide collapses the pane (reopen via the tab-strip
          panel icon). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px 0', justifyContent: 'flex-end' }}>
        <EdIconBtn icon="sparkles" label="Chat about this note" size="sm" onClick={onAsk} />
        <EdIconBtn icon="panel-right-close" label="Hide pane" size="sm" onClick={onHide} />
      </div>
      <div style={{ padding: '0 12px' }}>
        <EdTabs value={tab} onChange={setTab} tabs={[
          { value: 'backlinks', label: 'Mentioned in', count: conns.length },
          { value: 'outline', label: 'Outline' },
        ]} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {tab === 'backlinks' && (conns.length === 0
          ? <div style={{ fontSize: 12.5, color: 'var(--text-faint)', padding: '8px 8px', lineHeight: 1.5 }}>No connections yet. Add a <code>[[wikilink]]</code> or tag and refresh.</div>
          : <React.Fragment>
            <div style={{ background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', marginBottom: 10 }}>
              <EdMiniGraph connections={conns} centerLabel={note.title} onOpen={(p) => onOpenNote && onOpenNote(p)} cameFromPath={cameFromId} />
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)', margin: '0 4px 6px' }}>{conns.length} connection{conns.length !== 1 ? 's' : ''} · click to open</div>
            {conns.map((c, i) => {
              const meta = c.kind === 'folder' ? { lbl: 'Same folder', sub: 'sits in the same folder', icon: 'folder', col: 'var(--jade-500)' }
                : c.kind === 'tag' ? { lbl: 'Shared tag', sub: 'shares a #tag', icon: 'hash', col: 'var(--amber-400)' }
                : (c.dir === 'in' ? { lbl: 'Mentions this', sub: 'links to this note', icon: 'corner-down-left', col: 'var(--azure-500)' }
                  : { lbl: 'Outgoing link', sub: 'this note links to it', icon: 'corner-up-right', col: 'var(--azure-500)' });
              return (
                <div key={c.id || i} onClick={() => onOpenNote && onOpenNote(c.path)} title={meta.sub} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 9px', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 'var(--radius-sm)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-inset)', border: '1px solid var(--border)' }}>
                    <EdIcon name={meta.icon} size={13} style={{ color: meta.col }} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.col, flexShrink: 0 }} />{meta.lbl}
                    </div>
                  </div>
                  <EdIcon name="arrow-up-right" size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
                </div>
              );
            })}
          </React.Fragment>
        )}
        {tab === 'outline' && note.outline.map((h, i) => (
          <div key={i} style={{ padding: '6px 8px', paddingLeft: 8 + (i === 0 ? 0 : 14), fontSize: 13, color: i === 0 ? 'var(--text-strong)' : 'var(--text-muted)', fontWeight: i === 0 ? 600 : 400, cursor: 'pointer' }}>{h}</div>
        ))}
      </div>
      <div style={{ padding: 12, borderTop: '1px solid var(--divider)' }}>
        <button onClick={onAsk} style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          height: 34, border: '1px solid var(--brand-soft-border)', background: 'var(--brand-soft-bg)',
          color: 'var(--brand-fg)', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
          fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600,
        }}>
          <EdIcon name="sparkles" size={15} />Ask about this note
        </button>
      </div>
    </div>
  );
}

// Floating local-graph card — the same EdMiniGraph as the context pane, but
// floated over the editor ("in the notebook"). Collapsible; hidden when the note
// has no connections. Positioned by its parent (an absolute-in-relative container).
function FloatingGraph({ note, connections, onOpenNote, cameFromId }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const conns = connections || [];
  if (!note || conns.length === 0) return null;
  return (
    <div style={{
      position: 'absolute', right: 16, bottom: 16, zIndex: 20,
      width: collapsed ? 'auto' : 210,
      background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)',
      borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)', overflow: 'hidden',
    }}>
      <div onClick={() => setCollapsed((c) => !c)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 9px', cursor: 'pointer',
          borderBottom: collapsed ? 'none' : '1px solid var(--divider)' }}>
        <EdIcon name="network" size={13} style={{ color: 'var(--brand-fg)' }} />
        <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {conns.length} connection{conns.length !== 1 ? 's' : ''}
        </span>
        <EdIcon name={collapsed ? 'chevron-up' : 'chevron-down'} size={13} style={{ color: 'var(--text-faint)' }} />
      </div>
      {!collapsed && (
        <div style={{ padding: 6 }}>
          <EdMiniGraph connections={conns} centerLabel={note.title} onOpen={(p) => onOpenNote && onOpenNote(p)} cameFromPath={cameFromId} />
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--text-faint)', textAlign: 'center', marginTop: 2 }}>click a node to open</div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { LoreEditor: Editor, LoreContextPane: ContextPane, LoreFloatingGraph: FloatingGraph });
