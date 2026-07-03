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
const LORE_DIR      = path.join(os.homedir(), '.lore');
const SESSIONS_DIR  = path.join(LORE_DIR, 'sessions');
const POST_DEBOUNCE = 20_000; // ms — posttool flush threshold

// ---------- tiny utilities ----------

function sha1(s) { return crypto.createHash('sha1').update(String(s)).digest('hex'); }

// ---------- capture hygiene ----------
// The store audit (2026-07-02) found real pollution: injected memory-context
// blocks re-captured as data (echo loop), task-notifications and bare acks
// stored as "prompts", and a nested summarizer's system prompt captured 67
// times. Everything below runs BEFORE buffering/flushing.

// Strip spans that are harness/system content, never user knowledge. Includes
// the recall blocks Lore/Obsidian inject into prompts — capturing those would
// re-store recalled content as new data on every turn (feedback loop).
const STRIP_SPANS = [
  /<lore-memory-context>[\s\S]*?<\/lore-memory-context>/g,
  /<obsidian-memory-context>[\s\S]*?<\/obsidian-memory-context>/g,
  /<task-notification>[\s\S]*?<\/task-notification>/g,
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g,
];

function cleanText(text) {
  let t = String(text || '');
  for (const re of STRIP_SPANS) t = t.replace(re, '');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

// Bare acknowledgements carry no knowledge — they'd only pad session notes
// and win recall slots as near-exact matches for future short prompts.
const ACK_RE = /^(y|yes|no|ok|okay|sure|continue|keep going|do it|go|thanks|ty|yep|nope)[.! ]*$/i;

// Signatures of prompts that are instruction templates addressed to a model
// (nested `claude -p` runs like the Obsidian thread-writer's summarizer) —
// they are OUR plumbing, not the user's knowledge.
const TEMPLATE_RES = [
  /You summarize one Claude Code conversation turn/i,
  /^You are an? [a-z ]+\.\s*$/im,
  /UNTRUSTED DATA to (be )?summariz/i,
];

function isNoise(cleaned) {
  if (cleaned.length < 15) return true;
  if (ACK_RE.test(cleaned)) return true;
  for (const re of TEMPLATE_RES) if (re.test(cleaned)) return true;
  return false;
}

// Dedupe: identical normalized content captured for the same session within
// this window is skipped (double-fire, retry, or repeated payload).
const DEDUPE_WINDOW = 10 * 60_000;

function normHash(text) {
  return sha1(String(text).toLowerCase().replace(/\s+/g, ' ').trim());
}

function isDuplicate(meta, cleaned, now) {
  const h = normHash(cleaned);
  if (meta.lastHash === h && now - (meta.lastHashTs || 0) < DEDUPE_WINDOW) return true;
  meta.lastHash = h;
  meta.lastHashTs = now;
  return false;
}

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
      // Transcript user messages contain the injected memory-context blocks
      // (that's where hook output lands) — strip them or recall echoes back in.
      content = cleanText(content);
      if (!content || isNoise(content)) continue;

      if (role === 'user') {
        parts.push(`User: ${content.slice(0, 500)}`);
      } else if (role === 'assistant') {
        if (/\.(js|ts|py|md|json|ya?ml|sh|go|rs|sql)|error|fixed|implement|creat|updat|decision|approach|NOTE|WARNING/i.test(content)) {
          // Structure-aware distillation: headings/bullets are the assistant's
          // own summary of what happened — keep more of them than flat prose.
          const structured = /^#{1,3} |^[-*] /m.test(content);
          parts.push(`Assistant: ${content.slice(0, structured ? 1500 : 800)}`);
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

  // Wiring value: env var (LORE_BACKEND_URL) > cfg.backendUrl (already loaded above) >
  // default. cfg is loadLoreConfig()'s output, so no extra file read needed here.
  const BACKEND = process.env.LORE_BACKEND_URL || cfg.backendUrl || 'http://localhost:8099';

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
    const raw = (
      typeof payload.prompt   === 'string' ? payload.prompt   :
      typeof payload.message  === 'string' ? payload.message  :
      JSON.stringify(payload)
    );
    // Hygiene: strip harness spans (incl. injected memory blocks — echo loop),
    // then drop noise (bare acks, template prompts) and same-session duplicates.
    const text = cleanText(raw).slice(0, 500);
    if (!text || isNoise(text) || isDuplicate(meta, text, now)) {
      writeMeta(sessionKey, meta); // persist updated dedupe hash even on skip
      return;
    }
    writeMeta(sessionKey, meta);
    appendBuffer(sessionKey, `\n## Prompt [${ts}]\n\n${text}\n`);
    const buf = readBuffer(sessionKey);
    await flush(sessionKey, meta, buf, cfg);

  // ---- posttool ----
  } else if (MODE === 'posttool') {
    const toolOut = process.env.CLAUDE_TOOL_OUTPUT || '';
    const text = cleanText(
      typeof payload.output === 'string' ? payload.output : toolOut
    ).slice(0, 800);
    if (text && !isNoise(text)) {
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
    if (!finalText) finalText = cleanText(readBuffer(sessionKey));
    if (finalText.trim()) {
      writeBuffer(sessionKey, finalText);  // replace buffer with clean distilled note
      await flush(sessionKey, meta, finalText, cfg);
    }
  }
}

// Always exit 0 — a hook must never block Claude under any circumstance.
main().catch(() => {}).finally(() => process.exit(0));
