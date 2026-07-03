// Lore desktop — hooks installer (main-process module, required by main.js).
// Manages lifecycle of the lore-capture.js (write) and lore-inject.js (read)
// Claude Code hooks: materialize files → additive-merge settings.json → atomic write.
// Exported: detectTools, installClaude, uninstallClaude, captureStatus
'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const runtime   = require('./lib/runtime');
const codexToml = require('./lib/codex-toml');

// ---------- paths ----------

const LORE_DIR    = path.join(os.homedir(), '.lore');
const HOOKS_DIR   = path.join(LORE_DIR, 'hooks');
const LIB_DIR     = path.join(LORE_DIR, 'lib');
const HOOK_SCRIPT = path.join(HOOKS_DIR, 'lore-capture.js');
const INJECT_SCRIPT = path.join(HOOKS_DIR, 'lore-inject.js');
const CODEX_NOTIFY_SCRIPT = path.join(HOOKS_DIR, 'lore-codex-notify.js');
const HOOK_REDACT = path.join(LIB_DIR,   'redact.js');

// Source files shipped with the Electron app.
const CAPTURE_SRC = path.join(__dirname, 'assets', 'lore-capture.js');
const INJECT_SRC  = path.join(__dirname, 'assets', 'lore-inject.js');
const CODEX_NOTIFY_SRC = path.join(__dirname, 'assets', 'lore-codex-notify.js');
const REDACT_SRC  = path.join(__dirname, 'lib',    'redact.js');

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

  // Codex CLI — installed when config.toml's notify handler is the Lore bridge.
  const codexDetected = fs.existsSync(CODEX_DIR);
  let codexInstalled = false;
  try {
    const notify = codexToml.getRootKey(codexToml.read(), 'notify');
    codexInstalled = Boolean(notify && notify.includes('lore-codex-notify.js'));
  } catch {}

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
      description: 'OpenAI Codex CLI — turn-end capture via notify',
      detected: codexDetected, installed: codexInstalled,
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

// Returns true when a hook entry was written by Lore — matches the _lore tag,
// a top-level command, OR a command nested under hooks[] (older/untagged entries
// used the { hooks: [{ command }] } shape without a _lore flag, so a tag-only
// check would miss them and re-install would duplicate).
function isLoreEntry(h) {
  if (!h) return false;
  if (h._lore === true) return true;
  const hit = (c) => typeof c === 'string' && (c.includes('lore-capture.js') || c.includes('lore-inject.js') || c.includes('lore-codex-notify.js'));
  if (hit(h.command)) return true;
  if (Array.isArray(h.hooks)) return h.hooks.some((x) => x && hit(x.command));
  return false;
}

