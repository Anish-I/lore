// Scratch self-test for desktop/lib/codex-toml.js — no framework, no fs
// dependency (all cases are pure in-memory string assertions). Exits
// non-zero if any assertion fails.
'use strict';
const assert = require('assert');
const {
  getRootKey,
  setRootKey,
  hasTable,
  appendTable,
  removeTable,
  parseArgvValue,
  formatArgv,
} = require('./lib/codex-toml');

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`ok   - ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL - ${name}`);
    console.error(`       ${e.message}`);
  }
}

// ---------------------------------------------------------------------
// getRootKey: must ignore a notify-looking line INSIDE a """...""" block,
// and find the real top-level one.
// ---------------------------------------------------------------------

const withFakeNotifyInTriple = [
  'model = "gpt-5"',
  'notify = ["/usr/bin/real-notify", "--flag"]',
  '',
  'developer_instructions = """',
  'Some instructions here.',
  'notify = ["FAKE", "should not match"]',
  'More instructions.',
  '"""',
  '',
  '[mcp_servers.other]',
  'command = "other"',
].join('\n');

test('getRootKey finds the real top-level notify, ignoring the one inside """', () => {
  const value = getRootKey(withFakeNotifyInTriple, 'notify');
  assert.strictEqual(value, '["/usr/bin/real-notify", "--flag"]');
});

test('getRootKey returns null for a key that only appears inside """', () => {
  // "Some" never appears as a real key anywhere — sanity check for null path.
  const value = getRootKey(withFakeNotifyInTriple, 'nonexistent_key');
  assert.strictEqual(value, null);
});

test('getRootKey ignores keys that only exist inside a [table]', () => {
  const value = getRootKey(withFakeNotifyInTriple, 'command');
  assert.strictEqual(value, null);
});

// ---------------------------------------------------------------------
// setRootKey: replace existing / insert when absent / leave """ untouched.
// ---------------------------------------------------------------------

test('setRootKey replaces an existing top-level notify, leaving the """ block byte-identical', () => {
  const updated = setRootKey(withFakeNotifyInTriple, 'notify', '["/new/path", "--other"]');
  const lines = updated.split('\n');
  assert.strictEqual(lines[1], 'notify = ["/new/path", "--other"]');

  // The triple-quoted region (including its fake notify line) must be
  // byte-for-byte identical to the original.
  const originalLines = withFakeNotifyInTriple.split('\n');
  const tripleStart = originalLines.indexOf('developer_instructions = """');
  const tripleEnd = originalLines.indexOf('"""', tripleStart + 1);
  const originalTriple = originalLines.slice(tripleStart, tripleEnd + 1).join('\n');

  const updatedTripleStart = lines.indexOf('developer_instructions = """');
  const updatedTripleEnd = lines.indexOf('"""', updatedTripleStart + 1);
  const updatedTriple = lines.slice(updatedTripleStart, updatedTripleEnd + 1).join('\n');

  assert.strictEqual(updatedTriple, originalTriple, 'triple-quoted block must be untouched');

  // Everything else outside the notify line and the triple block must also
  // be unchanged.
  assert.strictEqual(lines[0], originalLines[0]);
  assert.deepStrictEqual(lines.slice(9), originalLines.slice(9));
});

const noNotifyAtRoot = [
  'model = "gpt-5"',
  '',
  'developer_instructions = """',
  'notify = ["FAKE", "should not match"]',
  '"""',
  '',
  '[mcp_servers.other]',
  'command = "other"',
].join('\n');

test('setRootKey inserts a new root key before the first [header] when absent', () => {
  const updated = setRootKey(noNotifyAtRoot, 'notify', '["/inserted"]');
  const lines = updated.split('\n');
  const headerIdx = lines.indexOf('[mcp_servers.other]');
  assert.ok(headerIdx > -1, 'header must still be present');
  assert.strictEqual(lines[headerIdx - 1], 'notify = ["/inserted"]');
  // The fake notify inside """ must remain untouched.
  assert.ok(updated.includes('notify = ["FAKE", "should not match"]'));
  // Only one *real* insertion happened — line count grew by exactly 1.
  assert.strictEqual(lines.length, noNotifyAtRoot.split('\n').length + 1);
});

