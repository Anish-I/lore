// Lore desktop — one-shot vault/file scraper (main-process only, never renderer).
// Export: runScrape({ roots, excludes, extensions, maxFiles, maxBytes,
//                     scope, owner, tenant, full, promptHistory, onProgress })
'use strict';
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const os   = require('os');
const { looksLikeSecretFile, redactSecrets } = require('./lib/redact');
const runtime = require('./lib/runtime');

// Wiring value, not a constant: env var (LORE_BACKEND_URL) > lore-config.json field
// (backendUrl) > default. Resolved fresh on every call so a config change or env
// override takes effect without a source change. No Electron import here — scraper.js
// must stay requireable from a plain Node context too.
function BACKEND_URL() { return runtime.backendUrl(); }

// Extensions routed to /reindex in Lite/Standard mode (backend owns frontmatter + chunking).
// In Full mode ALL text files go to /ingest so redaction is applied before embedding.
// .pdf/.docx: the backend extracts text server-side (core/lore/extract.py).
const REINDEX_EXTS = new Set(['.md', '.markdown', '.txt', '.pdf', '.docx']);
// Other whitelisted text extensions.
const INGEST_EXTS  = new Set(['.js', '.ts', '.py', '.json', '.yaml', '.yml', '.csv']);
const ALL_WHITELISTED = new Set([...REINDEX_EXTS, ...INGEST_EXTS]);

// ---------- hard-exclude lists (always applied, regardless of user config) ----------

// Directory/file NAMES to skip. Covers both normal-mode vaults and Full drive crawls.
const EXCLUDE_NAMES = new Set([
  // build / dep artifacts
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.venv', 'venv', 'cache', 'Cache', '.cache',
  // dotdirs already caught by name.startsWith('.'), but explicit for clarity
  '.ssh', '.aws', '.gnupg', '.docker',
  // Windows system directories (critical for Full / C:\ walks)
  'Windows', 'Program Files', 'Program Files (x86)', 'ProgramData',
  '$Recycle.Bin', 'System Volume Information',
  // User profile dirs that hold OS / browser internals
  'AppData',
  // Browser profile directories (usually inside AppData, but extra defense)
  'Google', 'Chromium', 'Chrome', 'Firefox', 'Mozilla',
  'BraveSoftware', 'Vivaldi', 'opera', 'Edge', 'Brave Browser',
]);

// Pattern-based excludes applied to the bare filename.
const EXCLUDE_PATTERNS = [
  /^\.env(\..*)?$/i,    // .env, .env.local, .env.production, etc.
  /\.key$/i,
  /\.pem$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /\.jks$/i,
  /\.keystore$/i,
  /^id_(rsa|ecdsa|ed25519|dsa)/i,
];

// ---------- shared helpers ----------

function sha1(str) {
  return crypto.createHash('sha1').update(str).digest('hex');
}

// Auth headers for the on-device backend (X-Lore-Token). Set per-run from
// runScrape opts — without it every /ingest//reindex 401s and the scrape
// "succeeds" with everything counted as skipped while the index stays empty.
let AUTH_HEADERS = {};

async function postJSON(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...AUTH_HEADERS },
    body: JSON.stringify(body),
  });
}

// Returns true when p is a bare drive/filesystem root (e.g. C:\ or /).
function isDriveRoot(p) {
  const norm   = path.normalize(p);
  const parsed = path.parse(norm);
  return parsed.root === norm || parsed.base === '';
}

function isExcluded(name) {
  if (name.startsWith('.')) return true;          // all dotfiles / dotdirs
  if (EXCLUDE_NAMES.has(name)) return true;
  for (const re of EXCLUDE_PATTERNS) if (re.test(name)) return true;
  return false;
}

// ---------- file walker ----------

