// Lore desktop — mock data for the surfaces NOT yet backed by an API (M1).
// Workspace tree, note content, presets, and Ask are REAL (see wired-app.jsx).
// Projects / Groups / Buckets / Graph / Settings render the design on this mock.
window.LoreMock = {
  projects: [
    { id: 'p-acme', name: 'Acme renewal', scope: 'team', notes: 12, members: ['Alice Ng', 'Bob Reyes', 'Cara Lin'], updated: '12 min ago', desc: 'Cross-functional push to land the Q3 renewal at the approved price.' },
    { id: 'p-onboard', name: 'Sales onboarding', scope: 'enterprise', notes: 34, members: ['Dan Cole', 'Cara Lin'], updated: '2 hours ago', desc: 'The living handbook for new AEs — playbooks, scripts, and account context.' },
    { id: 'p-comp', name: 'Competitive intel', scope: 'team', notes: 21, members: ['Bob Reyes', 'Eve Park', 'Alice Ng'], updated: 'yesterday', desc: 'What we know about Globex, Initech, and the rest of the field.' },
    { id: 'p-q3', name: 'Q3 forecast', scope: 'private', notes: 7, members: ['Alice Ng'], updated: '3 days ago', desc: 'Personal working notes ahead of the quarterly business review.' },
  ],
  groups: [
    { id: 'g-sales', name: 'Sales', scope: 'team', members: 6, vaults: 6 },
    { id: 'g-eng', name: 'Engineering', scope: 'team', members: 14, vaults: 14 },
    { id: 'g-co', name: 'Everyone at Northwind', scope: 'enterprise', members: 142, vaults: 142 },
  ],
  buckets: [
    { id: 'b-accounts', name: 'Account intelligence', scope: 'team', group: 'Sales', notes: 84, contributors: ['Alice Ng', 'Bob Reyes', 'Cara Lin', 'Dan Cole'], topics: ['renewals', 'pricing', 'champions'], recall: 0.91, updated: '8 min ago', desc: 'Everything the team knows about active accounts — context, risks, and history.' },
    { id: 'b-playbooks', name: 'Playbooks', scope: 'enterprise', group: 'Northwind', notes: 46, contributors: ['Bob Reyes', 'Eve Park'], topics: ['discounting', 'renewals', 'onboarding'], recall: 0.88, updated: '1 hour ago', desc: 'The canonical how-we-sell reference, owned by RevOps and read by everyone.' },
    { id: 'b-compete', name: 'Competitive intel', scope: 'team', group: 'Sales', notes: 38, contributors: ['Bob Reyes', 'Alice Ng', 'Eve Park'], topics: ['globex', 'initech', 'market'], recall: 0.84, updated: 'yesterday', desc: 'Field notes on the competition, refreshed after every deal.' },
    { id: 'b-research', name: 'Customer research', scope: 'enterprise', group: 'Product', notes: 121, contributors: ['Cara Lin', 'Dan Cole', 'Faye Wu', 'Gil Tan'], topics: ['interviews', 'jtbd', 'feedback'], recall: 0.93, updated: '2 days ago', desc: 'Interview transcripts and synthesis the whole company can ask against.' },
    { id: 'b-personal', name: 'My working notes', scope: 'private', group: 'Alice', notes: 29, contributors: ['Alice Ng'], topics: ['drafts', 'ideas', 'todos'], recall: 0.79, updated: '5 min ago', desc: 'Private scratch space — never surfaced to anyone else’s Ask.' },
    { id: 'b-meetings', name: 'Meeting memory', scope: 'team', group: 'Sales', notes: 64, contributors: ['Alice Ng', 'Bob Reyes', 'Cara Lin'], topics: ['syncs', 'standups', 'qbrs'], recall: 0.82, updated: '3 hours ago', desc: 'Auto-distilled meeting notes, linked back to the accounts they touch.' },
  ],
  settings: {
    account: { name: 'Alice Ng', email: 'alice@northwind.co', role: 'Account Executive', team: 'Sales', avatar: 'Alice Ng' },
    indexing: { embedder: 'BGE-small (local)', reranker: 'ms-marco (local)', autoIndex: true, contextual: true, localFallback: true },
    sync: { provider: 'Local · this machine', lastSync: 'just now', encrypted: true },
    connections: [
      { id: 'obsidian', name: 'Obsidian vault', detail: 'Your chosen folder', status: 'connected' },
      { id: 'gdrive', name: 'Google Drive', detail: 'Not linked', status: 'disconnected' },
      { id: 'slack', name: 'Slack', detail: 'Not linked', status: 'disconnected' },
      { id: 'notion', name: 'Notion', detail: 'Not linked', status: 'disconnected' },
    ],
  },
  graph: {
    nodes: [
      { id: 'acme', label: 'Acme Account', scope: 'team', x: 50, y: 47, r: 14, owner: 'alice', links: 6, updated: '4 min ago' },
      { id: 'renewals', label: 'Renewals Playbook', scope: 'enterprise', x: 27, y: 27, r: 11, owner: 'bob', links: 5, updated: '1 hour ago' },
      { id: 'discount', label: 'Discounting Policy', scope: 'enterprise', x: 73, y: 23, r: 9, owner: 'bob', links: 4, updated: '2 days ago' },
      { id: 'standup', label: 'Weekly standup', scope: 'team', x: 74, y: 66, r: 8, owner: 'alice', links: 3, updated: 'yesterday' },
      { id: 'm-acme', label: 'Acme sync', scope: 'private', x: 30, y: 70, r: 7, owner: 'alice', links: 2, updated: '3 days ago' },
      { id: 'globex', label: 'Globex', scope: 'private', x: 86, y: 46, r: 8, owner: 'alice', links: 3, updated: '1 week ago' },
      { id: 'initech', label: 'Initech', scope: 'team', x: 48, y: 82, r: 8, owner: 'cara', links: 4, updated: '5 days ago' },
      { id: 'champions', label: 'Champion map', scope: 'team', x: 16, y: 50, r: 7, owner: 'bob', links: 3, updated: '6 hours ago' },
      { id: 'pricing', label: 'Pricing matrix', scope: 'enterprise', x: 60, y: 12, r: 7, owner: 'eve', links: 4, updated: '4 days ago' },
    ],
    edges: [
      ['acme', 'renewals'], ['acme', 'discount'], ['acme', 'standup'], ['acme', 'm-acme'],
      ['acme', 'initech'], ['acme', 'champions'], ['renewals', 'discount'], ['renewals', 'champions'],
      ['discount', 'pricing'], ['globex', 'discount'], ['initech', 'champions'],
    ],
  },
};
