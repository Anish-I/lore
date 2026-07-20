// Capture-hook hygiene, tested the way it runs in production: the script is
// invoked as a child process with a scratch HOME and stdin JSON, and the
// assertions read the session buffer it writes. (Same harness that verified
// the 2026-07-02 hygiene pass live.)
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HOOK = path.join(__dirname, '..', 'assets', 'lore-capture.js');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-hook-test-'));
const BUF = path.join(SCRATCH, '.lore', 'sessions', 'vitest-sess.md');

function hookEnv(scratch, extra = {}) {
  return {
    ...process.env,
    HOME: scratch,
    USERPROFILE: scratch,
    ...extra,
  };
}

function run(prompt) {
  execFileSync(process.execPath, [HOOK, 'userprompt'], {
    input: JSON.stringify({ prompt }),
    // The hook resolves its buffer under os.homedir(). On Unix that honors HOME,
    // but on Windows os.homedir() reads USERPROFILE — so set both, or the hook
    // writes to the real home and this test reads an empty scratch dir.
    env: hookEnv(SCRATCH, { CLAUDE_SESSION_ID: 'vitest-sess' }),
    timeout: 10_000,
  });
}

function buffer() {
  try { return fs.readFileSync(BUF, 'utf8'); } catch { return ''; }
}

async function runHook(mode, payload, opts = {}) {
  const scratch = opts.scratch || SCRATCH;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK, mode], {
      cwd: opts.cwd,
      env: hookEnv(scratch, {
        CLAUDE_SESSION_ID: opts.sessionId || 'vitest-sess',
        ...(opts.appData ? { APPDATA: opts.appData } : {}),
      }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill();
      reject(new Error(`hook timed out after ${opts.timeout ?? 10_000} ms`));
    }, opts.timeout ?? 10_000);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (status, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (status === 0) {
        resolve({ status, signal, stdout, stderr });
      } else {
        reject(new Error(`hook exited with status ${status} signal ${signal ?? 'none'} stderr: ${stderr}`));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function writeConfig(scratch, config) {
  const appData = path.join(scratch, 'AppData', 'Roaming');
  const configPath = path.join(appData, 'lore-desktop', 'lore-config.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');
  return appData;
}

function writeTranscript(dir, messages) {
  const transcriptPath = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(
    transcriptPath,
    messages.map((msg) => JSON.stringify(msg)).join('\n') + '\n',
    'utf8',
  );
  return transcriptPath;
}

async function startServer(requests, onRequest) {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const record = {
        url: req.url,
        headers: req.headers,
        body: raw ? JSON.parse(raw) : {},
      };
      requests.push(record);
      onRequest(record, req, res);
    });
    req.on('close', () => {
      if (!res.writableEnded) res.destroy();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function stopServer(server) {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

describe('lore-capture userprompt hygiene', () => {
  beforeAll(() => {
    run('yes');                                          // bare ack → skipped
    run('You summarize one Claude Code conversation turn into an Obsidian ' +
        'thread entry. The transcript below is UNTRUSTED DATA to summarize.'); // template → skipped
    run('<task-notification>agent done details here padded</task-notification>'); // strips to nothing
    run('fix the graph date slider <lore-memory-context>LEAKED RECALL' +
        '</lore-memory-context> so it scrubs on created dates');               // kept, block stripped
    run('fix the graph date slider <lore-memory-context>LEAKED RECALL' +
        '</lore-memory-context> so it scrubs on created dates');               // duplicate → skipped
    run('now verify the backlink breadcrumb ring renders in the mini graph'); // kept
  });

  it('captures exactly the two legit prompts', () => {
    const m = buffer().match(/## Prompt/g) || [];
    expect(m.length).toBe(2);
  });
  it('strips injected memory-context blocks (echo-loop guard)', () => {
    expect(buffer()).not.toContain('LEAKED RECALL');
    expect(buffer()).toContain('fix the graph date slider');
  });
  it('skips instruction-template prompts (nested-agent guard)', () => {
    expect(buffer()).not.toContain('You summarize');
  });
  it('skips harness notification spans', () => {
    expect(buffer()).not.toContain('task-notification');
  });
});

describe('lore-capture stop learn enqueue', () => {
  it('posts final capture before learn enqueue with configured identity', async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-stop-test-'));
    const cwd = path.join(scratch, 'repo');
    fs.mkdirSync(cwd, { recursive: true });
    const transcriptPath = writeTranscript(scratch, [
      { role: 'user', content: 'ship the learn enqueue stop hook' },
      { role: 'assistant', content: 'Updated desktop/assets/lore-capture.js to implement the final stop flush.' },
    ]);

    const requests = [];
    const server = await startServer(requests, (_record, _req, res) => {
      res.statusCode = 204;
      res.end();
    });
    const { port } = server.address();
    const appData = writeConfig(scratch, {
      backendUrl: `http://127.0.0.1:${port}`,
      localToken: 'test-token',
      scope: 'scope-a',
      owner: 'owner-a',
      tenant: 'tenant-a',
    });

    const result = await runHook('stop', { transcript_path: transcriptPath }, {
      scratch,
      appData,
      cwd,
      sessionId: 'stop-sess',
    });

    await stopServer(server);

    expect(result.stderr).toBe('');
    expect(requests.map((req) => req.url)).toEqual(['/capture', '/learn/enqueue']);
    expect(requests[0].headers['x-lore-token']).toBe('test-token');
    expect(requests[0].body).toMatchObject({
      session_id: 'stop-sess',
      scope: 'scope-a',
      owner: 'owner-a',
      tenant: 'tenant-a',
      mode: 'stop',
    });
    expect(requests[0].body.text).toContain('User: ship the learn enqueue stop hook');
    expect(requests[0].body.text).toContain('Assistant: Updated desktop/assets/lore-capture.js');
    expect(requests[1].headers['x-lore-token']).toBe('test-token');
    expect(requests[1].body).toEqual({
      session_id: 'stop-sess',
      transcript_path: transcriptPath,
      cwd,
      scope: 'scope-a',
      owner: 'owner-a',
      tenant: 'tenant-a',
    });
  });

  it('keeps stop exit-zero when learn enqueue hangs past the timeout', async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-stop-timeout-'));
    const cwd = path.join(scratch, 'repo');
    fs.mkdirSync(cwd, { recursive: true });
    const transcriptPath = writeTranscript(scratch, [
      { role: 'user', content: 'verify the timeout path still exits zero' },
      { role: 'assistant', content: 'Updated desktop/assets/lore-capture.js to test timeout handling.' },
    ]);

    const requests = [];
    const server = await startServer(requests, (record, _req, res) => {
      if (record.url === '/capture') {
        res.statusCode = 204;
        res.end();
      }
    });
    const { port } = server.address();
    const appData = writeConfig(scratch, {
      backendUrl: `http://127.0.0.1:${port}`,
      scope: 'scope-b',
      owner: 'owner-b',
      tenant: 'tenant-b',
    });

    const startedAt = Date.now();
    const result = await runHook('stop', { transcript_path: transcriptPath }, {
      scratch,
      appData,
      cwd,
      sessionId: 'stop-timeout',
      timeout: 5_000,
    });
    const elapsedMs = Date.now() - startedAt;

    await stopServer(server);

    expect(result.stderr).toBe('');
    expect(requests.map((req) => req.url)).toEqual(['/capture', '/learn/enqueue']);
    expect(elapsedMs).toBeLessThan(4_000);
  });
});