test('setRootKey appends at EOF when there is no [header] at all', () => {
  const noHeader = 'model = "gpt-5"\n';
  const updated = setRootKey(noHeader, 'notify', '["/x"]');
  // Trailing newline is preserved; the new key lands right before it.
  assert.strictEqual(updated, 'model = "gpt-5"\nnotify = ["/x"]\n');
});

test('setRootKey appends at EOF (no trailing newline in source)', () => {
  const noHeader = 'model = "gpt-5"';
  const updated = setRootKey(noHeader, 'notify', '["/x"]');
  assert.strictEqual(updated, 'model = "gpt-5"\nnotify = ["/x"]');
});

test('setRootKey works on an empty file', () => {
  const updated = setRootKey('', 'notify', '["/x"]');
  assert.strictEqual(updated, 'notify = ["/x"]');
});

// ---------------------------------------------------------------------
// hasTable / appendTable / removeTable round-trip.
// ---------------------------------------------------------------------

test('hasTable/appendTable/removeTable round-trip', () => {
  const base = 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "other"\n';

  assert.strictEqual(hasTable(base, 'mcp_servers.lore'), false);

  const withTable = appendTable(base, 'mcp_servers.lore', [
    'command = "node"',
    'args = ["server.js"]',
  ]);
  assert.strictEqual(hasTable(withTable, 'mcp_servers.lore'), true);
  assert.ok(withTable.includes('[mcp_servers.lore]\ncommand = "node"\nargs = ["server.js"]\n'));

  // appendTable is a no-op when the table already exists.
  const appendedAgain = appendTable(withTable, 'mcp_servers.lore', ['ignored = true']);
  assert.strictEqual(appendedAgain, withTable);

  const removed = removeTable(withTable, 'mcp_servers.lore');
  assert.strictEqual(hasTable(removed, 'mcp_servers.lore'), false);
  // The other pre-existing table must be untouched.
  assert.ok(removed.includes('[mcp_servers.other]\ncommand = "other"'));

  // removeTable is a no-op when the table is absent.
  const removedAgain = removeTable(removed, 'mcp_servers.lore');
  assert.strictEqual(removedAgain, removed);
});

test('removeTable stops at the next [header], not EOF, when another table follows', () => {
  const text = [
    '[mcp_servers.lore]',
    'command = "node"',
    'args = ["server.js"]',
    '[mcp_servers.other]',
    'command = "other"',
  ].join('\n');
  const removed = removeTable(text, 'mcp_servers.lore');
  assert.strictEqual(removed, '[mcp_servers.other]\ncommand = "other"');
});

test('hasTable ignores a header-looking line inside a """ block', () => {
  const text = [
    'developer_instructions = """',
    '[mcp_servers.lore]',
    '"""',
  ].join('\n');
  assert.strictEqual(hasTable(text, 'mcp_servers.lore'), false);
});

// ---------------------------------------------------------------------
// formatArgv / parseArgvValue round-trip, including spaces + backslashes.
// ---------------------------------------------------------------------

test('formatArgv/parseArgvValue round-trip a simple array', () => {
  const arr = ['/usr/bin/node', '--flag', 'value'];
  const formatted = formatArgv(arr);
  assert.strictEqual(formatted, '["/usr/bin/node", "--flag", "value"]');
  assert.deepStrictEqual(parseArgvValue(formatted), arr);
});

test('formatArgv/parseArgvValue round-trip a path with spaces and backslashes', () => {
  const arr = ['C:\\Users\\ivatu\\Program Files\\lore agent.exe', 'arg with "quotes" too'];
  const formatted = formatArgv(arr);
  assert.deepStrictEqual(parseArgvValue(formatted), arr);
});

test('formatArgv escapes backslashes and quotes correctly', () => {
  const formatted = formatArgv(['a\\b"c']);
  assert.strictEqual(formatted, '["a\\\\b\\"c"]');
});

test('parseArgvValue throws on malformed input', () => {
  assert.throws(() => parseArgvValue('not an array'));
});

// ---------------------------------------------------------------------

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
