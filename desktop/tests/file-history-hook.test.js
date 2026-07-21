// File-anchored recall hook (#3): pure-function coverage + fetch behavior
// against a real local HTTP server. The hook's contract: silent exit on every
// failure path — these tests pin the gates that guarantee it.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import {
  fetchObservations,
  formatTimeline,
  gateDecision,
  humanizeDate,
  normalizePort,
  readSeenSet,
  rememberSeenPath,
  seenSetPath,
  truncateSummary,
} from '../assets/lore-file-history.js';

const tmpFiles = [];
afterEach(() => {
  while (tmpFiles.length) {
    try { fs.unlinkSync(tmpFiles.pop()); } catch {}
  }
});

describe('gateDecision', () => {
  const cwd = process.cwd();

  it('skips non-Read tools', () => {
    expect(gateDecision({ tool_name: 'Edit', tool_input: { file_path: 'a.py' } }).skip).toBe(true);
    expect(gateDecision(null).skip).toBe(true);
  });

  it('skips missing or empty file_path', () => {
    expect(gateDecision({ tool_name: 'Read', tool_input: {} }).skip).toBe(true);
    expect(gateDecision({ tool_name: 'Read', tool_input: { file_path: '   ' } }).skip).toBe(true);
  });

  it('skips vendored and temp paths', () => {
    for (const p of [
      path.join(cwd, 'node_modules', 'x', 'index.js'),
      path.join(cwd, '.git', 'HEAD'),
      path.join(cwd, 'dist', 'bundle.js'),
      path.join(os.tmpdir(), 'scratch.txt'),
    ]) {
      expect(gateDecision({ tool_name: 'Read', tool_input: { file_path: p }, cwd }).skip).toBe(true);
    }
  });

  it('passes a normal repo file and normalizes it', () => {
    const d = gateDecision({ tool_name: 'Read', tool_input: { file_path: 'core/lore/recall.py' }, cwd });
    expect(d.skip).toBe(false);
    expect(path.isAbsolute(d.normalizedPath)).toBe(true);
  });
});

describe('seen-set', () => {
  it('round-trips, dedups, and tolerates corruption', () => {
    const session = `vitest-${Date.now()}`;
    const file = seenSetPath(session);
    tmpFiles.push(file);

    const first = rememberSeenPath('/repo/a.py', session);
    expect(first.alreadySeen).toBe(false);
    const second = rememberSeenPath('/repo/a.py', session);
    expect(second.alreadySeen).toBe(true);

    fs.writeFileSync(file, '{corrupt', 'utf8');
    expect(readSeenSet(file)).toEqual({});
    expect(rememberSeenPath('/repo/a.py', session).alreadySeen).toBe(false);
  });

  it('sanitizes hostile session ids out of the filename', () => {
    // Dots survive sanitization (legal and harmless INSIDE a basename);
    // the guarantee that matters is no path separators — the file can
    // never escape the temp directory.
    const p = seenSetPath('../../evil/../id');
    expect(path.dirname(p)).toBe(path.dirname(seenSetPath('safe')));
    expect(path.basename(p)).not.toContain('/');
    expect(path.basename(p)).not.toContain('\\');
  });
});

describe('formatting', () => {
  it('builds a newest-first, tagged, truncated timeline', () => {
    const text = formatTimeline([
      { ts: '2026-07-18T10:00:00Z', type: 'decision', outcome: 'unverified', summary: 'L6 default' },
      { ts: '2026-07-20T10:00:00Z', type: 'bugfix', outcome: 'verified-success', summary: 'x'.repeat(200) },
    ], 'C:/repo/core/lore/sections.py');
    const lines = text.split('\n');
    expect(lines[0]).toContain("worked on this file before");
    expect(lines[1]).toContain('Jul 20');
    expect(lines[1]).toContain('<bugfix, verified>');
    expect(lines[1].length).toBeLessThan(200);
    expect(lines[2]).toContain('<decision>');           // no outcome tag when unverified
    expect(lines.at(-1)).toContain('sections.py');
  });

  it('returns empty for empty/blank observations', () => {
    expect(formatTimeline([], '/x/y.py')).toBe('');
    expect(formatTimeline([{ ts: 'bad', summary: '   ' }], '/x/y.py')).toBe('');
  });

  it('humanizes dates defensively', () => {
    expect(humanizeDate('2026-07-20T10:00:00Z')).toBe('Jul 20');
    expect(humanizeDate('garbage')).toBe('recently');
  });

  it('truncates summaries at the cap with ellipsis', () => {
    expect(truncateSummary('a'.repeat(300)).length).toBeLessThanOrEqual(140);
    expect(truncateSummary('short')).toBe('short');
  });

  it('normalizePort falls back on garbage', () => {
    expect(normalizePort('8123')).toBe(8123);
    expect(normalizePort('nope')).toBe(8099);
    expect(normalizePort(-1)).toBe(8099);
  });
});

describe('fetchObservations', () => {
  function serve(handler) {
    return new Promise((resolve) => {
      const server = http.createServer(handler);
      server.listen(0, '127.0.0.1', () => resolve(server));
    });
  }

  it('returns observations from a healthy endpoint', async () => {
    const server = await serve((req, res) => {
      expect(req.url).toContain('file=');
      expect(req.headers['x-lore-token']).toBe('tok');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ observations: [{ ts: 'now', summary: 'hi' }] }));
    });
    const port = server.address().port;
    const obs = await fetchObservations({ port, tenant: 't', localToken: 'tok' }, '/repo/a.py');
    server.close();
    expect(obs).toHaveLength(1);
  });

  it('returns [] on non-200, bad JSON, and timeout', async () => {
    const bad = await serve((req, res) => { res.writeHead(500); res.end('boom'); });
    expect(await fetchObservations({ port: bad.address().port, tenant: 't', localToken: '' }, '/a')).toEqual([]);
    bad.close();

    const garbage = await serve((req, res) => { res.writeHead(200); res.end('{nope'); });
    expect(await fetchObservations({ port: garbage.address().port, tenant: 't', localToken: '' }, '/a')).toEqual([]);
    garbage.close();

    const hang = await serve(() => { /* never respond */ });
    const t0 = Date.now();
    expect(await fetchObservations({ port: hang.address().port, tenant: 't', localToken: '' }, '/a', 150)).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(1000);          // timeout actually fired
    hang.close();
  });

  it('returns [] when nothing listens on the port', async () => {
    expect(await fetchObservations({ port: 1, tenant: 't', localToken: '' }, '/a', 300)).toEqual([]);
  });
});
