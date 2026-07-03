// runtime.js wiring resolution (env > cfg > default) + .lore manifest round-trip.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import runtime from '../lib/runtime';
import manifest from '../lib/lore-manifest';

describe('runtime.backendPort resolution order', () => {
  const ORIG = process.env.LORE_PORT;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.LORE_PORT;
    else process.env.LORE_PORT = ORIG;
  });

  it('env var wins over config', () => {
    process.env.LORE_PORT = '9123';
    expect(runtime.backendPort(() => ({ backendPort: 7000 }))).toBe(9123);
  });
  it('config wins over default', () => {
    delete process.env.LORE_PORT;
    expect(runtime.backendPort(() => ({ backendPort: 7000 }))).toBe(7000);
  });
  it('falls back to the default port', () => {
    delete process.env.LORE_PORT;
    expect(runtime.backendPort(() => null)).toBe(runtime.DEFAULT_PORT);
  });
});

describe('lore-manifest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-manifest-test-'));

  it('write/read round-trips', () => {
    manifest.write(root, { tenant: 't1', scope: 's1', indexed: { count: 5 } });
    const m = manifest.read(root);
    expect(m.tenant).toBe('t1');
    expect(m.indexed.count).toBe(5);
    expect(m.version).toBeDefined();
  });

  it('appendWorklog accumulates and caps entries', () => {
    for (let i = 0; i < manifest.MAX_WORKLOG + 5; i++) {
      manifest.appendWorklog(root, { action: 'test', summary: `entry ${i}` });
    }
    const m = manifest.read(root);
    expect(m.worklog.length).toBeLessThanOrEqual(manifest.MAX_WORKLOG);
    expect(m.worklog[m.worklog.length - 1].summary).toContain(String(manifest.MAX_WORKLOG + 4));
  });

  it('read returns null for a folder without a manifest', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-manifest-empty-'));
    expect(manifest.read(empty)).toBeNull();
  });
});
