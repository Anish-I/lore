// Lore desktop — shared wiring-value resolution (backend URL/port).
// Consumed by desktop/main.js, desktop/scraper.js, desktop/hooks-installer.js, AND the
// installed hook scripts (assets/lore-capture.js, assets/lore-inject.js) which run
// OUTSIDE Electron as plain `node <script>` subprocesses invoked by Claude Code hooks.
// That means this module must stay require()-able with no Electron imports.
//
// Precedence (both backendPort() and backendUrl()):
//   1. explicit env var  — LORE_PORT / LORE_BACKEND_URL
//   2. lore-config.json field — cfg.backendPort / cfg.backendUrl
//   3. hardcoded default — 8099 / http://localhost:<port>
'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const DEFAULT_PORT = 8099;

// Plain lore-config.json reader — the same 3 candidate paths as lore-capture.js's /
// lore-inject.js's loadLoreConfig(). Used when the caller has no Electron-aware config
// reader of its own (hooks, scraper.js). Callers that DO have one (main.js already has
// loadConfig() built on app.getPath('userData')) can pass it in instead.
function readConfigFile() {
  const candidates = [
    process.env.APPDATA && path.join(process.env.APPDATA, 'lore-desktop', 'lore-config.json'),
    path.join(os.homedir(), '.config', 'lore-desktop', 'lore-config.json'),
    path.join(os.homedir(), 'Library', 'Application Support', 'lore-desktop', 'lore-config.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* try next candidate */ }
  }
  return {};
}

function resolveCfg(loadConfig) {
  return (loadConfig ? loadConfig() : readConfigFile()) || {};
}

// @param {Function} [loadConfig] - optional cfg reader override (e.g. main.js's loadConfig()).
function backendPort(loadConfig) {
  const envPort = parseInt(process.env.LORE_PORT, 10);
  if (Number.isFinite(envPort) && envPort > 0) return envPort;
  const cfg = resolveCfg(loadConfig);
  return cfg.backendPort || DEFAULT_PORT;
}

// @param {Function} [loadConfig] - optional cfg reader override (e.g. main.js's loadConfig()).
function backendUrl(loadConfig) {
  if (process.env.LORE_BACKEND_URL) return process.env.LORE_BACKEND_URL;
  const cfg = resolveCfg(loadConfig);
  if (cfg.backendUrl) return cfg.backendUrl;
  const envPort = parseInt(process.env.LORE_PORT, 10);
  const port = (Number.isFinite(envPort) && envPort > 0) ? envPort : (cfg.backendPort || DEFAULT_PORT);
  return `http://localhost:${port}`;
}

module.exports = { backendPort, backendUrl, readConfigFile, DEFAULT_PORT };
