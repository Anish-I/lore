import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import manifest from '../lib/lore-manifest';

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-manifest-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('.lore manifest layout', () => {
  it('writes local state under .lore/manifest.json', () => {
    manifest.write(root, { tenant: 'local-only', indexed: { count: 2 } });
    expect(fs.existsSync(path.join(root, '.lore', 'manifest.json'))).toBe(true);
    expect(manifest.read(root).tenant).toBe('local-only');
  });

  it('reads and migrates the legacy single-file .lore manifest', () => {
    fs.writeFileSync(path.join(root, '.lore'), JSON.stringify({ version: 1, tenant: 'legacy' }));
    expect(manifest.read(root).tenant).toBe('legacy');
    manifest.write(root, { scope: 'private' });
    expect(fs.statSync(path.join(root, '.lore')).isDirectory()).toBe(true);
    expect(manifest.read(root)).toMatchObject({ tenant: 'legacy', scope: 'private' });
  });

  it('keeps package.json untouched while refreshing the local manifest', () => {
    manifest.ensureDirectory(root);
    const pkg = path.join(root, '.lore', 'package.json');
    fs.writeFileSync(pkg, '{"portable":true}\n');
    manifest.write(root, { tenant: 't' });
    expect(fs.readFileSync(pkg, 'utf8')).toBe('{"portable":true}\n');
  });

  it('refuses a symlinked .lore directory', () => {
    if (process.platform === 'win32') return; // creating directory symlinks needs elevated privileges
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-manifest-outside-'));
    fs.symlinkSync(outside, path.join(root, '.lore'), 'dir');
    expect(() => manifest.write(root, { tenant: 'nope' })).toThrow(/symbolic link/);
    expect(manifest.read(root)).toBeNull();
    expect(fs.existsSync(path.join(outside, 'manifest.json'))).toBe(false);
    fs.rmSync(outside, { recursive: true, force: true });
  });
});
