// Scratch test for installCodex()/uninstallCodex() notify chaining.
// Runs against a scratch HOME so it never touches the real ~/.codex.
//   HOME=$(mktemp -d) node desktop/test-codex-install.js
'use strict';
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const assert = require('assert');

// Force a scratch HOME BEFORE requiring the installer (it caches paths off os.homedir()).
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-codex-test-'));
process.env.HOME = scratch;
process.env.APPDATA = ''; // avoid Windows APPDATA candidate
os.homedir = () => scratch; // codex-toml + installer both read os.homedir() at call time

const codexDir = path.join(scratch, '.codex');
const configPath = path.join(codexDir, 'config.toml');
fs.mkdirSync(codexDir, { recursive: true });

// A config that ALREADY has a notify (computer-use style) AND a triple-quoted
// developer_instructions block containing a DECOY notify line that must be ignored.
const DECOY = [
  'notify = ["/usr/bin/prev-notify", "--flag"]',
  '',
  'developer_instructions = """',
  'Here is a fake config line the editor must ignore:',
  'notify = ["/evil/should-not-touch"]',
  '"""',
  '',
  '[mcp_servers.node_repl]',
  'command = "node"',
  '',
].join('\n');
fs.writeFileSync(configPath, DECOY, 'utf8');

const installer = require('./hooks-installer');
// materializeHookFiles copies asset files; ensure the source assets exist (they do in-repo).

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; console.log('  ✓', label); } else { fail++; console.error('  ✗', label); } }

// --- install: chains the pre-existing notify, leaves the triple-quoted block intact ---
const r1 = installer.installCodex();
ok('installCodex ok', r1 && r1.ok === true);
let txt = fs.readFileSync(configPath, 'utf8');
ok('notify now points at the Lore bridge', /^notify = \[.*lore-codex-notify\.js/m.test(txt));
ok('previous notify chained via --previous-notify', txt.includes('--previous-notify') && txt.includes('/usr/bin/prev-notify'));
ok('triple-quoted decoy notify untouched', txt.includes('notify = ["/evil/should-not-touch"]'));
ok('developer_instructions block intact', txt.includes('developer_instructions = """'));
ok('mcp_servers table untouched', txt.includes('[mcp_servers.node_repl]'));
ok('a backup was written', fs.existsSync(configPath + '.lore-backup'));

// --- idempotent re-install ---
const before = fs.readFileSync(configPath, 'utf8');
installer.installCodex();
ok('re-install is idempotent (no change)', fs.readFileSync(configPath, 'utf8') === before);

// --- detectTools reports codex installed ---
const codex = installer.detectTools().find((t) => t.id === 'codex');
ok('detectTools: codex installed=true', codex && codex.installed === true);

// --- uninstall restores the original notify ---
const r2 = installer.uninstallCodex();
ok('uninstallCodex ok', r2 && r2.ok === true);
txt = fs.readFileSync(configPath, 'utf8');
ok('notify restored to the previous notifier', /^notify = \["\/usr\/bin\/prev-notify", "--flag"\]/m.test(txt));
ok('no lore bridge left after uninstall', !txt.includes('lore-codex-notify.js'));
ok('decoy still untouched after uninstall', txt.includes('notify = ["/evil/should-not-touch"]'));

// --- install from a config with NO pre-existing notify, then uninstall drops the key ---
const codexDir2 = codexDir;
fs.writeFileSync(configPath, '[mcp_servers.node_repl]\ncommand = "node"\n', 'utf8');
try { fs.unlinkSync(configPath + '.lore-backup'); } catch {}
installer.installCodex();
txt = fs.readFileSync(configPath, 'utf8');
ok('install with no prior notify adds a bare bridge notify', /^notify = \[.*lore-codex-notify\.js/m.test(txt) && !txt.includes('--previous-notify'));
installer.uninstallCodex();
txt = fs.readFileSync(configPath, 'utf8');
ok('uninstall with no chain drops the notify line', !/^notify\s*=/m.test(txt));
ok('mcp table still present after add/remove cycle', txt.includes('[mcp_servers.node_repl]'));

console.log(`\ncodex-install: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
