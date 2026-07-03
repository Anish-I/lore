// Quote-aware TOML line editing — the property that keeps ~/.codex/config.toml
// safe: keys inside triple-quoted strings (developer_instructions) must NEVER
// be read or rewritten as real keys.
import { describe, it, expect } from 'vitest';
import toml from '../lib/codex-toml';

const SAMPLE = `model = "gpt-5"
developer_instructions = """
Standing notes:
- decoy: notify = ["evil", "inside-string"]
- another line
"""
notify = ["node", "real-notifier.js"]

[mcp_servers.other]
command = "x"
`;

describe('getRootKey', () => {
  it('reads a real root key', () => {
    expect(toml.getRootKey(SAMPLE, 'model')).toContain('gpt-5');
  });
  it('skips decoy keys inside triple-quoted strings', () => {
    const v = toml.getRootKey(SAMPLE, 'notify');
    expect(v).toContain('real-notifier.js');
    expect(v).not.toContain('evil');
  });
});

describe('setRootKey', () => {
  it('rewrites the real key and leaves the triple-quoted decoy untouched', () => {
    const out = toml.setRootKey(SAMPLE, 'notify', '["node", "new.js"]');
    expect(out).toContain('notify = ["node", "new.js"]');
    expect(out).toContain('decoy: notify = ["evil", "inside-string"]');
    expect(out).toContain('Standing notes:'); // block intact
  });
  it('appends when the key does not exist', () => {
    const out = toml.setRootKey('a = 1\n', 'b', '"two"');
    expect(toml.getRootKey(out, 'b')).toContain('two');
  });
});

describe('tables', () => {
  it('hasTable finds an existing table', () => {
    expect(toml.hasTable(SAMPLE, 'mcp_servers.other')).toBe(true);
    expect(toml.hasTable(SAMPLE, 'mcp_servers.lore')).toBe(false);
  });
  it('appendTable + removeTable round-trips', () => {
    const withLore = toml.appendTable(SAMPLE, 'mcp_servers.lore', ['command = "python"']);
    expect(toml.hasTable(withLore, 'mcp_servers.lore')).toBe(true);
    const removed = toml.removeTable(withLore, 'mcp_servers.lore');
    expect(toml.hasTable(removed, 'mcp_servers.lore')).toBe(false);
    expect(toml.hasTable(removed, 'mcp_servers.other')).toBe(true);
  });
});

describe('argv helpers', () => {
  it('formatArgv escapes backslashes and quotes; parseArgvValue inverts it', () => {
    const argv = ['C:\\Users\\x\\node.exe', 'a "quoted" arg'];
    const parsed = toml.parseArgvValue(toml.formatArgv(argv));
    expect(parsed).toEqual(argv);
  });
});
