#!/usr/bin/env node
// Lore capture hook — installed to ~/.lore/hooks/lore-capture.js by the Lore installer.
// Invoked by Claude Code hooks:
//   node lore-capture.js userprompt   ← UserPromptSubmit
//   node lore-capture.js posttool     ← PostToolUse  (also reads CLAUDE_TOOL_OUTPUT env)
//   node lore-capture.js stop         ← Stop
//
// Session key resolution (in priority order):
//   1. CLAUDE_SESSION_ID env var (set by Claude Code when available)
//   2. payload.session_id from stdin JSON
//   3. sha1(process.cwd())  — stable per project directory, reconciled on Stop
//
// Buffer: ~/.lore/sessions/<key>.md  (rolling append; replaced on Stop)
// Meta:   ~/.lore/sessions/<key>.meta.json  { source_id, lastPostTs }
//
// Debounce:
//   userprompt → always flush
//   stop       → always flush
//   posttool   → flush only if now - lastPostTs >= 20 000 ms; else buffer-only
//
// Redact: requires ../lib/redact.js (installed alongside at ~/.lore/lib/redact.js).
//         If that file is missing, falls back to a no-op (still exits 0).
//
// ALWAYS exits 0 — a hook must never block Claude.
// Requires Node 18+ (global fetch).
'use strict';
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

const MODE          = process.argv[2] || 'userprompt';
const BACKEND       = 'http://localhost:8099';
const LORE_DIR      = path.join(os.homedir(), '.lore');
const SESSIONS_DIR  = path.join(LORE_DIR, 'sessions');
const POST_DEBOUNCE = 20_000; // ms — posttool flush threshold

// ---------- tiny utilities ----------

function sha1(s) { return crypto.createHash('sha1').update(String(s)).digest('hex'); }

function ensureDirs() {
  try { fs.mkdirSync(SESSIONS_DIR, { recursive: true }); } catch {}
}

// Load the Lore app config (scope/owner/tenant) from the Electron userData directory.
// Missing config leaves identity unset; capture buffers locally until the user configures it.
function loadLoreConfig() {
  const candidates = [
    process.env.APPDATA && path.join(process.env.APPDATA, 'lore-desktop', 'lore-config.json'),
    path.join(os.homedir(), '.config', 'lore-desktop', 'lore-config.json'),
    path.join(os.homedir(), 'Library', 'Application Support', 'lore-desktop', 'lore-config.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
  }
  return { scope: null, owner: null, tenant: null };
}

// ---------- per-session disk state ----------

function metaPath(key)   { return path.join(SESSIONS_DIR, `${key}.meta.json`); }
function bufferPath(key) { return path.join(SESSIONS_DIR, `${key}.md`); }

function readMeta(key) {
  try { return JSON.parse(fs.readFileSync(metaPath(key), 'utf8')); }
  catch { return { source_id: sha1(key), lastPostTs: 0 }; }
}

function writeMeta(key, meta) {
  try { fs.writeFileSync(metaPath(key), JSON.stringify(meta), 'utf8'); } catch {}
}

function readBuffer(key) {
  try { return fs.readFileSync(bufferPath(key), 'utf8'); } catch { return ''; }
}

function appendBuffer(key, text) {
  try { fs.appendFileSync(bufferPath(key), text + '\n', 'utf8'); } catch {}
}

function writeBuffer(key, text) {
  try { fs.writeFileSync(bufferPath(key), text, 'utf8'); } catch {}
}

// ---------- transcript distillation ----------
// Reuses the same logic as scraper.js ingestPromptHistory: keeps user prompts
// and assistant turns that reference files/decisions, drops tool noise and huge blobs.

function distilJsonl(jsonlPath) {
  try {
    const lines = fs.readFileSync(jsonlPath, 'utf8').split('\n').filter((l) => l.trim());
    const parts = [];
    for (const line of lines) {
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }

      const role = msg.role || msg.type;
      let content = typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join(' ')
          : null;

      if (!content || content.length < 5 || content.length > 3000) continue;

      if (role === 'user') {
        parts.push(`User: ${content.slice(0, 500)}`);
      } else if (role === 'assistant') {
        if (/\.(js|ts|py|md|json|ya?ml|sh|go|rs|sql)|error|fixed|implement|creat|updat|decision|approach|NOTE|WARNING/i.test(content)) {
          parts.push(`Assistant: ${content.slice(0, 800)}`);
        }
      }
      // tool_use / tool_result lines dropped
    }
    return parts.join('\n\n');
  } catch {
    return '';
  }
}

