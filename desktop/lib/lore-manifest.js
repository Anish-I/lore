// Lore desktop — per-folder `.lore/manifest.json` (discovery/breadcrumb cache).
//
// A human-readable JSON file written into each library root Lore works on, so a
// fresh start (or another machine) can rediscover where Lore has worked without
// re-walking everything. The folder's own notes remain the source of truth.
// The local cache lives separately from `.lore/package.json`, which is the only
// file intended for Git. The cache shape is:
// {version, tenant, scope, indexed:{count, updatedAt},
// topics:[...], tags:[...], worklog:[{ts, action, summary}]}.
//
// Older installs wrote the cache as a single `.lore` JSON file. The first write
// migrates that file into the directory layout atomically enough to roll back on
// failure; reads remain backwards-compatible until migration occurs.
//
// No Electron imports — requireable from plain Node (tests, scraper contexts).
'use strict';
const fs = require('fs');
const path = require('path');

const LORE_DIR = '.lore';
const MANIFEST_FILE = 'manifest.json';
const MANIFEST = `${LORE_DIR}/${MANIFEST_FILE}`;
const LEGACY_MANIFEST = '.lore';
const VERSION = 1;
const MAX_WORKLOG = 50; // keep the breadcrumb small — newest entries win

function manifestPath(root) {
  return path.join(root, LORE_DIR, MANIFEST_FILE);
}

function legacyManifestPath(root) {
  return path.join(root, LEGACY_MANIFEST);
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
    const dirStat = fs.lstatSync(path.join(root, LORE_DIR));
    const fileStat = fs.lstatSync(manifestPath(root));
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink() || !fileStat.isFile() || fileStat.isSymbolicLink()) return null;
    const data = JSON.parse(fs.readFileSync(manifestPath(root), 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    try {
      const stat = fs.lstatSync(legacyManifestPath(root));
      if (!stat.isFile() || stat.isSymbolicLink()) return null;
      const data = JSON.parse(fs.readFileSync(legacyManifestPath(root), 'utf8'));
      return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
    } catch { return null; }
  }
}

// Ensure `.lore` is a directory. If an old single-file manifest is present,
// preserve its exact bytes while moving it to `.lore/manifest.json`.
function ensureDirectory(root) {
  const dir = path.join(root, LORE_DIR);
  let stat;
  try {
    stat = fs.lstatSync(dir);
  } catch {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  if (stat.isSymbolicLink()) throw new Error('.lore must not be a symbolic link');
  if (stat.isDirectory()) return dir;

  // A filesystem entry exists at `.lore`, but it is not a directory. Only a
  // regular file is a supported legacy manifest; refuse devices/symlinks.
  if (!stat.isFile()) throw new Error('.lore exists but is not a directory or legacy manifest');

  const backup = path.join(root, `.lore-migrate-${process.pid}-${Date.now()}.tmp`);
  fs.renameSync(dir, backup);
  try {
    fs.mkdirSync(dir);
    fs.copyFileSync(backup, manifestPath(root));
    fs.unlinkSync(backup);
  } catch (e) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* rollback best-effort */ }
    try { fs.renameSync(backup, dir); } catch { /* preserve original backup if rename fails */ }
    throw e;
  }
  return dir;
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
  ensureDirectory(root);
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

module.exports = {
  LORE_DIR, MANIFEST_FILE, MANIFEST, LEGACY_MANIFEST, VERSION, MAX_WORKLOG,
  manifestPath, legacyManifestPath, ensureDirectory, read, write, appendWorklog,
};
