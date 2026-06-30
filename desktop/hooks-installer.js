// Lore desktop — hooks installer (main-process module, required by main.js).
// Manages lifecycle of the lore-capture.js Claude Code hook:
//   materialize files → additive-merge settings.json → atomic write.
// Exported: detectTools, installClaude, uninstallClaude, captureStatus
'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ---------- paths ----------

const LORE_DIR    = path.join(os.homedir(), '.lore');
const HOOKS_DIR   = path.join(LORE_DIR, 'hooks');
const LIB_DIR     = path.join(LORE_DIR, 'lib');
const HOOK_SCRIPT = path.join(HOOKS_DIR, 'lore-capture.js');
const HOOK_REDACT = path.join(LIB_DIR,   'redact.js');

// Source files shipped with the Electron app.
const CAPTURE_SRC = path.join(__dirname, 'assets', 'lore-capture.js');
const REDACT_SRC  = path.join(__dirname, 'lib',    'redact.js');

const BACKEND_URL = 'http://localhost:8099';

// Claude Code settings file.
const CLAUDE_SETTINGS        = path.join(os.homedir(), '.claude', 'settings.json');
const CLAUDE_SETTINGS_BACKUP = `${CLAUDE_SETTINGS}.lore-backup`;

// Codex CLI data directory.
const CODEX_DIR = path.join(os.homedir(), '.codex');

// VS Code / Copilot global storage (Windows + Linux/macOS paths).
const VSCODE_STORAGE_CANDIDATES = [
  path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'globalStorage'),
  path.join(os.homedir(), '.config', 'Code', 'User', 'globalStorage'),
  path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage'),
];

// Claude Code hook events → per-event argv mode passed to the hook script.
const HOOK_EVENTS = {
  UserPromptSubmit: 'userprompt',
  PostToolUse:      'posttool',
  Stop:             'stop',
};

// ---------- detectTools ----------

// Returns an array describing every supported tool, regardless of installation state.
// `detected` = the tool's config directory / settings file was found on disk.
// `installed` = Lore hooks are currently wired into this tool's config.
function detectTools() {
  // Claude Code
  const claudeDetected = fs.existsSync(CLAUDE_SETTINGS);
  let claudeInstalled  = false;
  if (claudeDetected) {
    try {
      const s = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
      claudeInstalled = Object.values(s.hooks || {}).some(
        (arr) => Array.isArray(arr) && arr.some(isLoreEntry),
      );
    } catch {}
  }

  // Codex CLI
  const codexDetected = fs.existsSync(CODEX_DIR);

  // GitHub Copilot (detected via VS Code global storage)
  const copilotDetected = VSCODE_STORAGE_CANDIDATES.some((p) => fs.existsSync(p));

  return [
    {
      id: 'claude', name: 'Claude Code',
      description: 'Claude Code CLI — UserPromptSubmit / PostToolUse / Stop hooks',
      detected: claudeDetected, installed: claudeInstalled,
    },
    {
      id: 'codex', name: 'Codex CLI',
      description: 'OpenAI Codex CLI',
      detected: codexDetected, installed: false,
    },
    {
      id: 'copilot', name: 'GitHub Copilot',
      description: 'GitHub Copilot in VS Code',
      detected: copilotDetected, installed: false,
    },
    {
      id: 'generic', name: 'Generic',
      description: 'Any tool via manual integration',
      detected: true, installed: false,
    },
  ];
}

// ---------- internal helpers ----------

// Returns true when a hook entry was written by Lore.
function isLoreEntry(h) {
  return h && (h._lore === true || (typeof h.command === 'string' && h.command.includes('lore-capture.js')));
}

// Copy the hook script and redact.js into ~/.lore/hooks/ and ~/.lore/lib/ respectively.
// Must be called BEFORE touching any tool's settings file.
function materializeHookFiles() {
  fs.mkdirSync(HOOKS_DIR, { recursive: true });
  fs.mkdirSync(LIB_DIR,   { recursive: true });
  fs.copyFileSync(CAPTURE_SRC, HOOK_SCRIPT);
  fs.copyFileSync(REDACT_SRC,  HOOK_REDACT);
  // Make the hook executable on POSIX (no-op on Windows, harmless).
  try { fs.chmodSync(HOOK_SCRIPT, 0o755); } catch {}
}

// ---------- installClaude ----------

