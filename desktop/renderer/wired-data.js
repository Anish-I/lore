// Lore desktop — live surfaces start with no seeded/demo values.
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