// Recursively walks a single directory. Yields to the event loop every YIELD_EVERY
// entries so a 200k-file drive walk does not peg the main process.
async function walkDir(dir, { userExcludes, maxBytes }) {
  const results    = [];
  const YIELD_EVERY = 64;

  async function visit(current) {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); }
    catch { return; }

    let i = 0;
    for (const e of entries) {
      if (isExcluded(e.name)) continue;
      if (userExcludes.some((ex) => e.name === ex || e.name.includes(ex))) continue;

      const full = path.join(current, e.name);

      // Skip symlinks — follow only real directories and files.
      try { if (fs.lstatSync(full).isSymbolicLink()) continue; }
      catch { continue; }

      if (e.isDirectory()) {
        await visit(full);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!ALL_WHITELISTED.has(ext)) continue;
        try { if (fs.statSync(full).size > maxBytes) continue; }
        catch { continue; }
        results.push(full);
      }

      if (++i % YIELD_EVERY === 0) await new Promise((r) => setImmediate(r));
    }
  }

  await visit(dir);
  return results;
}

// ---------- prompt-history ingestion ----------

// Reads Claude Code transcript files under ~/.claude/projects/**/*.jsonl,
// distils each session into a compact note (user turns + key assistant decisions),
// redacts secrets, and POSTs to /ingest with source_type:'claude-history'.
async function ingestPromptHistory({ maxFiles, scope, owner, tenant, onProgress, summary }) {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(claudeDir)) {
    console.warn('[scraper] prompt history: ~/.claude/projects not found — skipping');
    return;
  }

  // Collect .jsonl files (up to 4 directory levels deep).
  const jsonlFiles = [];
  function findJsonl(dir, depth) {
    if (depth > 4) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { findJsonl(full, depth + 1); }
      else if (e.name.endsWith('.jsonl')) { jsonlFiles.push(full); }
    }
  }
  findJsonl(claudeDir, 0);

  onProgress({ phase: 'history', done: 0, total: jsonlFiles.length, current: '', errors: summary.errors });

  for (let i = 0; i < jsonlFiles.length; i++) {
    if (summary.files >= maxFiles) break;

    const jsonlPath = jsonlFiles[i];
    onProgress({ phase: 'history', done: i, total: jsonlFiles.length, current: jsonlPath, errors: summary.errors });

    try {
      const raw   = fs.readFileSync(jsonlPath, 'utf8');
      const lines = raw.split('\n').filter((l) => l.trim());

      const parts = [];
      for (const line of lines) {
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }

        const role = msg.role || msg.type;

        // Normalise content to a plain string.
        let content = null;
        if (typeof msg.content === 'string') {
          content = msg.content;
        } else if (Array.isArray(msg.content)) {
          content = msg.content
            .filter((b) => b && b.type === 'text')
            .map((b) => b.text || '')
            .join(' ');
        }

        if (!content || content.length < 5) continue;
        // Skip huge pasted blobs (tool output, file dumps).
        if (content.length > 3000) continue;

        if (role === 'user') {
          // Capture user prompts, truncated.
          parts.push(`User: ${content.slice(0, 500)}`);
        } else if (role === 'assistant') {
          // Only keep assistant text that references files, commands, errors, or decisions.
          if (/\.(js|ts|py|md|json|ya?ml|sh|go|rs|sql)|error|fixed|implement|creat|updat|decision|approach|NOTE|WARNING/i.test(content)) {
            parts.push(`Assistant: ${content.slice(0, 800)}`);
          }
        }
        // Drop tool_use / tool_result lines entirely.
      }

      if (!parts.length) continue;

      let text = parts.join('\n\n');
      const [redacted, wasRedacted] = redactSecrets(text);
      text = redacted;
      if (wasRedacted) summary.redacted++;

      // Project/session label from the path relative to ~/.claude/projects.
      const rel   = path.relative(claudeDir, jsonlPath);
      const title = `Claude Session: ${rel.replace(/\.jsonl$/, '').replace(/[\\\/]+/g, ' / ')}`;

      const r = await postJSON(`${BACKEND_URL()}/ingest`, {
        source_id:    sha1(jsonlPath),
        title,
        text,
        scope,
        owner,
        tenant,
        source_type:  'claude-history',
        content_hash: sha1(text),
      });

      if (r.ok) {
        summary.ingested++;
        summary.files++;
      } else if (r.status === 404) {
        console.warn('[scraper] /ingest 404 for claude history — skipping');
        summary.skipped++;
      } else {
        summary.skipped++;
      }
    } catch (e) {
      console.warn(`[scraper] prompt history error for ${jsonlPath}: ${e.message}`);
      summary.skipped++;
    }

    if (i % 8 === 0) await new Promise((r) => setImmediate(r));
  }
}

