// Portable GitHub `.lore` packages.
//
// `.lore/package.json` is safe to commit; `.lore/manifest.json` is local-only.
// The package contains a deterministic gzip+base64 payload of redacted Markdown
// notes. Importers validate the envelope, digest, sizes, paths, and per-note
// hashes before returning any body to the caller.
//
// No Electron imports — requireable from plain Node and Vitest.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const loreManifest = require('./lore-manifest');
const { looksLikeSecretFile, redactSecrets } = require('./redact');

const FORMAT = 'lore.github-package';
const PAYLOAD_FORMAT = 'lore.portable-notes';
const VERSION = 1;
const PACKAGE_FILE = 'package.json';
const MAX_NOTES = 200;
const MAX_NOTE_BYTES = 512 * 1024;
const MAX_UNCOMPRESSED_BYTES = 5 * 1024 * 1024;
const MAX_COMPRESSED_BYTES = 2 * 1024 * 1024;
const MAX_ENVELOPE_BYTES = Math.ceil(MAX_COMPRESSED_BYTES * 1.5) + 64 * 1024;
const EXCLUDED_DIRS = new Set([
  'node_modules', 'vendor', 'dist', 'build', 'coverage', '.next', 'target',
  '__pycache__', 'venv',
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function packagePath(root) {
  return path.join(root, loreManifest.LORE_DIR, PACKAGE_FILE);
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 512 || value.includes('\0')) {
    throw new Error('package contains an invalid note path');
  }
  const posix = value.replace(/\\/g, '/');
  if (path.posix.isAbsolute(posix) || /^[a-zA-Z]:\//.test(posix)) {
    throw new Error(`package note path must be relative: ${value}`);
  }
  const normalized = path.posix.normalize(posix);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`package note path escapes its root: ${value}`);
  }
  return normalized;
}

function titleFrom(rel, body) {
  const frontmatterTitle = String(body).match(/^---\s*[\r\n][\s\S]*?^title:\s*["']?([^\r\n"']+)["']?\s*$[\s\S]*?^---\s*$/m);
  if (frontmatterTitle && frontmatterTitle[1].trim()) return frontmatterTitle[1].trim().slice(0, 200);
  const heading = String(body).match(/^#\s+(.+)$/m);
  if (heading && heading[1].trim()) return heading[1].trim().slice(0, 200);
  return path.posix.basename(rel).replace(/\.(md|markdown)$/i, '').slice(0, 200);
}

// Sharing is opt-in per note. A button that blindly packages an entire private
// library is too dangerous even with token redaction: ordinary prose can still
// contain confidential decisions. Users mark a note with `share: github` in its
// YAML frontmatter; every other Markdown file stays out of the package.
function isGithubShared(body) {
  const fm = String(body).match(/^---\s*[\r\n]([\s\S]*?)[\r\n]---(?:\s*[\r\n]|$)/);
  return !!(fm && /^\s*(?:share|lore-share):\s*["']?github["']?\s*$/im.test(fm[1]));
}

function scanMarkdown(root) {
  const notes = [];
  const skipped = [];
  let redacted = 0;
  let bodyBytes = 0;

  function visit(dir, relDir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); }
    catch { return; }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      let stat;
      try { stat = fs.lstatSync(abs); } catch { continue; }
      if (stat.isSymbolicLink()) { skipped.push({ path: rel, reason: 'symlink' }); continue; }
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) visit(abs, rel);
        continue;
      }
      if (!entry.isFile() || !/\.(md|markdown)$/i.test(entry.name)) continue;
      if (notes.length >= MAX_NOTES) { skipped.push({ path: rel, reason: 'note-limit' }); continue; }
      if (stat.size > MAX_NOTE_BYTES) { skipped.push({ path: rel, reason: 'file-too-large' }); continue; }

      let raw;
      try { raw = fs.readFileSync(abs, 'utf8'); }
      catch { skipped.push({ path: rel, reason: 'unreadable' }); continue; }
      if (!isGithubShared(raw)) { skipped.push({ path: rel, reason: 'not-shared' }); continue; }
      if (looksLikeSecretFile(abs, raw)) { skipped.push({ path: rel, reason: 'secret-file' }); continue; }
      const [body, changed] = redactSecrets(raw);
      const bytes = Buffer.byteLength(body);
      if (bodyBytes + bytes > MAX_UNCOMPRESSED_BYTES) {
        skipped.push({ path: rel, reason: 'package-size-limit' });
        continue;
      }
      const safePath = safeRelativePath(rel);
      notes.push({ path: safePath, title: titleFrom(safePath, body), sha256: sha256(body), body });
      bodyBytes += bytes;
      if (changed) redacted++;
    }
  }

  visit(path.resolve(root), '');
  notes.sort((a, b) => a.path.localeCompare(b.path));
  return { notes, skipped, redacted };
}

