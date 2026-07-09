// Lore desktop — CLI installer (main-process module, required by main.js).
// Puts a `lore` command on the user's shell PATH without sudo and without them
// activating the repo venv:
//   * preferred: symlink the repo venv's console script (.venv/bin/lore) into a
//     user-writable PATH directory (~/.local/bin on macOS/Linux),
//   * fallback:  write a thin wrapper script that runs `python3 -m lore.cli` with
//     PYTHONPATH pointed at the source core/ tree (lore.cli is stdlib-only, so the
//     wrapper works even without the venv),
//   * Windows:   a lore.cmd wrapper in %LOCALAPPDATA%\Microsoft\WindowsApps (a
//     user-writable directory that Windows puts on PATH by default).
// Idempotent (re-install always rewrites) and never requires elevation.
// Exported: cliStatus, installCli — both return plain serializable objects.
'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execFileSync } = require('child_process');

// Repo layout: this file lives in desktop/, siblings are core/ and (in a full
// checkout) .venv/ at the repo root.
const CORE_DIR = path.join(__dirname, '..', 'core');

// Packaged builds ship no `core/` source and no Python — only the PyInstaller
// `lore-backend` binary in the app's Resources (see mcp-installer.js, which does
// the same for MCP). When that binary is present, the CLI wrapper must call
// `lore-backend cli …` instead of `python -m lore.cli` (whose PYTHONPATH would
// point at a non-existent core/). Returns the absolute path or null in dev.
function frozenBackend() {
  const exeName = process.platform === 'win32' ? 'lore-backend.exe' : 'lore-backend';
  const p = process.resourcesPath ? path.join(process.resourcesPath, 'lore-backend', exeName) : null;
  return (p && fs.existsSync(p)) ? p : null;
}

function venvLoreScript() {
  const p = process.platform === 'win32'
    ? path.join(__dirname, '..', '.venv', 'Scripts', 'lore.exe')
    : path.join(__dirname, '..', '.venv', 'bin', 'lore');
  return fs.existsSync(p) ? p : null;
}

// The one directory we install into. Both choices are user-writable and
// conventionally on PATH; onPath() below reports honestly when they are not.
function cliTargetDir() {
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(local, 'Microsoft', 'WindowsApps');
  }
  return path.join(os.homedir(), '.local', 'bin');
}

function cliTargetPath() {
  return path.join(cliTargetDir(), process.platform === 'win32' ? 'lore.cmd' : 'lore');
}

// Is `dir` in the user's PATH right now? (Case-insensitive on Windows.)
function dirOnPath(dir) {
  const norm = (p) => {
    const n = path.normalize(p).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? n.toLowerCase() : n;
  };
  const target = norm(dir);
  return String(process.env.PATH || '')
    .split(path.delimiter)
    .some((p) => p && norm(p) === target);
}

// Exact command the user should run when the install dir is not on PATH.
function pathHint(dir) {
  if (process.platform === 'win32') {
    return `setx PATH "%PATH%;${dir}"   (then open a new terminal)`;
  }
  return `echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && exec zsh`;
}

// Resolve an absolute python3 so the wrapper does not depend on PATH at run time.
// Falls back to the bare name (mirrors mcp-installer's resolvePython approach).
function resolvePython() {
  const cmd    = process.platform === 'win32' ? 'python' : 'python3';
  const lookup = process.platform === 'win32' ? 'where'  : 'which';
  try {
    const out = execFileSync(lookup, [cmd], { encoding: 'utf8', windowsHide: true });
    for (const line of out.split(/\r?\n/)) {
      const t = line.trim();
      if (t && path.isAbsolute(t)) return t;
    }
  } catch { /* fall through */ }
  return cmd;
}

function wrapperBody() {
  const frozen = frozenBackend();
  if (process.platform === 'win32') {
    if (frozen) {
      return [
        '@echo off',
        'rem Lore CLI launcher (packaged) — runs the frozen backend in cli mode.',
        `"${frozen}" cli %*`,
        '',
      ].join('\r\n');
    }
    return [
      '@echo off',
      'rem Lore CLI launcher (dev). lore.cli is stdlib-only.',
      `set "PYTHONPATH=${CORE_DIR};%PYTHONPATH%"`,
      `"${resolvePython()}" -m lore.cli %*`,
      '',
    ].join('\r\n');
  }
  if (frozen) {
    return [
      '#!/bin/sh',
      '# Lore CLI launcher (packaged) — runs the frozen backend in cli mode.',
      `exec "${frozen}" cli "$@"`,
      '',
    ].join('\n');
  }
  return [
    '#!/bin/sh',
    '# Lore CLI launcher (dev). lore.cli is stdlib-only,',
    '# so any python3 works; PYTHONPATH points at the Lore source tree.',
    `export PYTHONPATH="${CORE_DIR}\${PYTHONPATH:+:$PYTHONPATH}"`,
    `exec "${resolvePython()}" -m lore.cli "$@"`,
    '',
  ].join('\n');
}

// Current install state: { installed, path, target?, mechanism?, onPath, hint? }.
function cliStatus() {
  const target = cliTargetPath();
  const onPath = dirOnPath(cliTargetDir());
  let installed = false, linkTarget = null, mechanism = null;
  try {
    const st = fs.lstatSync(target);
    installed = true;
    if (st.isSymbolicLink()) {
      mechanism = 'symlink';
      try { linkTarget = fs.readlinkSync(target); } catch { /* leave null */ }
    } else {
      mechanism = 'wrapper';
    }
  } catch { /* not installed */ }
  return {
    installed,
    path: target,
    target: linkTarget,
    mechanism,
    onPath,
    ...(onPath ? {} : { hint: pathHint(cliTargetDir()) }),
  };
}

// Install (or re-install) the `lore` command. Idempotent: removes any previous
// symlink/wrapper at the target before writing. Returns
//   { ok:true, path, mechanism, onPath, hint? }  or  { ok:false, reason }.
function installCli() {
  const dir = cliTargetDir();
  const target = cliTargetPath();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    return { ok: false, reason: `Could not create ${dir}: ${String((e && e.message) || e)}` };
  }
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    return { ok: false, reason: `${dir} is not writable. Create a user-writable bin dir and add it to PATH: ${pathHint(dir)}` };
  }
  try {
    try { fs.rmSync(target, { force: true }); } catch { /* stale entry — overwrite below */ }
    const venvScript = process.platform !== 'win32' ? venvLoreScript() : null;
    let mechanism;
    if (venvScript) {
      // Full checkout with a venv: the console script's shebang already pins the
      // right interpreter, so a symlink is the cleanest truth-preserving install.
      fs.symlinkSync(venvScript, target);
      mechanism = 'symlink';
    } else {
      fs.writeFileSync(target, wrapperBody(), 'utf8');
      if (process.platform !== 'win32') fs.chmodSync(target, 0o755);
      mechanism = 'wrapper';
    }
    const onPath = dirOnPath(dir);
    return { ok: true, path: target, mechanism, onPath, ...(onPath ? {} : { hint: pathHint(dir) }) };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) };
  }
}

module.exports = { cliStatus, installCli, cliTargetDir, cliTargetPath };
