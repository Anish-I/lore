#!/usr/bin/env node
// Self-checking test for desktop/hooks-installer.js — no test framework.
//
// Run with a scratch HOME so this never touches the real ~/.claude/settings.json
// or ~/.lore directory:
//
//   HOME=<tmpdir> node desktop/test-hooks-installer.js
//
// Asserts:
//   1. installClaude()                → settings.json has 4 _lore entries
//        (2 UserPromptSubmit: capture + inject, 1 PostToolUse, 1 Stop)
//   2. installClaude() again          → still 4 (idempotent re-install)
//   3. uninstallClaude()              → 0 _lore entries
//   4. installClaude({ inject:false}) → 3 _lore entries (no recall hook)
//
// Prints PASS/FAIL lines; exits non-zero if any assertion fails.
'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// NOTE: this test writes to ~/.claude/settings.json and ~/.lore under whatever
// HOME is active when it runs. Always invoke with a scratch HOME, e.g.:
//   HOME=$(mktemp -d) node desktop/test-hooks-installer.js
// os.homedir() resolves from process.env.HOME on POSIX, so hooks-installer.js
// (which computes its paths at require-time) will pick up the override below.

const hooksInstaller = require('./hooks-installer');

let failures = 0;

function ok(label, cond) {
  if (cond) {
    console.log(`PASS: ${label}`);
  } else {
    console.log(`FAIL: ${label}`);
    failures++;
  }
}

function readSettings() {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}

function countLoreEntries(settings) {
  let n = 0;
  for (const arr of Object.values(settings.hooks || {})) {
    if (Array.isArray(arr)) n += arr.filter((h) => h && h._lore === true).length;
  }
  return n;
}

function main() {
  // ---- 1. installClaude() → 4 _lore entries ----
  const r1 = hooksInstaller.installClaude();
  ok('installClaude() returns ok:true', r1 && r1.ok === true);
  const s1 = readSettings();
  const n1 = countLoreEntries(s1);
  ok(`installClaude() produces 4 _lore entries (got ${n1})`, n1 === 4);
  const ups1 = (s1.hooks.UserPromptSubmit || []).filter((h) => h._lore === true);
  ok(`UserPromptSubmit has 2 _lore entries (got ${ups1.length})`, ups1.length === 2);
  const post1 = (s1.hooks.PostToolUse || []).filter((h) => h._lore === true);
  ok(`PostToolUse has 1 _lore entry (got ${post1.length})`, post1.length === 1);
  const stop1 = (s1.hooks.Stop || []).filter((h) => h._lore === true);
  ok(`Stop has 1 _lore entry (got ${stop1.length})`, stop1.length === 1);

  // Confirm both capture and inject commands are present.
  const upsCommands = ups1.map((h) => h.hooks[0].command);
  ok('UserPromptSubmit includes lore-capture.js', upsCommands.some((c) => c.includes('lore-capture.js')));
  ok('UserPromptSubmit includes lore-inject.js', upsCommands.some((c) => c.includes('lore-inject.js')));

  // Materialized files exist.
  const loreDir = path.join(os.homedir(), '.lore');
  ok('lore-capture.js materialized', fs.existsSync(path.join(loreDir, 'hooks', 'lore-capture.js')));
  ok('lore-inject.js materialized', fs.existsSync(path.join(loreDir, 'hooks', 'lore-inject.js')));

  // ---- 2. installClaude() again → still 4 (idempotent) ----
  const r2 = hooksInstaller.installClaude();
  ok('installClaude() (2nd call) returns ok:true', r2 && r2.ok === true);
  const s2 = readSettings();
  const n2 = countLoreEntries(s2);
  ok(`installClaude() re-install stays at 4 _lore entries (got ${n2})`, n2 === 4);

  // ---- 3. uninstallClaude() → 0 ----
  const r3 = hooksInstaller.uninstallClaude();
  ok('uninstallClaude() returns ok:true', r3 && r3.ok === true);
  const s3 = readSettings();
  const n3 = countLoreEntries(s3);
  ok(`uninstallClaude() removes all _lore entries (got ${n3})`, n3 === 0);

  // ---- 4. installClaude({inject:false}) → 3 ----
  const r4 = hooksInstaller.installClaude({ inject: false });
  ok('installClaude({inject:false}) returns ok:true', r4 && r4.ok === true);
  const s4 = readSettings();
  const n4 = countLoreEntries(s4);
  ok(`installClaude({inject:false}) produces 3 _lore entries (got ${n4})`, n4 === 3);
  const ups4 = (s4.hooks.UserPromptSubmit || []).filter((h) => h._lore === true);
  ok(`installClaude({inject:false}) UserPromptSubmit has 1 _lore entry (got ${ups4.length})`, ups4.length === 1);
  ok('installClaude({inject:false}) UserPromptSubmit entry is lore-capture.js',
    ups4.length === 1 && ups4[0].hooks[0].command.includes('lore-capture.js'));

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
