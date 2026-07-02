// Lore desktop — quote-aware TOML line editor for ~/.codex/config.toml.
// Codex's config.toml can contain triple-quoted (""") multiline strings
// (e.g. developer_instructions) that may themselves contain text that LOOKS
// like a `key = [...]` assignment. A naive whole-file regex edit would
// corrupt those blocks. Every function here tracks """ open/close state
// line-by-line so it never treats content inside a triple-quoted span as a
// real TOML key or table header.
//
// No toml npm dependency — this is a minimal, purpose-built line editor,
// not a general TOML parser. It only understands:
//   - top-level `key = value` assignments (before the first [table] header)
//   - `[table.name]` headers
//   - """triple-quoted""" string spans (single- or multi-line)
//
// Exported: configPath, read, backupOnce, atomicWrite, getRootKey,
// setRootKey, hasTable, appendTable, removeTable, parseArgvValue, formatArgv
'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ---------- paths / fs ----------

function configPath() {
  return path.join(os.homedir(), '.codex', 'config.toml');
}

// Returns the file's text, or '' if it doesn't exist yet.
function read() {
  try {
    return fs.readFileSync(configPath(), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return '';
    throw e;
  }
}

// Writes `${configPath()}.lore-backup` ONCE — never overwrites an existing
// backup, so the first-ever-seen version of the user's config is preserved.
// @returns {boolean} true if the backup was written, false if one already existed.
function backupOnce(text) {
  const target     = configPath();
  const backupPath = `${target}.lore-backup`;
  if (fs.existsSync(backupPath)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(backupPath, text, 'utf8');
  return true;
}

// Atomic write: tmp file + rename over the target.
function atomicWrite(text) {
  const target = configPath();
  const tmp    = `${target}.lore-tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* best effort cleanup */ }
    throw e;
  }
}

// ---------- line-scanning helpers ----------

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Non-overlapping count of `"""` occurrences in a single line.
function countTripleQuotes(line) {
  let count = 0;
  let idx   = 0;
  while ((idx = line.indexOf('"""', idx)) !== -1) {
    count++;
    idx += 3;
  }
  return count;
}

// True if `line` is exactly a `[table.name]` header (no array-of-tables
// `[[...]]` support — not needed for codex config.toml).
function isTableHeaderLine(line) {
  return /^\s*\[[^[\]]+\]\s*$/.test(line);
}

// Returns a parallel array: states[i] === true iff line i STARTS inside an
// open triple-quoted span (i.e. is a continuation line, or the closing line,
// of a """...""" block that opened on an earlier line).
function computeTripleStates(lines) {
  const states = [];
  let inTriple = false;
  for (const line of lines) {
    states.push(inTriple);
    if (countTripleQuotes(line) % 2 === 1) inTriple = !inTriple;
  }
  return states;
}

// ---------- root-level key = value ----------

// Returns the value-substring (trimmed) of a top-level `key = ...` line —
// i.e. one that appears before the first [table] header AND outside any
// triple-quoted span. Returns null if not found.
function getRootKey(text, key) {
  const lines = text.split('\n');
  const re    = new RegExp('^\\s*' + escapeRegExp(key) + '\\s*=\\s*(.*)$');
  let inTriple = false;
  for (const line of lines) {
    if (!inTriple) {
      if (isTableHeaderLine(line)) return null; // reached the first table; no root key found
      const m = line.match(re);
      if (m) return m[1].trim();
    }
    if (countTripleQuotes(line) % 2 === 1) inTriple = !inTriple;
  }
  return null;
}

// Sets a top-level `key = tomlValueString` line, replacing the existing
// root-level line if present, or inserting one immediately before the first
// [table] header (or at EOF if there is no header). Never touches lines
// inside a triple-quoted span or inside a [table]. Everything else is
// preserved byte-for-byte.
function setRootKey(text, key, tomlValueString) {
  const lines = text.length ? text.split('\n') : [];
  const re    = new RegExp('^\\s*' + escapeRegExp(key) + '\\s*=\\s*.*$');
  let inTriple      = false;
  let firstHeaderIdx = -1;
  let keyIdx         = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inTriple) {
      if (isTableHeaderLine(line)) {
        firstHeaderIdx = i;
        break; // root section ends here — nothing past this matters for root keys
      }
      if (keyIdx === -1 && re.test(line)) keyIdx = i;
    }
    if (countTripleQuotes(line) % 2 === 1) inTriple = !inTriple;
  }

  const newLine = `${key} = ${tomlValueString}`;

  if (keyIdx !== -1) {
    lines[keyIdx] = newLine;
  } else if (firstHeaderIdx !== -1) {
    lines.splice(firstHeaderIdx, 0, newLine);
  } else if (lines.length && lines[lines.length - 1] === '') {
    // avoid inserting after a trailing blank line produced by a final '\n'
    lines.splice(lines.length - 1, 0, newLine);
  } else {
    lines.push(newLine);
  }

  return lines.join('\n');
}

