// Scratch test for Codex MCP registration + Claude env parity.
//   HOME=$(mktemp -d) node desktop/test-mcp-installer.js
'use strict';
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-mcp-test-'));
process.env.HOME = scratch;
process.env.APPDATA = '';
os.homedir = () => scratch;

// Seed a lore-config.json so identity env is populated.
const cfgDir = path.join(scratch, '.config', 'lore-desktop');
fs.mkdirSync(cfgDir, { recursive: true });
fs.writeFileSync(path.join(cfgDir, 'lore-config.json'),
  JSON.stringify({ tenant: 'local', scope: 'engineering' }), 'utf8');

// Seed a codex config with a triple-quoted decoy that must survive.
const codexDir = path.join(scratch, '.codex');
fs.mkdirSync(codexDir, { recursive: true });
fs.writeFileSync(path.join(codexDir, 'config.toml'),
  'developer_instructions = """\n[mcp_servers.lore]\ncommand = "should-not-touch"\n"""\n\n[mcp_servers.node_repl]\ncommand = "node"\n', 'utf8');

const mcp = require('./mcp-installer');
let pass = 0, fail = 0;
const ok = (l, c) => { if (c) { pass++; console.log('  ✓', l); } else { fail++; console.error('  ✗', l); } };

// --- Claude env parity ---
const r1 = mcp.installMcp();
ok('installMcp ok', r1 && r1.ok === true);
const claude = JSON.parse(fs.readFileSync(path.join(scratch, '.claude', '.mcp.json'), 'utf8'));
ok('claude lore entry has env.LORE_TENANT', claude.mcpServers.lore.env.LORE_TENANT === 'local');
ok('claude lore entry has env.LORE_SCOPES', claude.mcpServers.lore.env.LORE_SCOPES === 'engineering');

// --- Codex MCP tables ---
const r2 = mcp.installCodexMcp();
ok('installCodexMcp ok', r2 && r2.ok === true);
let toml = fs.readFileSync(path.join(codexDir, 'config.toml'), 'utf8');
ok('[mcp_servers.lore] table added', /^\[mcp_servers\.lore\]\s*$/m.test(toml));
ok('[mcp_servers.lore.env] table added', /^\[mcp_servers\.lore\.env\]\s*$/m.test(toml));
ok('env has PYTHONPATH', /PYTHONPATH = ".*core"/.test(toml));
ok('env has LORE_TENANT', toml.includes('LORE_TENANT = "local"'));
ok('args points at lore.mcp_server', toml.includes('args = ["-m", "lore.mcp_server"]'));
ok('triple-quoted decoy [mcp_servers.lore] untouched', toml.includes('command = "should-not-touch"'));
ok('node_repl table preserved', toml.includes('[mcp_servers.node_repl]'));

// --- idempotent ---
const before = fs.readFileSync(path.join(codexDir, 'config.toml'), 'utf8');
mcp.installCodexMcp();
ok('installCodexMcp idempotent', fs.readFileSync(path.join(codexDir, 'config.toml'), 'utf8') === before);

// --- detect per-tool ---
const d = mcp.detectMcpTools();
ok('detectMcpTools: claude installed', d.claude.installed === true);
ok('detectMcpTools: codex installed', d.codex.installed === true);

// --- uninstall codex removes both tables, keeps decoy + node_repl ---
mcp.uninstallCodexMcp();
toml = fs.readFileSync(path.join(codexDir, 'config.toml'), 'utf8');
// the real tables are gone (only the decoy inside the triple-quote remains)
ok('real [mcp_servers.lore.env] removed', !/^\[mcp_servers\.lore\.env\]\s*$/m.test(toml));
ok('node_repl still present', toml.includes('[mcp_servers.node_repl]'));
ok('decoy still inside triple-quote', toml.includes('command = "should-not-touch"'));

console.log(`\nmcp-installer: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
