// Lore desktop — shared secret-redaction helpers.
// Zero external dependencies (built-ins only: path, crypto).
// Used by: scraper.js (main process) and lore-capture.js (hook process).
// module.exports = { SECRET_PATTERNS, ENV_LINE_RE, SECRET_FILE_NAME_RES,
//                    countSecretMatches, looksLikeSecretFile, redactSecrets }
'use strict';
const path = require('path');

// ---------- known secret shapes ----------
// All regexes carry the /g flag.  NEVER use these directly with exec() in a loop —
// clone them first (new RegExp(re.source, re.flags)) to avoid shared lastIndex state.

const SECRET_PATTERNS = [
  // PEM private key blocks (multi-line; [\s\S]*? crosses newlines without the /s flag)
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // AWS access key IDs
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Slack tokens: xoxb-, xoxp-, xoxa-, xoxr-, xoxs-
  /xox[baprs]-[0-9A-Za-z]{4,}-[0-9A-Za-z\-]+/g,
  // GitHub personal access tokens and app tokens
  /\bgh[ps]_[A-Za-z0-9]{36,}/g,
  // JWTs (three dot-separated base64url segments)
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{10,}/g,
  // Generic labeled secret assignments: api_key=..., password=..., token=..., etc.
  /\b(api[_-]?key|secret[_-]?key?|access[_-]?token|auth[_-]?token|password|passwd|private[_-]?key)\s*[=:]\s*["']?[A-Za-z0-9_\-\.\/+=%@!]{8,}["']?/gi,
];

// Redacts the VALUE portion of KEY=VALUE lines in env-style files.
// Matches: KEY=value  or  KEY = value  (skips blank values and comments).
const ENV_LINE_RE = /^([A-Z_][A-Z0-9_]*)\s*=\s*(?!#|$)(.+)$/gm;

// Filename patterns that mark a file as a secret store → skip entirely.
const SECRET_FILE_NAME_RES = [
  /credentials?(\.json|\.ya?ml|\.toml|\.ini)?$/i,
  /secrets?(\.json|\.ya?ml|\.toml|\.ini)?$/i,
  /^\.?authinfo$/i,
  /^\.?netrc$/i,
  /kubeconfig(\.ya?ml)?$/i,
  /service[_-]?account(\.json)?$/i,
  /vault[_-]?token$/i,
];

// ---------- helpers ----------

// Count how many known secret patterns appear in text.
// Short-circuits at 10 for performance.
function countSecretMatches(text) {
  let n = 0;
  for (const re of SECRET_PATTERNS) {
    const clone = new RegExp(re.source, re.flags);
    let m;
    while ((m = clone.exec(text)) !== null) { // eslint-disable-line no-unused-vars
      if (++n >= 10) return n;
    }
  }
  return n;
}

// Returns true when the file should be SKIPPED entirely (not redacted-and-ingested).
// Two-layer check: filename heuristic first, then content scan.
function looksLikeSecretFile(filePath, text) {
  const name = path.basename(filePath);
  for (const re of SECRET_FILE_NAME_RES) {
    if (re.test(name)) return true;
  }
  // Any PEM header → almost certainly a key or certificate file.
  if (/-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE|RSA|EC) KEY?-----/.test(text)) return true;
  // File dominated by secrets (≥3 matches across all patterns).
  return countSecretMatches(text) >= 3;
}

// Returns [redactedText, wasAnythingChanged].
//
// Env-style detection: if >30% of non-empty lines look like KEY=VALUE,
// the file is treated as env-like and the value side of every assignment
// is blanked out (in addition to the normal SECRET_PATTERNS pass).
function redactSecrets(text) {
  let out = text;

  // Env-style pass
  const nonEmpty = out.split('\n').filter((l) => l.trim().length > 0);
  const envLike  = nonEmpty.filter((l) => /^[A-Z_][A-Z0-9_]*\s*=/.test(l));
  if (nonEmpty.length > 0 && envLike.length / nonEmpty.length > 0.3) {
    out = out.replace(new RegExp(ENV_LINE_RE.source, ENV_LINE_RE.flags), '$1=[REDACTED]');
  }

  // Secret pattern pass — always use fresh RegExp instances (shared /g carries lastIndex state).
  for (const re of SECRET_PATTERNS) {
    out = out.replace(new RegExp(re.source, re.flags), '[REDACTED]');
  }

  return [out, out !== text];
}

module.exports = {
  SECRET_PATTERNS,
  ENV_LINE_RE,
  SECRET_FILE_NAME_RES,
  countSecretMatches,
  looksLikeSecretFile,
  redactSecrets,
};
