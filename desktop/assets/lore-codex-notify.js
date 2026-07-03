#!/usr/bin/env node
// Lore Codex capture bridge — installed to ~/.lore/hooks/lore-codex-notify.js by
// the Lore installer and registered as Codex's `notify` handler.
//
// Codex has no per-prompt hooks; it invokes `notify` at TURN END with the
// notification JSON payload as the LAST argv:
//   node lore-codex-notify.js [--previous-notify '<json argv array>'] '<payload json>'
// The payload looks like:
//   {"type":"agent-turn-complete","input-messages":[...],"last-assistant-message":"...","cwd":"..."}
//
// Behavior:
//   1. Distil the turn (User: <input-messages> / Assistant: <last-assistant-message>),
//      mirroring lore-capture.js truncation rules.
//   2. Redact secrets (../lib/redact.js), append to a rolling buffer keyed by the
//      project dir, and POST the buffer to <backend>/capture.
//   3. CHAIN: if --previous-notify is present, spawn that command (detached) with the
//      ORIGINAL payload appended as its last arg, so a pre-existing notifier still runs.
//
// Identity: same lore-config.json candidate paths as lore-capture.js. Missing
// scope/owner/tenant → skip the POST (buffer only), same as lore-capture.
//
// ALWAYS exits 0 — a notify handler must never break Codex. Requires Node 18+.
'use strict';
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const crypto  = require('crypto');
const { spawn } = require('child_process');

const LORE_DIR     = path.join(os.homedir(), '.lore');
const SESSIONS_DIR = path.join(LORE_DIR, 'sessions');
const LOG_PATH     = path.join(LORE_DIR, 'codex-notify.log');
const POST_TIMEOUT = 800; // ms

function sha1(s) { return crypto.createHash('sha1').update(String(s)).digest('hex'); }

function log(msg) {
  try { fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

// ---------- capture hygiene ----------
// Same filters as lore-capture.js (Claude side) — the 2026-07-02 audit found
// harness spans, injected memory blocks (echo loop), bare acks, and nested
// instruction-template prompts polluting the store. Codex payloads carry the
// same classes of noise, so the same rules apply on this write path.
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

const ACK_RE = /^(y|yes|no|ok|okay|sure|continue|keep going|do it|go|thanks|ty|yep|nope)[.! ]*$/i;
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

// Dedupe: identical normalized turn content for the same session within the
// window is skipped (duplicate notify fire / replayed payload).
const DEDUPE_WINDOW = 10 * 60_000;

function isDuplicate(key, cleaned, now) {
  const metaPath = path.join(SESSIONS_DIR, `${key}.meta.json`);
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}
  const h = sha1(String(cleaned).toLowerCase().replace(/\s+/g, ' ').trim());
  const dup = meta.lastHash === h && now - (meta.lastHashTs || 0) < DEDUPE_WINDOW;
  meta.lastHash = h;
  meta.lastHashTs = now;
  try { fs.writeFileSync(metaPath, JSON.stringify(meta), 'utf8'); } catch {}
  return dup;
}

// Identity config — same candidate paths as lore-capture.js loadLoreConfig().
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

// ---------- argv parsing ----------
// The payload JSON is the LAST argv. `--previous-notify '<json>'` may appear before it.
function parseArgs(argv) {
  let previousNotify = null;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--previous-notify' && i + 1 < argv.length) {
      previousNotify = argv[i + 1];
      i++;
    } else {
      rest.push(argv[i]);
    }
  }
  const payloadRaw = rest.length ? rest[rest.length - 1] : '';
  return { previousNotify, payloadRaw };
}

// ---------- distillation ----------
function distil(payload) {
  const parts = [];
  const inputs = Array.isArray(payload['input-messages']) ? payload['input-messages'] : [];
  const userText = cleanText(inputs.map((m) => String(m || '')).join(' '));
  if (userText && !isNoise(userText)) parts.push(`User: ${userText.slice(0, 500)}`);
  const asst = cleanText(typeof payload['last-assistant-message'] === 'string'
    ? payload['last-assistant-message'] : '');
  if (asst && !isNoise(asst)) {
    // Structure-aware: headings/bullets are the assistant's own summary — keep more.
    const structured = /^#{1,3} |^[-*] /m.test(asst);
    parts.push(`Assistant: ${asst.slice(0, structured ? 1500 : 800)}`);
  }
  return parts.join('\n\n');
}

// ---------- chain-forward the previous notifier ----------
function chainPrevious(previousNotify, payloadRaw) {
  if (!previousNotify) return;
  let prevArgv;
  try { prevArgv = JSON.parse(previousNotify); } catch { log('bad --previous-notify json'); return; }
  if (!Array.isArray(prevArgv) || !prevArgv.length) return;
  try {
    const [cmd, ...args] = prevArgv;
    const child = spawn(cmd, [...args, payloadRaw], { detached: true, stdio: 'ignore' });
    child.on('error', (e) => log(`prev-notify spawn error: ${e}`));
    child.unref();
  } catch (e) { log(`prev-notify chain failed: ${e}`); }
}

// ---------- flush to backend ----------
async function flush(key, text, cfg) {
  let redactSecrets = (t) => [t, false];
  try { ({ redactSecrets } = require('../lib/redact')); } catch {}
  const [redacted] = redactSecrets(text);
  if (!cfg.scope || !cfg.owner || !cfg.tenant) return; // buffer only until configured

  const BACKEND = process.env.LORE_BACKEND_URL || cfg.backendUrl || 'http://localhost:8099';
  const ac    = new AbortController();
  const timer = setTimeout(() => ac.abort(), POST_TIMEOUT);
  try {
    await fetch(`${BACKEND}/capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: key,
        title:      `Codex Session ${key.slice(6, 14)}`,
        text:       redacted,
        scope:      cfg.scope,
        owner:      cfg.owner,
        tenant:     cfg.tenant,
        mode:       'codex',
      }),
      signal: ac.signal,
    });
    clearTimeout(timer);
  } catch {
    clearTimeout(timer);
  }
}

// ---------- main ----------
async function main() {
  try { fs.mkdirSync(SESSIONS_DIR, { recursive: true }); } catch {}

  const { previousNotify, payloadRaw } = parseArgs(process.argv.slice(2));

  let payload = {};
  try { if (payloadRaw && payloadRaw.trim()) payload = JSON.parse(payloadRaw); } catch { /* keep {} */ }

  // Chain the previous notifier first (fire-and-forget) so it runs regardless of our work.
  chainPrevious(previousNotify, payloadRaw);

  if (payload.type && payload.type !== 'agent-turn-complete') return; // only capture completed turns

  const cwd = payload.cwd || process.cwd();
  const key = `codex-${sha1(cwd)}`;
  const distilled = distil(payload);
  if (!distilled) return;
  const now = Date.now();
  if (isDuplicate(key, distilled, now)) return;

  const bufPath = path.join(SESSIONS_DIR, `${key}.md`);
  const ts = new Date().toISOString();
  try { fs.appendFileSync(bufPath, `\n## Turn [${ts}]\n\n${distilled}\n`, 'utf8'); } catch {}

  let buf = '';
  try { buf = fs.readFileSync(bufPath, 'utf8'); } catch {}
  if (buf.trim()) await flush(key, buf, loadLoreConfig());
}

// Always exit 0 — never break Codex.
main().catch((e) => { log(`fatal: ${e}`); }).finally(() => process.exit(0));