function readEnvelope(root) {
  const p = packagePath(root);
  if (!fs.existsSync(p)) return null;
  const dirStat = fs.lstatSync(path.dirname(p));
  const stat = fs.lstatSync(p);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) throw new Error('.lore must be a real directory');
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('.lore/package.json is not a regular file');
  if (stat.size > MAX_ENVELOPE_BYTES) throw new Error('.lore/package.json is too large');
  let envelope;
  try { envelope = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { throw new Error(`invalid .lore/package.json: ${e.message}`, { cause: e }); }
  return envelope;
}

function decodeEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('invalid package envelope');
  if (envelope.format !== FORMAT || envelope.version !== VERSION) throw new Error('unsupported .lore package format');
  if (envelope.encoding !== 'gzip+base64') throw new Error('unsupported .lore package encoding');
  if (typeof envelope.packageId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(envelope.packageId)) {
    throw new Error('invalid .lore package ID');
  }
  if (typeof envelope.payload !== 'string' || !/^[a-zA-Z0-9+/]*={0,2}$/.test(envelope.payload)) {
    throw new Error('invalid .lore package payload');
  }
  const compressed = Buffer.from(envelope.payload, 'base64');
  if (compressed.length > MAX_COMPRESSED_BYTES) throw new Error('.lore package payload is too large');

  let raw;
  try { raw = zlib.gunzipSync(compressed, { maxOutputLength: MAX_UNCOMPRESSED_BYTES }); }
  catch (e) { throw new Error(`cannot decompress .lore package: ${e.message}`, { cause: e }); }
  if (raw.length > MAX_UNCOMPRESSED_BYTES) throw new Error('.lore package expands beyond the size limit');
  if (sha256(raw) !== envelope.contentSha256) throw new Error('.lore package digest does not match its payload');

  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); }
  catch (e) { throw new Error(`invalid .lore package payload JSON: ${e.message}`, { cause: e }); }
  if (!payload || payload.format !== PAYLOAD_FORMAT || payload.version !== VERSION || !Array.isArray(payload.notes)) {
    throw new Error('unsupported .lore package payload');
  }
  if (payload.notes.length > MAX_NOTES || payload.notes.length !== envelope.noteCount) {
    throw new Error('.lore package note count does not match');
  }

  const seen = new Set();
  const notes = payload.notes.map((note) => {
    if (!note || typeof note !== 'object' || typeof note.body !== 'string' || typeof note.title !== 'string') {
      throw new Error('.lore package contains an invalid note');
    }
    const rel = safeRelativePath(note.path);
    const pathKey = rel.toLowerCase(); // packages must remain collision-free on Windows/macOS too
    if (seen.has(pathKey)) throw new Error(`.lore package contains duplicate note path: ${rel}`);
    seen.add(pathKey);
    if (Buffer.byteLength(note.body) > MAX_NOTE_BYTES) throw new Error(`.lore package note is too large: ${rel}`);
    if (sha256(note.body) !== note.sha256) throw new Error(`.lore package note digest mismatch: ${rel}`);
    return { path: rel, title: note.title.slice(0, 200), sha256: note.sha256, body: note.body };
  });
  return { envelope, notes, compressedBytes: compressed.length, uncompressedBytes: raw.length };
}

