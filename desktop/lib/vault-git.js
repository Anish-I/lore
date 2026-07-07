// Vault git history — autocommit + per-note history/diff/restore (M1-A).
//
// isomorphic-git (pure JS): end users of the packaged app don't have git.exe,
// and one code path beats a system-git-with-fallback matrix. Scope is .md
// only, debounced by the caller (main.js), so statusMatrix stays cheap at
// vault scale. All repo paths are POSIX-relative internally (isomorphic-git
// requirement on Windows).
//
// Policy (enforced by the caller): if the library root already contains a
// user-owned .git, autocommit is OPT-IN (cfg.vaultGitEnabled) — Lore must
// never commit into someone's existing repository uninvited. When Lore
// creates the repo itself, autocommit defaults ON.
const fs = require('fs');
const path = require('path');
const git = require('isomorphic-git');

const AUTHOR = { name: 'Lore', email: 'lore@local' };

function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

// Resolve + contain: rel must stay inside root (mirror of main.js pathGuard,
// re-checked here so the module is safe standalone).
function relInside(root, relPath) {
  const abs = path.resolve(root, relPath);
  const normRoot = path.resolve(root);
  if (!abs.toLowerCase().startsWith(normRoot.toLowerCase() + path.sep) && abs.toLowerCase() !== normRoot.toLowerCase()) {
    throw new Error(`path escapes vault root: ${relPath}`);
  }
  return toPosix(path.relative(normRoot, abs));
}

function hasRepo(root) {
  return fs.existsSync(path.join(root, '.git'));
}

const GITIGNORE_LINES = ['.lore', '.obsidian/workspace*', '*.lore-tmp', '.lore-backup-manifest.json'];

async function ensureRepo(root) {
  const existed = hasRepo(root);
  if (!existed) {
    await git.init({ fs, dir: root, defaultBranch: 'main' });
  }
  // Merge our ignore lines into .gitignore without clobbering user entries.
  const giPath = path.join(root, '.gitignore');
  let lines = [];
  try { lines = fs.readFileSync(giPath, 'utf8').split(/\r?\n/); } catch { /* new file */ }
  const have = new Set(lines.map((l) => l.trim()));
  const missing = GITIGNORE_LINES.filter((l) => !have.has(l));
  if (missing.length) {
    const merged = [...lines.filter((l, i) => l !== '' || i < lines.length - 1), ...missing].join('\n') + '\n';
    fs.writeFileSync(giPath, merged, 'utf8');
  }
  return { created: !existed };
}

// True when the index differs from HEAD (or HEAD doesn't exist yet but the
// index has entries). Compares blob oids via git.walk — content-exact, unlike
// statusMatrix's stat cache.
async function _indexDiffersFromHead(root) {
  let changed = false;
  let hasHead = true;
  try { await git.resolveRef({ fs, dir: root, ref: 'HEAD' }); } catch { hasHead = false; }
  if (!hasHead) {
    const idx = await git.listFiles({ fs, dir: root });
    return idx.length > 0;
  }
  await git.walk({
    fs, dir: root,
    trees: [git.TREE({ ref: 'HEAD' }), git.STAGE()],
    map: async (fp, [h, s]) => {
      if (changed || fp === '.') return;
      const ht = h ? await h.type() : null;
      const st = s ? await s.type() : null;
      if (ht === 'tree' || st === 'tree') return;
      const ho = h ? await h.oid() : null;
      const so = s ? await s.oid() : null;
      if (ho !== so) changed = true;
    },
  });
  return changed;
}

// Commit every pending .md change (adds, edits, deletions). Returns
// {ok, committed, sha} — committed:false when the tree is clean.
//
// NOTE: statusMatrix alone is NOT trusted for change detection — it compares
// size+mtime against the index, so a same-length edit landing within the same
// mtime tick reads as "unchanged". We git.add every present .md (add hashes
// content unconditionally) and then compare index vs HEAD blob oids.
async function autocommit(root, message) {
  const matrix = await git.statusMatrix({
    fs, dir: root,
    filter: (f) => f.endsWith('.md'),
  });
  let staged = 0;
  for (const [filepath, , workdir] of matrix) {
    if (workdir === 0) {
      await git.remove({ fs, dir: root, filepath });
    } else {
      await git.add({ fs, dir: root, filepath });
    }
    staged++;
  }
  if (!staged || !(await _indexDiffersFromHead(root))) {
    return { ok: true, committed: false };
  }
  const sha = await git.commit({
    fs, dir: root,
    message: message || 'lore: snapshot',
    author: AUTHOR,
  });
  return { ok: true, committed: true, sha, files: staged };
}