// ---------- flush to backend ----------
// Redacts, then POSTs to /capture with an 800 ms hard timeout.
// On any failure: keeps buffer unchanged, never throws.

async function flush(key, meta, text, cfg) {
  // Load redact — it lives at ../lib/redact.js relative to this script's installed location.
  let redactSecrets = (t) => [t, false]; // no-op fallback
  try { ({ redactSecrets } = require('../lib/redact')); } catch {}

  const [redacted] = redactSecrets(text);
  if (!cfg.scope || !cfg.owner || !cfg.tenant) {
    return;
  }

  const ac    = new AbortController();
  const timer = setTimeout(() => ac.abort(), 800);
  try {
    await fetch(`${BACKEND}/capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: key,
        title:      `Lore Session ${key.slice(0, 8)}`,
        text:       redacted,
        scope:      cfg.scope,
        owner:      cfg.owner,
        tenant:     cfg.tenant,
        mode:       MODE,
      }),
      signal: ac.signal,
    });
    clearTimeout(timer);
    meta.lastPostTs = Date.now();
    writeMeta(key, meta);
  } catch {
    clearTimeout(timer);
    // POST failed (backend down, timeout, etc.) — keep buffer, exit 0 regardless.
  }
}

// ---------- main ----------

async function main() {
  ensureDirs();

  // Read stdin JSON (Claude Code writes one JSON payload and closes stdin).
  let payload = {};
  try {
    const raw = fs.readFileSync(0, 'utf8'); // fd 0 = stdin; blocks until EOF
    if (raw.trim()) payload = JSON.parse(raw);
  } catch { /* no stdin or invalid JSON — continue with empty payload */ }

  // Resolve the session key.
  const sessionKey = process.env.CLAUDE_SESSION_ID
    || (payload.session_id ? String(payload.session_id) : null)
    || sha1(process.cwd());

  const meta = readMeta(sessionKey);
  if (!meta.source_id) meta.source_id = sha1(sessionKey);

  const cfg = loadLoreConfig();
  const now  = Date.now();
  const ts   = new Date(now).toISOString();

  // ---- userprompt ----
  if (MODE === 'userprompt') {
    const text = (
      typeof payload.prompt   === 'string' ? payload.prompt   :
      typeof payload.message  === 'string' ? payload.message  :
      JSON.stringify(payload)
    ).slice(0, 500);
    appendBuffer(sessionKey, `\n## Prompt [${ts}]\n\n${text}\n`);
    const buf = readBuffer(sessionKey);
    await flush(sessionKey, meta, buf, cfg);

  // ---- posttool ----
  } else if (MODE === 'posttool') {
    const toolOut = process.env.CLAUDE_TOOL_OUTPUT || '';
    const text = (
      typeof payload.output === 'string' ? payload.output : toolOut
    ).slice(0, 800);
    if (text) {
      appendBuffer(sessionKey, `\n### Tool [${ts}]\n\n${text}\n`);
    }
    // Flush only if the debounce window has passed since the last POST.
    if (now - (meta.lastPostTs || 0) >= POST_DEBOUNCE) {
      const buf = readBuffer(sessionKey);
      if (buf.trim()) await flush(sessionKey, meta, buf, cfg);
    }
    // else: buffer-only; do not POST.

  // ---- stop ----
  } else if (MODE === 'stop') {
    // The Stop payload carries the authoritative transcript path.
    // Prefer it over the rolling buffer for the final flush.
    const transcriptPath = payload.transcript_path || payload.transcriptPath || null;
    let finalText = '';
    if (transcriptPath) {
      finalText = distilJsonl(transcriptPath);
    }
    // Fall back to the accumulated rolling buffer if distillation yielded nothing.
    if (!finalText) finalText = readBuffer(sessionKey);
    if (finalText.trim()) {
      writeBuffer(sessionKey, finalText);  // replace buffer with clean distilled note
      await flush(sessionKey, meta, finalText, cfg);
    }
  }
}

// Always exit 0 — a hook must never block Claude under any circumstance.
main().catch(() => {}).finally(() => process.exit(0));
