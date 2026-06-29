// Lore desktop — MCP installer (main-process module, required by main.js).
// Manages the lore MCP server entry in ~/.claude/.mcp.json:
//   additive-merge → backup-once → atomic temp→rename → idempotent.
// Every other mcpServers key and top-level key is preserved verbatim.
// Exported: detectMcp, installMcp, uninstallMcp
'use strict';
const fs             = require('fs');
const path           = require('path');
const os             = require('os');
const { execFileSync } = require('child_process');

// ---------- paths ----------

const MCP_CONFIG        = path.join(os.homedir(), '.claude', '.mcp.json');
const MCP_CONFIG_BACKUP = `${MCP_CONFIG}.lore-backup`;

// Absolute path to the repo's core directory (where lore.mcp_server lives).
const CORE_DIR = path.join(__dirname, '..', 'core');

// ---------- python resolution ----------

// True if `candidate` is a Python interpreter that actually runs (a `-c` probe).
// Guards against stale `where`/`which` hits (uninstalled shims, Windows Store
// alias stubs) being baked into the MCP config where they'd fail silently.
function pythonWorks(candidate) {
  try {
    execFileSync(candidate, ['-c', 'import sys; sys.exit(0)'],
      { stdio: 'ignore', windowsHide: true, timeout: 5000 });
    return true;
  } catch { return false; }
}

// Resolves the system Python to an absolute path so the MCP server entry
// does not depend on the user's PATH inside Claude Code.  Probes each candidate
// with `-c` and returns the first that actually runs; falls back to the bare
// command name if `where` / `which` fails or nothing probes clean.
function resolvePython() {
  const cmd    = process.platform === 'win32' ? 'python' : 'python3';
  const lookup = process.platform === 'win32' ? 'where'  : 'which';
  const candidates = [];
  try {
    const out = execFileSync(lookup, [cmd], { encoding: 'utf8', windowsHide: true });
    for (const line of out.split(/\r?\n/)) {
      const t = line.trim();
      if (t && path.isAbsolute(t) && !candidates.includes(t)) candidates.push(t);
    }
  } catch { /* fall through to bare command */ }
  candidates.push(cmd); // bare-name fallback (relies on PATH at run time)

  for (const c of candidates) {
    if (pythonWorks(c)) return c;
  }
  return candidates[0]; // best-effort: nothing probed clean, use the first hit
}

// ---------- detectMcp ----------

// Returns { detected, installed, configPath }
// detected  = ~/.claude/.mcp.json exists on disk
// installed = the file has an mcpServers.lore entry
function detectMcp() {
  const detected = fs.existsSync(MCP_CONFIG);
  let installed  = false;
  if (detected) {
    try {
      const obj = JSON.parse(fs.readFileSync(MCP_CONFIG, 'utf8'));
      installed = !!(obj && obj.mcpServers && obj.mcpServers.lore);
    } catch { /* malformed JSON → not installed */ }
  }
  return { detected, installed, configPath: MCP_CONFIG };
}

// ---------- installMcp ----------

// Reads ~/.claude/.mcp.json (tolerates missing → {}; tolerates malformed JSON
// → backs up raw bytes then starts from {}), writes backup ONCE, merges in
// the lore entry (replacing any prior lore entry), and atomically renames
// into place.  All other mcpServers entries and top-level keys are untouched.
// @returns {{ ok: boolean, backupPath: string, configPath: string, reason?: string }}
function installMcp() {
  const pythonPath = resolvePython();

  // Read existing config, tolerating missing or malformed.
  let rawContent = '';
  let config     = {};
  if (fs.existsSync(MCP_CONFIG)) {
    rawContent = fs.readFileSync(MCP_CONFIG, 'utf8');
    try {
      const parsed = JSON.parse(rawContent);
      config = (parsed !== null && typeof parsed === 'object') ? parsed : {};
    } catch {
      // Malformed JSON — ALWAYS preserve the exact bytes in a timestamped backup
      // (the once-only .lore-backup may already hold an earlier good config; we must
      // never silently discard the user's current, possibly-recoverable, content).
      try {
        fs.mkdirSync(path.dirname(MCP_CONFIG), { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        fs.writeFileSync(`${MCP_CONFIG}.malformed-${stamp}.bak`, rawContent, 'utf8');
      } catch (e) {
        return { ok: false, backupPath: MCP_CONFIG_BACKUP, configPath: MCP_CONFIG, reason: `Failed to back up malformed JSON: ${e.message}` };
      }
      config = {};
    }
  }

  // Write backup ONCE — never overwrite an existing backup.
  if (!fs.existsSync(MCP_CONFIG_BACKUP)) {
    try {
      fs.mkdirSync(path.dirname(MCP_CONFIG), { recursive: true });
      fs.writeFileSync(MCP_CONFIG_BACKUP, rawContent || '{}', 'utf8');
    } catch (e) {
      return { ok: false, backupPath: MCP_CONFIG_BACKUP, configPath: MCP_CONFIG, reason: `Failed to write backup: ${e.message}` };
    }
  }

  // Ensure mcpServers exists (other servers preserved by spread above).
  if (!config.mcpServers || typeof config.mcpServers !== 'object') config.mcpServers = {};

  // Set the lore entry (idempotent — replaces any prior lore entry wholesale).
  config.mcpServers.lore = {
    command: pythonPath,
    args:    ['-m', 'lore.mcp_server'],
    cwd:     CORE_DIR,
    env:     { VAULT_PROFILE: 'solo' },
  };

  // Atomic write: write to a temp file, then rename over the target.
  const tmp = `${MCP_CONFIG}.lore-tmp`;
  try {
    fs.mkdirSync(path.dirname(MCP_CONFIG), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
    fs.renameSync(tmp, MCP_CONFIG);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    return { ok: false, backupPath: MCP_CONFIG_BACKUP, configPath: MCP_CONFIG, reason: `Failed to write config: ${e.message}` };
  }

  return { ok: true, backupPath: MCP_CONFIG_BACKUP, configPath: MCP_CONFIG };
}

// ---------- uninstallMcp ----------

// Deletes only mcpServers.lore from ~/.claude/.mcp.json.
// Every other mcpServers entry and top-level key is preserved verbatim.
// Backup file is left in place.
// @returns {{ ok: boolean, reason?: string }}
function uninstallMcp() {
  if (!fs.existsSync(MCP_CONFIG)) return { ok: true, reason: 'no config file' };

  let config = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(MCP_CONFIG, 'utf8'));
    config = (parsed !== null && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    return { ok: false, reason: `Could not parse config: ${e.message}` };
  }

  if (config.mcpServers) delete config.mcpServers.lore;

  const tmp = `${MCP_CONFIG}.lore-tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
    fs.renameSync(tmp, MCP_CONFIG);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    return { ok: false, reason: `Failed to write config: ${e.message}` };
  }

  return { ok: true };
}

module.exports = { detectMcp, installMcp, uninstallMcp };