// Commits that touched relPath, newest first.
async function history(root, relPath, limit = 20) {
  const filepath = relInside(root, relPath);
  let commits;
  try {
    commits = await git.log({ fs, dir: root, filepath, force: true, follow: false, depth: limit * 4 });
  } catch (e) {
    if (String(e && e.code) === 'NotFoundError') return [];
    throw e;
  }
  return commits.slice(0, limit).map((c) => ({
    oid: c.oid,
    short: c.oid.slice(0, 7),
    message: (c.commit.message || '').split('\n')[0].slice(0, 120),
    when: (c.commit.author && c.commit.author.timestamp ? c.commit.author.timestamp * 1000 : null),
    author: c.commit.author ? c.commit.author.name : '',
  }));
}

async function fileAtCommit(root, relPath, oid) {
  const filepath = relInside(root, relPath);
  const { blob } = await git.readBlob({ fs, dir: root, oid, filepath });
  return Buffer.from(blob).toString('utf8');
}

// Minimal LCS line diff — enough for a readable History panel; not unified-diff.
function lineDiff(oldText, newText) {
  const a = String(oldText).split(/\r?\n/);
  const b = String(newText).split(/\r?\n/);
  const m = a.length, n = b.length;
  // LCS table (vault notes are small; guard very large bodies)
  if (m * n > 4_000_000) {
    return [{ t: 'info', s: `(diff too large: ${m} vs ${n} lines)` }];
  }
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ t: 'ctx', s: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: 'del', s: a[i] }); i++; }
    else { out.push({ t: 'add', s: b[j] }); j++; }
  }
  while (i < m) { out.push({ t: 'del', s: a[i++] }); }
  while (j < n) { out.push({ t: 'add', s: b[j++] }); }
  // Collapse long unchanged runs so the panel shows change hunks.
  const collapsed = [];
  let run = [];
  const flushRun = () => {
    if (run.length > 6) {
      collapsed.push(run[0], run[1], { t: 'info', s: `… ${run.length - 4} unchanged lines …` }, run[run.length - 2], run[run.length - 1]);
    } else collapsed.push(...run);
    run = [];
  };
  for (const row of out) {
    if (row.t === 'ctx') run.push(row);
    else { flushRun(); collapsed.push(row); }
  }
  flushRun();
  return collapsed;
}

// Diff of the file at `oid` vs the current working copy.
async function diff(root, relPath, oid) {
  const filepath = relInside(root, relPath);
  const old = await fileAtCommit(root, filepath, oid);
  let cur = '';
  try { cur = fs.readFileSync(path.join(root, filepath), 'utf8'); } catch { /* deleted since */ }
  return lineDiff(old, cur);
}

// Restore a file to its content at `oid` (atomic write), then snapshot the
// restore itself so History shows it as a step, not a mystery edit.
async function restore(root, relPath, oid) {
  const filepath = relInside(root, relPath);
  const content = await fileAtCommit(root, filepath, oid);
  const absPath = path.join(root, filepath);
  const tmp = absPath + '.lore-tmp';
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, absPath);
  const commit = await autocommit(root, `restore: ${filepath} to ${oid.slice(0, 7)}`);
  return { ok: true, restored: filepath, from: oid.slice(0, 7), commit };
}

async function status(root) {
  if (!hasRepo(root)) return { repo: false };
  let last = null;
  try {
    const [head] = await git.log({ fs, dir: root, depth: 1 });
    if (head) last = { oid: head.oid.slice(0, 7), when: head.commit.author.timestamp * 1000, message: (head.commit.message || '').split('\n')[0] };
  } catch { /* empty repo */ }
  return { repo: true, last };
}

module.exports = { ensureRepo, autocommit, history, fileAtCommit, diff, restore, status, hasRepo, lineDiff };