// Copy the hook scripts and redact.js into ~/.lore/hooks/ and ~/.lore/lib/ respectively.
// Must be called BEFORE touching any tool's settings file.
function materializeHookFiles() {
  fs.mkdirSync(HOOKS_DIR, { recursive: true });
  fs.mkdirSync(LIB_DIR,   { recursive: true });
  fs.copyFileSync(CAPTURE_SRC, HOOK_SCRIPT);
  fs.copyFileSync(INJECT_SRC,  INJECT_SCRIPT);
  fs.copyFileSync(CODEX_NOTIFY_SRC, CODEX_NOTIFY_SCRIPT);
  fs.copyFileSync(REDACT_SRC,  HOOK_REDACT);
  // Make the hooks executable on POSIX (no-op on Windows, harmless).
  try { fs.chmodSync(HOOK_SCRIPT, 0o755); } catch {}
  try { fs.chmodSync(INJECT_SCRIPT, 0o755); } catch {}
  try { fs.chmodSync(CODEX_NOTIFY_SCRIPT, 0o755); } catch {}
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
// Unless `opts.inject === false`, also appends a UserPromptSubmit entry for
// lore-inject.js (Claude reads FROM Lore) alongside the existing capture entry
// (Claude writes INTO Lore). Both entries are tagged `_lore:true` and are
// removed/re-appended together by the idempotent filter above.
//
// @param {object} [opts]
// @param {boolean} [opts.inject=true] - install the lore-inject.js recall hook
// @returns {{ ok: boolean, reason?: string }}
function installClaude(opts) {
  const injectEnabled = !(opts && opts.inject === false);

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

  // Additionally wire the recall hook (Claude reads FROM Lore) into
  // UserPromptSubmit, alongside the capture entry appended above — unless
  // the caller explicitly opted out via { inject: false }.
  if (injectEnabled) {
    settings.hooks.UserPromptSubmit.push({
      matcher: '',
      hooks: [{ type: 'command', command: `node "${INJECT_SCRIPT}"` }],
      _lore: true,
    });
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
  const r = await fetch(`${runtime.backendUrl()}/capture/status${qs}`);
  if (!r.ok) throw new Error(`/capture/status returned ${r.status}`);
  return r.json();
}

// ---------- installCodex ----------

// Registers the Lore capture bridge as Codex's `notify` handler.
// Codex allows a single top-level `notify` argv; if one already exists (e.g. a
// computer-use notifier), it is CHAINED via `--previous-notify '<json argv>'` so
// the bridge runs it after capturing. Idempotent. Triple-quoted config blocks
// (developer_instructions) are never touched — codex-toml is quote-aware.
function installCodex() {
  try {
    materializeHookFiles();
  } catch (e) {
    return { ok: false, reason: `Failed to materialize hook files: ${e.message}` };
  }
  try {
    const text = codexToml.read();
    codexToml.backupOnce(text);
    const node   = process.execPath;
    const cur    = codexToml.getRootKey(text, 'notify');

    // Already the Lore bridge → no-op (idempotent).
    if (cur && cur.includes('lore-codex-notify.js')) return { ok: true };

    let newArgv;
    if (cur) {
      // Chain the entire previous notify argv so the pre-existing notifier still runs.
      let prevArgv;
      try { prevArgv = codexToml.parseArgvValue(cur); } catch { prevArgv = null; }
      newArgv = prevArgv && prevArgv.length
        ? [node, CODEX_NOTIFY_SCRIPT, '--previous-notify', JSON.stringify(prevArgv)]
        : [node, CODEX_NOTIFY_SCRIPT];
    } else {
      newArgv = [node, CODEX_NOTIFY_SCRIPT];
    }
    const updated = codexToml.setRootKey(text, 'notify', codexToml.formatArgv(newArgv));
    codexToml.atomicWrite(updated);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `Failed to write Codex config: ${e.message}` };
  }
}

// Removes the Lore bridge from Codex's notify: if it was chaining a previous
// notifier, that previous argv is restored; otherwise the notify key is dropped.
function uninstallCodex() {
  try {
    const text = codexToml.read();
    const cur  = codexToml.getRootKey(text, 'notify');
    if (!cur || !cur.includes('lore-codex-notify.js')) return { ok: true, reason: 'not installed' };

    let argv;
    try { argv = codexToml.parseArgvValue(cur); } catch { argv = null; }
    const prevIdx = argv ? argv.indexOf('--previous-notify') : -1;
    let updated;
    if (prevIdx !== -1 && argv[prevIdx + 1]) {
      // Restore the chained notifier as the notify value.
      let prevArgv;
      try { prevArgv = JSON.parse(argv[prevIdx + 1]); } catch { prevArgv = null; }
      updated = prevArgv && prevArgv.length
        ? codexToml.setRootKey(text, 'notify', codexToml.formatArgv(prevArgv))
        : dropRootKey(text, 'notify');
    } else {
      // No chain — drop the notify line entirely by setting it empty then stripping.
      updated = dropRootKey(text, 'notify');
    }
    codexToml.atomicWrite(updated);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `Failed to write Codex config: ${e.message}` };
  }
}

// Removes a top-level `key = ...` line (quote-aware). codex-toml has no
// dedicated deleter for root keys, so do a minimal quote-aware line strip here.
function dropRootKey(text, key) {
  const lines = text.split('\n');
  let inTriple = false;
  const re = new RegExp('^\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=');
  const out = [];
  for (const line of lines) {
    const isKey = !inTriple && re.test(line) && !/^\s*\[/.test(line);
    if (!isKey) out.push(line);
    const q = (line.match(/"""/g) || []).length;
    if (q % 2 === 1) inTriple = !inTriple;
  }
  return out.join('\n');
}

// ---------- stub for Copilot (fast-follow) ----------

function installCopilot() { return { ok: false, reason: 'experimental — coming soon' }; }

module.exports = {
  detectTools,
  installClaude,
  uninstallClaude,
  installCodex,
  uninstallCodex,
  captureStatus,
  installCopilot,
};
