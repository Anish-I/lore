// Lore desktop — live surfaces start with no seeded/demo values.

// Shared Section (top-level folder) → color, used identically by the file
// explorer (shell.jsx) and the knowledge graph (graph.jsx) so a section reads
// as the same color everywhere. Deterministic by name (stable hash, not array
// position) so a color never shifts as sections are added/removed/reordered.
// Two palettes: light-mode hexes are darker/more saturated than their
// dark-mode counterparts so nothing washes out against a near-white canvas.
window.LoreSectionPaletteDark = [
  '#5b8def', '#e0883a', '#a36bd6', '#3fa85f', '#d6b34a', '#7a8bb0',
  '#3fa89a', '#d97ba8', '#8bb04a', '#5ba3c9', '#c96b3f', '#d6504f',
  '#b0955b', '#4f9e8f',
];
window.LoreSectionPaletteLight = [
  '#2f5fc7', '#b8621a', '#7a3fb0', '#1f7a3f', '#8a6a1f', '#45568a',
  '#1f7a6e', '#a8437a', '#5c7a1f', '#2f6f96', '#8a431f', '#b8302f',
  '#7a5f2e', '#2f6f62',
];
window.LoreHashStr = function loreHashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};
window.LoreSectionColor = function loreSectionColor(name, theme) {
  if (!name) return null;
  const pal = theme === 'light' ? window.LoreSectionPaletteLight : window.LoreSectionPaletteDark;
  return pal[window.LoreHashStr(name) % pal.length];
};

window.LoreMock = {
  projects: [],
  groups: [],
  buckets: [],
  settings: {
    account: { name: null, email: null, role: null, team: null, avatar: null },
    indexing: { embedder: null, reranker: null, autoIndex: false, contextual: false, localFallback: false },
    sync: { provider: null, lastSync: null, encrypted: false },
    connections: [],
  },
  graph: { nodes: [], edges: [] },
};
