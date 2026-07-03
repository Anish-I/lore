// Lore desktop — backup mirror (main-process module).
// Incrementally copies the library's markdown into a user-picked folder — meant
// for a OneDrive/SharePoint-synced folder, so Microsoft's own client does the
// off-device transport and the files literally appear in SharePoint. That
// visibility IS the "it's happening" assurance corporate users asked for.
//
// Design: one-way mirror (library -> dest). Compares mtime+size, atomic per-file
// (tmp+rename), tracks deletions via a small manifest so a note deleted locally
// is removed from the backup too. Never touches anything but .md (+ the manifest).
'use strict';
const fs = require('fs');
const path = require('path');

const MANIFEST = '.lore-backup-manifest.json';

// Recursively list .md files under root → { relPath: {mtimeMs, size} }.
function scanMarkdown(root) {
  const out = {};
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;               // skip .lore, .git, hidden
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        try { const st = fs.statSync(abs); out[r] = { mtimeMs: Math.round(st.mtimeMs), size: st.size }; }
        catch { /* skip unreadable */ }
      }
    }
  };
  walk(root, '');
  return out;
}

function readManifest(destDir) {
  try { return JSON.parse(fs.readFileSync(path.join(destDir, MANIFEST), 'utf8')); }
  catch { return {}; }
}
function writeManifest(destDir, man) {
  try { fs.writeFileSync(path.join(destDir, MANIFEST), JSON.stringify(man), 'utf8'); } catch { /* non-fatal */ }
}

function copyAtomic(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.lore-tmp`;
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, dest);
}

// Mirror libraryRoot -> destDir. Returns {ok, copied, deleted, count, error?}.
// Refuses if destDir is inside libraryRoot (would recurse / self-mirror).
function mirror(libraryRoot, destDir) {
  if (!libraryRoot || !destDir) return { ok: false, error: 'library or backup folder not set' };
  const normLib = path.resolve(libraryRoot) + path.sep;
  const normDest = path.resolve(destDir) + path.sep;
  if (normDest.startsWith(normLib) || normLib.startsWith(normDest)) {
    return { ok: false, error: 'backup folder must not be inside (or contain) the library' };
  }
  try {
    fs.mkdirSync(destDir, { recursive: true });
    const cur = scanMarkdown(libraryRoot);
    const prev = readManifest(destDir);
    let copied = 0, deleted = 0;

    // Copy new/changed files.
    for (const [rel, meta] of Object.entries(cur)) {
      const p = prev[rel];
      if (!p || p.mtimeMs !== meta.mtimeMs || p.size !== meta.size) {
        copyAtomic(path.join(libraryRoot, rel), path.join(destDir, rel));
        copied++;
      }
    }
    // Remove backups whose source is gone.
    for (const rel of Object.keys(prev)) {
      if (!cur[rel]) {
        try { fs.unlinkSync(path.join(destDir, rel)); deleted++; } catch { /* already gone */ }
      }
    }
    writeManifest(destDir, cur);
    return { ok: true, copied, deleted, count: Object.keys(cur).length };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

module.exports = { mirror, scanMarkdown, MANIFEST };
