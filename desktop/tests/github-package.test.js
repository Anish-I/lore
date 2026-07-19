import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import git from 'isomorphic-git';
import os from 'os';
import path from 'path';
import githubPackage from '../lib/github-package';

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-ghpkg-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function write(rel, body) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, 'utf8');
}

const shared = (body) => `---\nshare: github\n---\n\n${body}`;

describe('GitHub .lore package', () => {
  it('exports a validated package and only exposes package.json to Git', async () => {
    await git.init({ fs, dir: root, defaultBranch: 'main' });
    write('README.md', shared('# Project\n\nDecision log.\n'));
    write('notes/ADR.md', shared('# Use SQLite\n\nLocal-first.\n'));
    write('private.md', '# Private\n\nNever packaged.\n');
    const result = githubPackage.write(root);
    expect(result.changed).toBe(true);
    expect(result.noteCount).toBe(2);
    const decoded = githubPackage.read(root);
    expect(decoded.notes.map((n) => n.path)).toEqual(['notes/ADR.md', 'README.md']);
    const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    expect(gi).toContain('.lore/*');
    expect(gi).toContain('!.lore/package.json');
    expect(await git.isIgnored({ fs, dir: root, filepath: '.lore/manifest.json' })).toBe(true);
    expect(await git.isIgnored({ fs, dir: root, filepath: '.lore/package.json' })).toBe(false);
  });

  it('is content-stable and preserves package identity', () => {
    write('one.md', shared('# One\n'));
    const first = githubPackage.write(root);
    const firstBytes = fs.readFileSync(githubPackage.packagePath(root), 'utf8');
    const second = githubPackage.write(root);
    expect(second.changed).toBe(false);
    expect(second.packageId).toBe(first.packageId);
    expect(fs.readFileSync(githubPackage.packagePath(root), 'utf8')).toBe(firstBytes);
  });

  it('redacts recognizable secrets and skips secret-dominated files', () => {
    write('decision.md', shared('# Deploy\n\napi_key=abcdefghijk123456789\n'));
    write('credentials.json.md', shared('password=abcdefgh\napi_key=ijklmnop\nauth_token=qrstuvwx\n'));
    const result = githubPackage.write(root);
    const decoded = githubPackage.read(root);
    expect(result.redacted).toBe(1);
    expect(decoded.notes[0].body).toContain('[REDACTED]');
    expect(decoded.notes.some((n) => n.path === 'credentials.json.md')).toBe(false);
  });

  it('rejects tampered payloads and traversal paths', () => {
    write('one.md', shared('# One\n'));
    githubPackage.write(root);
    const p = githubPackage.packagePath(root);
    const envelope = JSON.parse(fs.readFileSync(p, 'utf8'));
    envelope.contentSha256 = '0'.repeat(64);
    fs.writeFileSync(p, JSON.stringify(envelope));
    expect(() => githubPackage.read(root)).toThrow(/digest/);
    expect(() => githubPackage.safeRelativePath('../outside.md')).toThrow(/escapes/);
  });

  it('migrates a legacy .lore manifest without placing local metadata in the package', () => {
    fs.writeFileSync(path.join(root, '.lore'), JSON.stringify({ tenant: 'private-tenant', worklog: [{ summary: 'secret work' }] }));
    write('one.md', shared('# One\n'));
    githubPackage.write(root);
    const committed = fs.readFileSync(githubPackage.packagePath(root), 'utf8');
    expect(committed).not.toContain('private-tenant');
    expect(fs.existsSync(path.join(root, '.lore', 'manifest.json'))).toBe(true);
  });
});