// Performs an ADDITIVE MERGE into ~/.claude/settings.json:
//   1. Reads existing settings (tolerates missing file → starts from {}).
//   2. Writes a one-time backup alongside the settings file.
//   3. For each of the three hook events (UserPromptSubmit, PostToolUse, Stop):
//      a. Ensures the array exists.
//      b. Removes any existing Lore entries (idempotent re-install).
//      c. Appends ONE new entry tagged with _lore:true.
//   4. Writes atomically via a temp file + rename.
//   5. NEVER removes or modifies non-Lore entries (obsidian, gemma4, etc.).
//
// @param {object} [opts]
// @returns {{ ok: boolean, reason?: string }}
function installClaude() {
  try {
    materializeHookFiles();
  } catch (e) {
    return { ok: false, reason: `Failed to materialize hook files: ${e.message}` };
  }

  // Read existing settings, tolerating missing or malformed file.
  let rawContent = '';
  let settings   = {};
  try {
    rawContent = fs.readFileSync(CLAUDE_SETTINGS, 'utf8');
    settings   = JSON.parse(rawContent);
  } catch {
    // Missing or unparseable → start from {}; rawContent may be empty or garbage.
  }

  // Write backup ONCE — never overwrite an existing backup.
  if (!fs.existsSync(CLAUDE_SETTINGS_BACKUP)) {
    try {
      fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
      fs.writeFileSync(CLAUDE_SETTINGS_BACKUP, rawContent || '{}', 'utf8');
    } catch (e) {
      return { ok: false, reason: `Failed to write backup: ${e.message}` };
    }
  }

  // Ensure the hooks namespace exists.
  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};

  for (const [event, modeArg] of Object.entries(HOOK_EVENTS)) {
    // Ensure the event array exists and is an array (leave other value types alone).
    if (!Array.isArray(settings.hooks[event])) settings.hooks[event] = [];

    // Remove existing Lore entries (idempotent).
    settings.hooks[event] = settings.hooks[event].filter((h) => !isLoreEntry(h));

    // Append fresh Lore entry in the REQUIRED Claude Code shape:
    //   { matcher, hooks: [{ type:'command', command }] }
    // (the previous flat {command} shape was invalid and got the whole
    // settings.json skipped). `_lore:true` tags it for idempotent removal.
    // Tool-scoped events (PostToolUse) take an empty matcher = all tools;
    // Stop is not tool-scoped, so it omits the matcher.
    const entry = {
      hooks: [{ type: 'command', command: `node "${HOOK_SCRIPT}" ${modeArg}` }],
      _lore: true,
    };
    if (event !== 'Stop') entry.matcher = '';
    settings.hooks[event].push(entry);
  }

  // Atomic write: write to a temp file, then rename over the target.
  const tmp = `${CLAUDE_SETTINGS}.lore-tmp`;
  try {
    fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
    fs.renameSync(tmp, CLAUDE_SETTINGS);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    return { ok: false, reason: `Failed to write settings: ${e.message}` };
  }

  return { ok: true };
}

// ---------- uninstallClaude ----------

// Removes only Lore-tagged entries from the three hook event arrays.
// Leaves every other entry and every other settings key untouched.
// Keeps the backup file in place.
// @returns {{ ok: boolean, reason?: string }}
function uninstallClaude() {
  if (!fs.existsSync(CLAUDE_SETTINGS)) return { ok: true, reason: 'no settings file' };

  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8')); }
  catch (e) { return { ok: false, reason: `Could not parse settings: ${e.message}` }; }

  const hooks = settings.hooks || {};
  for (const event of Object.keys(HOOK_EVENTS)) {
    if (Array.isArray(hooks[event])) {
      hooks[event] = hooks[event].filter((h) => !isLoreEntry(h));
    }
  }
  settings.hooks = hooks;

  const tmp = `${CLAUDE_SETTINGS}.lore-tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
    fs.renameSync(tmp, CLAUDE_SETTINGS);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    return { ok: false, reason: `Failed to write settings: ${e.message}` };
  }

  return { ok: true };
}

// ---------- captureStatus ----------

// Proxies GET /capture/status from the backend.
// @param {string} [sessionId]
// @returns {Promise<object>}
async function captureStatus(sessionId) {
  const qs = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : '';
  const r = await fetch(`${BACKEND_URL}/capture/status${qs}`);
  if (!r.ok) throw new Error(`/capture/status returned ${r.status}`);
  return r.json();
}

// ---------- stubs for Codex / Copilot (fast-follow) ----------

function installCodex()   { return { ok: false, reason: 'experimental — coming soon' }; }
function installCopilot() { return { ok: false, reason: 'experimental — coming soon' }; }

module.exports = {
  detectTools,
  installClaude,
  uninstallClaude,
  captureStatus,
  installCodex,
  installCopilot,
};
