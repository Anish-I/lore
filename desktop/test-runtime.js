#!/usr/bin/env node
// Self-checking test for desktop/lib/runtime.js — no test framework.
//
// Run with a scratch HOME so this never touches the real lore-config.json:
//
//   HOME=$(mktemp -d) node desktop/test-runtime.js
//
// Verifies the documented 3-tier precedence for backendPort()/backendUrl():
//   1. env var (LORE_PORT / LORE_BACKEND_URL) wins
//   2. lore-config.json field (backendPort / backendUrl) second
//   3. hardcoded default (8099 / http://localhost:8099) third
// ...plus that an explicit loadConfig() override (how main.js calls in) is honored.
//
// Prints PASS/FAIL lines; exits non-zero if any assertion fails.
'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const runtime = require('./lib/runtime');

let failures = 0;

function ok(label, cond) {
  if (cond) {
    console.log(`PASS: ${label}`);
  } else {
    console.log(`FAIL: ${label}`);
    failures++;
  }
}

// One of runtime.js's own candidate paths — unconditional (not APPDATA/macOS-gated),
// so it resolves the same way regardless of host platform as long as HOME is set.
function cfgPath() { return path.join(os.homedir(), '.config', 'lore-desktop', 'lore-config.json'); }

function writeCfg(obj) {
  const p = cfgPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj), 'utf8');
}

function clearCfg() {
  try { fs.unlinkSync(cfgPath()); } catch { /* ignore — already absent */ }
}

function clearEnv() {
  delete process.env.LORE_PORT;
  delete process.env.LORE_BACKEND_URL;
}

function main() {
  // ---- 1. default: no cfg file, no env ----
  clearEnv();
  clearCfg();
  ok('backendPort() defaults to 8099', runtime.backendPort() === 8099);
  ok('backendUrl() defaults to http://localhost:8099', runtime.backendUrl() === 'http://localhost:8099');

  // ---- 2. cfg field wins over default ----
  writeCfg({ backendPort: 9100, backendUrl: 'http://localhost:9100' });
  ok(`backendPort() reads cfg.backendPort (got ${runtime.backendPort()})`, runtime.backendPort() === 9100);
  ok(`backendUrl() reads cfg.backendUrl (got ${runtime.backendUrl()})`, runtime.backendUrl() === 'http://localhost:9100');

  // ---- 2b. backendUrl() derives from cfg.backendPort when cfg.backendUrl is absent ----
  writeCfg({ backendPort: 9200 });
  ok(`backendUrl() derives from cfg.backendPort when backendUrl absent (got ${runtime.backendUrl()})`,
    runtime.backendUrl() === 'http://localhost:9200');

  // ---- 3. env var wins over cfg field ----
  writeCfg({ backendPort: 9100, backendUrl: 'http://localhost:9100' });
  process.env.LORE_PORT = '7000';
  process.env.LORE_BACKEND_URL = 'http://example.test:7000';
  ok(`backendPort() env override wins over cfg (got ${runtime.backendPort()})`, runtime.backendPort() === 7000);
  ok(`backendUrl() env override wins over cfg (got ${runtime.backendUrl()})`, runtime.backendUrl() === 'http://example.test:7000');
  clearEnv();
  clearCfg();

  // ---- 4. explicit loadConfig() override (how main.js calls in) is honored ----
  const customCfg = () => ({ backendPort: 5555, backendUrl: 'http://localhost:5555' });
  ok('backendPort(loadConfig) uses the passed-in reader', runtime.backendPort(customCfg) === 5555);
  ok('backendUrl(loadConfig) uses the passed-in reader', runtime.backendUrl(customCfg) === 'http://localhost:5555');

  // Env still wins even when a loadConfig override is passed.
  process.env.LORE_PORT = '6000';
  ok('backendPort(loadConfig) still yields to env override', runtime.backendPort(customCfg) === 6000);
  clearEnv();

  console.log('');
  if (failures === 0) {
    console.log('RESULT: PASS');
    process.exit(0);
  } else {
    console.log(`RESULT: FAIL (${failures} failing assertion${failures === 1 ? '' : 's'})`);
    process.exit(1);
  }
}

main();