function configureGitignore(root) {
  const p = path.join(root, '.gitignore');
  let lines = [];
  try { lines = fs.readFileSync(p, 'utf8').split(/\r?\n/); } catch { /* new file */ }
  // Remove only exact legacy rules that block re-including package.json. Broader
  // user rules are preserved; our final negation rules override common dotfile rules.
  const blockers = new Set(['.lore', '/.lore', '.lore/', '/.lore/']);
  lines = lines.filter((line) => !blockers.has(line.trim()));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const rules = [
    '# Lore: keep local state private; commit only the portable GitHub package',
    '!.lore/',
    '.lore/*',
    '!.lore/package.json',
  ];
  const have = new Set(lines.map((line) => line.trim()));
  for (const rule of rules) if (!have.has(rule)) lines.push(rule);
  fs.writeFileSync(p, `${lines.join('\n')}\n`, 'utf8');
}

function write(root) {
  const scan = scanMarkdown(root);
  const payloadObject = { format: PAYLOAD_FORMAT, version: VERSION, notes: scan.notes };
  const raw = Buffer.from(JSON.stringify(payloadObject));
  if (raw.length > MAX_UNCOMPRESSED_BYTES) throw new Error('portable notes exceed the package size limit');
  const digest = sha256(raw);

  let existing = null;
  try { existing = readEnvelope(root); } catch { /* replace corrupt package on explicit export */ }
  if (existing && existing.format === FORMAT && existing.contentSha256 === digest) {
    configureGitignore(root);
    return {
      ok: true, changed: false, path: packagePath(root), packageId: existing.packageId,
      contentSha256: digest, noteCount: scan.notes.length, redacted: scan.redacted,
      skipped: scan.skipped,
    };
  }

  const compressed = zlib.gzipSync(raw, { level: 9, mtime: 0 });
  if (compressed.length > MAX_COMPRESSED_BYTES) throw new Error('compressed portable notes exceed the package size limit');
  const packageId = existing && typeof existing.packageId === 'string'
    ? existing.packageId
    : crypto.randomUUID();
  const envelope = {
    format: FORMAT,
    version: VERSION,
    packageId,
    updatedAt: new Date().toISOString(),
    encoding: 'gzip+base64',
    contentSha256: digest,
    noteCount: scan.notes.length,
    redactedNotes: scan.redacted,
    skippedNotes: scan.skipped.length,
    uncompressedBytes: raw.length,
    compressedBytes: compressed.length,
    payload: compressed.toString('base64'),
  };
  loreManifest.ensureDirectory(root);
  const p = packagePath(root);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, p);
  configureGitignore(root);
  return {
    ok: true, changed: true, path: p, packageId, contentSha256: digest,
    noteCount: scan.notes.length, redacted: scan.redacted, skipped: scan.skipped,
    compressedBytes: compressed.length, uncompressedBytes: raw.length,
  };
}

function read(root) {
  const envelope = readEnvelope(root);
  if (!envelope) return null;
  return decodeEnvelope(envelope);
}

function status(root) {
  try {
    const decoded = read(root);
    if (!decoded) return { exists: false, valid: false };
    const e = decoded.envelope;
    return {
      exists: true, valid: true, path: packagePath(root), packageId: e.packageId,
      contentSha256: e.contentSha256, updatedAt: e.updatedAt || null,
      noteCount: decoded.notes.length, redactedNotes: Number(e.redactedNotes) || 0,
      skippedNotes: Number(e.skippedNotes) || 0,
      compressedBytes: decoded.compressedBytes, uncompressedBytes: decoded.uncompressedBytes,
    };
  } catch (e) {
    return { exists: true, valid: false, path: packagePath(root), error: String(e.message || e) };
  }
}

module.exports = {
  FORMAT, PAYLOAD_FORMAT, VERSION, PACKAGE_FILE, MAX_NOTES, MAX_NOTE_BYTES,
  MAX_UNCOMPRESSED_BYTES, MAX_COMPRESSED_BYTES, packagePath, safeRelativePath,
  isGithubShared, scanMarkdown, decodeEnvelope, configureGitignore, write, read, status,
};
