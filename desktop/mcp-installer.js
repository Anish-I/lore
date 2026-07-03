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
const codexToml      = require('./lib/codex-toml');

// ---------- paths ----------

const MCP_CONFIG        = path.join(os.homedir(), '.claude', '.mcp.json');
const MCP_CONFIG_BACKUP = `${MCP_CONFIG}.lore-backup`;

// Absolute path to the repo's core directory (where lore.mcp_server lives).
const CORE_DIR = path.join(__dirname, '..', 'core');

// ---------- identity ----------

// Reads scope/tenant from lore-config.json (same candidate paths as the hooks),
// so the MCP tools can default their scopes/tenant from env and be callable argless.
function loadLoreIdentity() {
  const candidates = [
    process.env.APPDATA && path.join(process.env.APPDATA, 'lore-desktop', 'lore-config.json'),
    path.join(os.homedir(), '.config', 'lore-desktop', 'lore-config.json'),
    path.join(os.homedir(), 'Library', 'Application Support', 'lore-desktop', 'lore-config.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      const c = JSON.parse(fs.readFileSync(p, 'utf8'));
      return { tenant: c.tenant || '', scope: c.scope || '' };
    } catch {}
  }
  return { tenant: '', scope: '' };
}

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

// ---------- MCP command resolution (packaged vs dev) ----------

// The single decision that determines whether the agent-memory loop survives
// packaging. A user who installed the dmg/exe has NO repo, NO venv, and (in
// general) no system Python with `mcp` installed — for them, the MCP server is
// the frozen backend binary in `mcp` mode (`lore-backend mcp`, shipped inside
// the app's Resources; see core/run_server.py). In dev, prefer the repo's own
// .venv (system python3 provably lacks the deps on some machines) and fall
// back to a probed system Python only when the venv is absent.
// @returns {{ command, args, cwd?, extraEnv }}
// @param {string} [coreDir=CORE_DIR] — override the core dir (used by tests to
//   point the venv/PYTHONPATH probe at a temp fixture; production passes nothing).
function resolveMcpCommand(coreDir = CORE_DIR) {
  // Packaged: process.resourcesPath exists in any Electron process; the frozen
  // backend lives there via electron-builder extraResources.
  const exeName = process.platform === 'win32' ? 'lore-backend.exe' : 'lore-backend';
  const frozen = process.resourcesPath
    ? path.join(process.resourcesPath, 'lore-backend', exeName)
    : null;
  if (frozen && fs.existsSync(frozen)) {
    return { command: frozen, args: ['mcp'], extraEnv: {} };
  }
  // Dev: this repo's venv first — mirrors ensureBackend's spawn fix in main.js.
  const venvPy = path.join(coreDir, '..', '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (fs.existsSync(venvPy)) {
    return { command: venvPy, args: ['-m', 'lore.mcp_server'], cwd: coreDir,
             extraEnv: { PYTHONPATH: coreDir } };
  }
  return { command: resolvePython(), args: ['-m', 'lore.mcp_server'], cwd: coreDir,
           extraEnv: { PYTHONPATH: coreDir } };
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
  const mcpCmd = resolveMcpCommand();

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
  // env pins identity so the tools default scopes/tenant and are callable argless.
  const id = loadLoreIdentity();
  config.mcpServers.lore = {
    command: mcpCmd.command,
    args:    mcpCmd.args,
    ...(mcpCmd.cwd ? { cwd: mcpCmd.cwd } : {}),
    env:     { ...mcpCmd.extraEnv, LORE_TENANT: id.tenant, LORE_SCOPES: id.scope },
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

// ---------- Codex MCP ----------

// Registers [mcp_servers.lore] + [mcp_servers.lore.env] in ~/.codex/config.toml.
// Uses the quote-aware codex-toml editor so triple-quoted blocks are never touched.
// Idempotent (skips if the table already exists). Codex has no `cwd` key — the
// module is reached via PYTHONPATH=<CORE_DIR> instead.
function installCodexMcp() {
  try {
    const mcpCmd = resolveMcpCommand();
    const id = loadLoreIdentity();
    let text = codexToml.read();
    codexToml.backupOnce(text);
    // REPLACE rather than skip-if-present: an existing entry may point at a
    // stale interpreter (e.g. a system python without deps, or a repo path
    // that no longer exists after packaging) — re-install must repair it.
    text = codexToml.removeTable(text, 'mcp_servers.lore.env');
    text = codexToml.removeTable(text, 'mcp_servers.lore');
    text = codexToml.appendTable(text, 'mcp_servers.lore', [
      `command = ${JSON.stringify(mcpCmd.command)}`,
      `args = ${JSON.stringify(mcpCmd.args)}`,
    ]);
    text = codexToml.appendTable(text, 'mcp_servers.lore.env', [
      ...Object.entries(mcpCmd.extraEnv).map(([k, v]) => `${k} = ${JSON.stringify(v)}`),
      `LORE_TENANT = ${JSON.stringify(id.tenant)}`,
      `LORE_SCOPES = ${JSON.stringify(id.scope)}`,
    ]);
    codexToml.atomicWrite(text);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `Failed to write Codex MCP config: ${e.message}` };
  }
}

function uninstallCodexMcp() {
  try {
    let text = codexToml.read();
    text = codexToml.removeTable(text, 'mcp_servers.lore.env');
    text = codexToml.removeTable(text, 'mcp_servers.lore');
    codexToml.atomicWrite(text);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `Failed to write Codex MCP config: ${e.message}` };
  }
}

// Per-tool MCP status: { claude:{detected,installed}, codex:{detected,installed} }.
function detectMcpTools() {
  const claude = detectMcp();
  let codexInstalled = false;
  const codexPath = codexToml.configPath();
  const codexDetected = fs.existsSync(codexPath);
  try { codexInstalled = codexToml.hasTable(codexToml.read(), 'mcp_servers.lore'); } catch {}
  return {
    claude: { detected: claude.detected, installed: claude.installed },
    codex:  { detected: codexDetected, installed: codexInstalled },
  };
}

module.exports = {
  resolveMcpCommand,
  detectMcp, installMcp, uninstallMcp,
  installCodexMcp, uninstallCodexMcp, detectMcpTools,
};
