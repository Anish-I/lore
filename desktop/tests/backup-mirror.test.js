// Backup mirror: incremental copy, delete-tracking, safety refusal.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import mirror from '../lib/backup-mirror';

let root, dest;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-bk-lib-'));
  dest = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-bk-dest-'));
  fs.writeFileSync(path.join(root, 'a.md'), '# A\nalpha\n');
  fs.mkdirSync(path.join(root, 'sub'));
  fs.writeFileSync(path.join(root, 'sub', 'b.md'), '# B\nbeta\n');
});

describe('backup mirror', () => {
  it('copies all markdown on first run (recursively)', () => {
    const r = mirror.mirror(root, dest);
    expect(r.ok).toBe(true);
    expect(r.copied).toBe(2);
    expect(fs.existsSync(path.join(dest, 'a.md'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'sub', 'b.md'))).toBe(true);
  });

  it('only copies changed files on re-run', () => {
    mirror.mirror(root, dest);
    fs.writeFileSync(path.join(root, 'a.md'), '# A\nCHANGED\n');
    const r = mirror.mirror(root, dest);
    expect(r.copied).toBe(1);
    expect(fs.readFileSync(path.join(dest, 'a.md'), 'utf8')).toContain('CHANGED');
  });

  it('removes backups whose source was deleted', () => {
    mirror.mirror(root, dest);
    fs.unlinkSync(path.join(root, 'a.md'));
    const r = mirror.mirror(root, dest);
    expect(r.deleted).toBe(1);
    expect(fs.existsSync(path.join(dest, 'a.md'))).toBe(false);
  });

  it('refuses a dest inside the library (self-mirror guard)', () => {
    const r = mirror.mirror(root, path.join(root, 'backup'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/inside/);
  });

  it('ignores hidden dirs and non-markdown', () => {
    fs.mkdirSync(path.join(root, '.lore'));
    fs.writeFileSync(path.join(root, '.lore', 'manifest.json'), '{}');
    fs.writeFileSync(path.join(root, 'image.png'), 'x');
    const r = mirror.mirror(root, dest);
    expect(r.count).toBe(2); // still just the two .md
    expect(fs.existsSync(path.join(dest, 'image.png'))).toBe(false);
  });
});
