// Vault git history (M1-A): init, autocommit, history, diff, restore, containment.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import vaultGit from '../lib/vault-git';

let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-vgit-'));
});

afterEach(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* Windows lock */ }
});

const write = (rel, text) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
};

describe('vault-git', () => {
  it('ensureRepo inits once and merges .gitignore', async () => {
    const first = await vaultGit.ensureRepo(root);
    expect(first.created).toBe(true);
    const second = await vaultGit.ensureRepo(root);
    expect(second.created).toBe(false);
    const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    expect(gi).toContain('.lore');
    expect(gi).toContain('*.lore-tmp');
  });

  it('autocommit commits md changes and no-ops when clean', async () => {
    await vaultGit.ensureRepo(root);
    write('Note.md', '# Note\n\nfirst\n');
    const r1 = await vaultGit.autocommit(root, 'test: first');
    expect(r1.committed).toBe(true);
    const r2 = await vaultGit.autocommit(root, 'test: clean');
    expect(r2.committed).toBe(false);
  });

  it('ignores non-md files', async () => {
    await vaultGit.ensureRepo(root);
    write('data.json', '{"a":1}');
    const r = await vaultGit.autocommit(root, 'test: json only');
    expect(r.committed).toBe(false);
  });

  it('history grows with edits and restore reverts content', async () => {
    await vaultGit.ensureRepo(root);
    write('Deep/Note.md', 'v1\n');
    await vaultGit.autocommit(root, 'v1');
    write('Deep/Note.md', 'v2\n');
    await vaultGit.autocommit(root, 'v2');

    const hist = await vaultGit.history(root, 'Deep/Note.md');
    expect(hist.length).toBe(2);
    expect(hist[0].message).toBe('v2');

    const oldContent = await vaultGit.fileAtCommit(root, 'Deep/Note.md', hist[1].oid);
    expect(oldContent).toBe('v1\n');

    const res = await vaultGit.restore(root, 'Deep/Note.md', hist[1].oid);
    expect(res.ok).toBe(true);
    expect(fs.readFileSync(path.join(root, 'Deep/Note.md'), 'utf8')).toBe('v1\n');
    // The restore itself is a commit.
    const hist2 = await vaultGit.history(root, 'Deep/Note.md');
    expect(hist2.length).toBe(3);
    expect(hist2[0].message).toMatch(/^restore:/);
  });

  it('commits deletions', async () => {
    await vaultGit.ensureRepo(root);
    write('Gone.md', 'bye\n');
    await vaultGit.autocommit(root, 'add');
    fs.rmSync(path.join(root, 'Gone.md'));
    const r = await vaultGit.autocommit(root, 'del');
    expect(r.committed).toBe(true);
    const hist = await vaultGit.history(root, 'Gone.md');
    expect(hist.length).toBe(2);
  });

  it('diff marks added and removed lines and collapses long context', async () => {
    const d = vaultGit.lineDiff('a\nb\nc\n', 'a\nX\nc\n');
    const kinds = d.map((r) => r.t + ':' + r.s);
    expect(kinds).toContain('del:b');
    expect(kinds).toContain('add:X');
    const long = vaultGit.lineDiff(
      Array.from({ length: 30 }, (_, i) => 'same' + i).join('\n'),
      ['changed!', ...Array.from({ length: 29 }, (_, i) => 'same' + (i + 1))].join('\n'),
    );
    expect(long.some((r) => r.t === 'info')).toBe(true);
  });

  it('refuses paths escaping the root', async () => {
    await vaultGit.ensureRepo(root);
    await expect(vaultGit.history(root, '..\\outside.md')).rejects.toThrow(/escapes/);
    await expect(vaultGit.restore(root, '../outside.md', 'deadbeef')).rejects.toThrow(/escapes/);
  });

  it('status reports repo + last snapshot', async () => {
    expect((await vaultGit.status(root)).repo).toBe(false);
    await vaultGit.ensureRepo(root);
    write('S.md', 's\n');
    await vaultGit.autocommit(root, 'snap');
    const st = await vaultGit.status(root);
    expect(st.repo).toBe(true);
    expect(st.last.message).toBe('snap');
  });
});
