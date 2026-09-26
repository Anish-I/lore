import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const hook = fileURLToPath(new URL('../assets/lore-inject.js', import.meta.url));

async function probe(status, { headerDelay = 0, bodyDelay = 0 } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url); req.resume();
    if (req.url === '/context-pack') setTimeout(() => {
      if (res.destroyed) return;
      res.writeHead(status, { 'content-type': 'application/json' }); res.flushHeaders();
      setTimeout(() => { if (!res.destroyed) res.end('{"pack":"","items":[],"tokens_total":0}'); }, bodyDelay);
    }, headerDelay);
    else if (req.url === '/search') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"results":[]}'); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-inject-test-'));
  fs.mkdirSync(path.join(appData, 'lore-desktop'));
  fs.writeFileSync(path.join(appData, 'lore-desktop', 'lore-config.json'), '{"scope":"research","tenant":"solo"}');
  const start = performance.now();
  try {
    const child = spawn(process.execPath, [hook], { windowsHide: true, env: { ...process.env,
      APPDATA: appData, LORE_BACKEND_URL: 'http://127.0.0.1:' + server.address().port,
      LORE_INJECT_TIMEOUT: '100' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', (part) => { stderr += part; }); child.stdout.resume();
    const done = new Promise((resolve, reject) => { child.on('close', resolve); child.on('error', reject); });
    child.stdin.end(JSON.stringify({ prompt: 'Synthetic recall deadline check', session_id: 'test-session' }));
    expect(await done, stderr).toBe(0);
    return { requests, elapsed: performance.now() - start };
  } finally {
    server.closeAllConnections(); server.close();
    expect(path.dirname(fs.realpathSync(appData))).toBe(fs.realpathSync(os.tmpdir()));
    fs.rmSync(appData, { recursive: true, force: true });
  }
}

describe('Lore injection deadline', () => {
  it('does not retry search after a timed-out pack or body', async () => {
    for (const delay of [{ headerDelay: 1000 }, { bodyDelay: 1000 }]) {
      const result = await probe(200, delay);
      expect(result.requests).toEqual(['/context-pack']);
      expect(result.elapsed).toBeLessThan(700);
    }
  });
  it('uses search only when context-pack is missing', async () => {
    expect((await probe(503)).requests).toEqual(['/context-pack']);
    expect((await probe(404)).requests).toEqual(['/context-pack', '/search']);
  });
});