// ---------- main export ----------

/**
 * Run a one-shot scrape of the provided roots.
 *
 * @param {object}   opts
 * @param {string[]} opts.roots            Directories to crawl (required).
 * @param {string[]} [opts.excludes]       Extra file/dir names to skip.
 * @param {string[]} [opts.extensions]     Override whitelisted extensions.
 * @param {number}   [opts.maxFiles]       Hard cap on total files processed.
 * @param {number}   [opts.maxBytes]       Per-file size cap (bytes).
 * @param {string}   [opts.scope]          ACL scope to tag ingested notes.
 * @param {string}   [opts.owner]          owner_id forwarded to backend.
 * @param {string}   [opts.tenant]         tenant_id forwarded to backend.
 * @param {boolean}  [opts.full]           True → Full mode (drive walk allowed; all files
 *                                         go through read→redact→/ingest, never /reindex).
 * @param {boolean}  [opts.promptHistory]  True → also ingest Claude Code transcripts.
 * @param {Function} [opts.onProgress]     Called with {phase, done, total, current, errors}.
 *
 * @returns {Promise<{files, ingested, skipped, errors, redacted, secretsSkipped, errorDetails}>}
 */
async function runScrape({
  roots         = [],
  excludes      = [],
  extensions,
  maxFiles      = 50_000,
  maxBytes      = 1_000_000,
  scope         = null,
  owner         = null,
  tenant        = null,
  full          = false,
  promptHistory = false,
  headers       = {},
  onProgress    = () => {},
} = {}) {
  AUTH_HEADERS = headers || {};
  const summary = {
    files: 0, ingested: 0, skipped: 0, errors: 0,
    redacted: 0, secretsSkipped: 0,
    errorDetails: [],
  };

  // --- Guard: drive roots only permitted in Full mode ---
  const safeRoots = [];
  for (const r of roots) {
    if (isDriveRoot(r)) {
      if (!full) {
        summary.errors++;
        summary.errorDetails.push(`Refused drive root (only allowed in Full mode): ${r}`);
        onProgress({ phase: 'walk', done: 0, total: 0, current: r, errors: summary.errors });
        continue;
      }
      // Full mode: drive root is intentional — proceed, but log it.
      console.info('[scraper] Full mode: crawling drive root', r);
    }
    if (!fs.existsSync(r)) {
      summary.errors++;
      summary.errorDetails.push(`Root not found: ${r}`);
      continue;
    }
    safeRoots.push(r);
  }
  if (!safeRoots.length && !promptHistory) return summary;

  const missingIdentity = [];
  if (!scope) missingIdentity.push('scope');
  if (!owner) missingIdentity.push('owner');
  if (!tenant) missingIdentity.push('tenant');
  if (missingIdentity.length) {
    summary.errors++;
    summary.errorDetails.push(`Missing required ${missingIdentity.join(', ')}; scrape not started.`);
    onProgress({ phase: 'done', done: 0, total: 0, current: '', errors: summary.errors });
    return summary;
  }

  // --- Phase: walk ---
  if (safeRoots.length) {
    onProgress({ phase: 'walk', done: 0, total: 0, current: '', errors: summary.errors });

    let allFiles = [];
    for (const root of safeRoots) {
      const found = await walkDir(root, { userExcludes: excludes, maxBytes });
      allFiles = allFiles.concat(found);
      if (allFiles.length >= maxFiles) { allFiles = allFiles.slice(0, maxFiles); break; }
    }
    summary.files = allFiles.length;

    // In Lite/Standard (non-full) mode: split by extension as before.
    const reindexExts = extensions
      ? new Set(extensions.filter((e) => REINDEX_EXTS.has(e)))
      : REINDEX_EXTS;
    const ingestExts  = extensions
      ? new Set(extensions.filter((e) => !reindexExts.has(e)))
      : INGEST_EXTS;

    // --- Phase: ingest ---
    const total = allFiles.length;
    let done = 0;

    for (const filePath of allFiles) {
      const ext = path.extname(filePath).toLowerCase();
      onProgress({ phase: 'ingest', done, total, current: filePath, errors: summary.errors });

      try {
        if (full) {
          // Full mode: read → redact → /ingest for EVERY whitelisted file.
          // Never use /reindex here — that re-reads the raw file on the backend,
          // bypassing our redaction layer.
          let text;
          try { text = fs.readFileSync(filePath, 'utf8'); }
          catch { summary.skipped++; done++; continue; }

          if (looksLikeSecretFile(filePath, text)) {
            summary.secretsSkipped++;
            summary.skipped++;
            done++;
            continue;
          }

          const [redacted, wasRedacted] = redactSecrets(text);
          if (wasRedacted) summary.redacted++;

          const r = await postJSON(`${BACKEND_URL()}/ingest`, {
            source_id:    sha1(filePath),
            title:        path.basename(filePath),
            text:         redacted,
            scope,
            owner,
            tenant,
            source_type:  'file',
            content_hash: sha1(redacted),
          });

          if (r.status === 404) {
            console.warn(`[scraper] /ingest 404 for ${filePath} — not yet available, skipping`);
            summary.skipped++;
          } else {
            r.ok ? summary.ingested++ : summary.skipped++;
          }

        } else if (reindexExts.has(ext)) {
          // Lite/Standard: /reindex for .md/.txt (backend handles frontmatter + chunking).
          const r = await postJSON(`${BACKEND_URL()}/reindex`, {
            path:      filePath,
            owner_id:  owner,
            scope_id:  scope,
            tenant_id: tenant,
          });
          if (r.ok) {
            summary.ingested++;
          } else {
            // Surface the failure class — a whole-run of silent "skipped" 401s
            // once masked an empty index for weeks.
            summary.skipped++;
            if (summary.errorDetails.length < 5) summary.errorDetails.push(`${filePath}: /reindex HTTP ${r.status}`);
          }

        } else if (ingestExts.has(ext)) {
          // Lite/Standard: /ingest for other text files.
          let text;
          try { text = fs.readFileSync(filePath, 'utf8'); }
          catch { summary.skipped++; done++; continue; }

          const r = await postJSON(`${BACKEND_URL()}/ingest`, {
            source_id:    sha1(filePath),
            title:        path.basename(filePath),
            text,
            scope,
            owner,
            tenant,
            source_type:  'file',
            content_hash: sha1(text),
          });

          if (r.status === 404) {
            console.warn(`[scraper] /ingest 404 for ${filePath} — not yet available, skipping`);
            summary.skipped++;
          } else {
            r.ok ? summary.ingested++ : summary.skipped++;
          }

        } else {
          summary.skipped++;
        }
      } catch (e) {
        summary.errors++;
        summary.errorDetails.push(`${filePath}: ${e.message}`);
      }

      done++;
    }
  }

  // --- Phase: prompt history (optional) ---
  if (promptHistory && summary.files < maxFiles) {
    await ingestPromptHistory({ maxFiles, scope, owner, tenant, onProgress, summary });
  }

  // --- Phase: edges (best-effort; backend does incremental edges on ingest) ---
  onProgress({ phase: 'edges', done: summary.files, total: summary.files, current: '', errors: summary.errors });
  try { await postJSON(`${BACKEND_URL()}/graph/rebuild_edges`, {}); }
  catch { /* optional endpoint — ignore failure */ }

  onProgress({ phase: 'done', done: summary.files, total: summary.files, current: '', errors: summary.errors });
  return summary;
}

module.exports = { runScrape };
