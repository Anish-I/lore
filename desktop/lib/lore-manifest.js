// Lore desktop — per-folder `.lore` manifest (discovery/breadcrumb cache).
//
// A human-readable JSON file written into each library root Lore works on, so a
// fresh start (or another machine) can rediscover where Lore has worked without
// re-walking everything. The folder's own notes remain the source of truth —
// `.lore` is a cache: {version, tenant, scope, indexed:{count, updatedAt},
// topics:[...], tags:[...], worklog:[{ts, action, summary}]}.
//
// No Electron imports — requireable from plain Node (tests, scraper contexts).
'use strict';
const fs = require('fs');
const path = require('path');

const MANIFEST = '.lore';
const VERSION = 1;
const MAX_WORKLOG = 50; // keep the breadcrumb small — newest entries win

function manifestPath(root) {
  return path.join(root, MANIFEST);
}

function skeleton() {
  return {
    version: VERSION,
    tenant: null,
    scope: null,
    indexed: { count: 0, updatedAt: null },
    topics: [],
    tags: [],
    worklog: [],
  };
}

// Read a root's manifest. Returns the parsed object, or null when the file is
// missing/corrupt (a broken breadcrumb must never break the app).
function read(root) {
  try {
    const data = JSON.parse(fs.readFileSync(manifestPath(root), 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch { return null; }
}

// Merge `data` over the existing manifest (or a fresh skeleton) and persist.
// Atomic-ish: write to a temp file then rename, so a reader never sees a
// half-written manifest. Returns the persisted object.
function write(root, data) {
  const current = read(root) || skeleton();
  const next = { ...current, ...(data || {}), version: VERSION };
  if (data && data.indexed) next.indexed = { ...current.indexed, ...data.indexed };
  if (!Array.isArray(next.topics)) next.topics = [];
  if (!Array.isArray(next.tags)) next.tags = [];
  if (!Array.isArray(next.worklog)) next.worklog = [];
  next.worklog = next.worklog.slice(-MAX_WORKLOG);
  const p = manifestPath(root);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
  return next;
}

// Append a worklog entry {action, summary} (ts is stamped here), creating the
// manifest if it doesn't exist yet. Trimmed to MAX_WORKLOG, newest last.
function appendWorklog(root, entry) {
  const current = read(root) || skeleton();
  const e = {
    ts: new Date().toISOString(),
    action: String((entry && entry.action) || 'note'),
    summary: String((entry && entry.summary) || ''),
  };
  const log = Array.isArray(current.worklog) ? current.worklog : [];
  return write(root, { ...current, worklog: [...log, e].slice(-MAX_WORKLOG) });
}

module.exports = { MANIFEST, VERSION, MAX_WORKLOG, manifestPath, read, write, appendWorklog };