// ---------- [table] headers ----------

// Exact `[name]` header present anywhere in the file, outside any
// triple-quoted span.
function hasTable(text, name) {
  const lines  = text.split('\n');
  const states = computeTripleStates(lines);
  const re     = new RegExp('^\\s*\\[' + escapeRegExp(name) + '\\]\\s*$');
  return lines.some((line, i) => !states[i] && re.test(line));
}

// Appends `\n[name]\n` + lines (one per line) — only if the table is absent.
// Returns the original text unchanged if the table already exists.
function appendTable(text, name, lines) {
  if (hasTable(text, name)) return text;
  const body = (lines || []).map((l) => l + '\n').join('');
  return text + `\n[${name}]\n` + body;
}

// Strips the `[name]` header through the line before the next
// `[header]`/EOF. No-op (returns text unchanged) if the table is absent.
function removeTable(text, name) {
  const lines  = text.split('\n');
  const states = computeTripleStates(lines);
  const headerRe = new RegExp('^\\s*\\[' + escapeRegExp(name) + '\\]\\s*$');

  let start = -1;
  let end   = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (start === -1) {
      if (!states[i] && headerRe.test(lines[i])) start = i;
      continue;
    }
    if (!states[i] && isTableHeaderLine(lines[i])) {
      end = i;
      break;
    }
  }

  if (start === -1) return text;
  lines.splice(start, end - start);
  return lines.join('\n');
}

// ---------- argv <-> minimal TOML array-of-strings ----------

// JS array of strings -> minimal TOML array-of-strings (double-quoted,
// backslashes and quotes escaped). e.g. ['a', 'b c'] -> '["a", "b c"]'
function formatArgv(arr) {
  const items = (arr || []).map((s) => {
    const escaped = String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  });
  return `[${items.join(', ')}]`;
}

// Minimal TOML array-of-strings -> JS array of strings. Inverse of
// formatArgv. Only supports a flat, single-line array of double-quoted
// strings with \\ and \" escapes — sufficient for `notify`/argv values.
function parseArgvValue(str) {
  const s = String(str).trim();
  if (!(s.startsWith('[') && s.endsWith(']'))) {
    throw new Error(`parseArgvValue: expected a TOML array, got: ${str}`);
  }
  const inner  = s.slice(1, -1);
  const result = [];
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && /[\s,]/.test(inner[i])) i++;
    if (i >= inner.length) break;
    if (inner[i] !== '"') {
      throw new Error(`parseArgvValue: expected '"' at position ${i} in: ${str}`);
    }
    i++; // skip opening quote
    let cur = '';
    while (i < inner.length && inner[i] !== '"') {
      if (inner[i] === '\\' && i + 1 < inner.length) {
        cur += inner[i + 1];
        i += 2;
        continue;
      }
      cur += inner[i];
      i++;
    }
    if (inner[i] !== '"') {
      throw new Error(`parseArgvValue: unterminated string in: ${str}`);
    }
    i++; // skip closing quote
    result.push(cur);
  }
  return result;
}

module.exports = {
  configPath,
  read,
  backupOnce,
  atomicWrite,
  getRootKey,
  setRootKey,
  hasTable,
  appendTable,
  removeTable,
  parseArgvValue,
  formatArgv,
};
