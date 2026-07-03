// Packaged-vs-dev command resolution — the decision that determines whether
// the agent-memory loop survives packaging (frozen `lore-backend mcp` for dmg
// installs, repo venv in dev, never Electron's execPath in hook commands).
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import mcpInstaller from '../mcp-installer';
import hooksInstaller from '../hooks-installer';

describe('resolveMcpCommand', () => {
  const ORIG_RES = process.resourcesPath;
  afterEach(() => {
    if (ORIG_RES === undefined) delete process.resourcesPath;
    else process.resourcesPath = ORIG_RES;
  });

  it('dev: prefers the repo venv python with -m lore.mcp_server', () => {
    delete process.resourcesPath; // plain-node test env = dev
    // Deterministic fixture: a temp core dir with a sibling .venv, injected via the
    // coreDir param (avoids depending on whether an actual repo venv exists on the
    // test machine — the CI runners and clean checkouts have none).
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-dev-'));
    const coreDir = path.join(parent, 'core');
    fs.mkdirSync(coreDir, { recursive: true });
    const venvPy = path.join(parent, '.venv',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    fs.mkdirSync(path.dirname(venvPy), { recursive: true });
    fs.writeFileSync(venvPy, '');
    const r = mcpInstaller.resolveMcpCommand(coreDir);
    expect(r.command).toContain('.venv');
    expect(r.command).toBe(venvPy);
    expect(r.args).toEqual(['-m', 'lore.mcp_server']);
    expect(r.extraEnv.PYTHONPATH).toBe(coreDir);
  });

  it('packaged: uses the frozen backend binary in mcp mode', () => {
    const fakeRes = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-res-'));
    const exe = process.platform === 'win32' ? 'lore-backend.exe' : 'lore-backend';
    fs.mkdirSync(path.join(fakeRes, 'lore-backend'), { recursive: true });
    fs.writeFileSync(path.join(fakeRes, 'lore-backend', exe), '#!/bin/sh\n');
    process.resourcesPath = fakeRes;
    const r = mcpInstaller.resolveMcpCommand();
    expect(r.command).toBe(path.join(fakeRes, 'lore-backend', exe));
    expect(r.args).toEqual(['mcp']);
    // No PYTHONPATH — the frozen bundle is self-contained.
    expect(r.extraEnv.PYTHONPATH).toBeUndefined();
  });

  it('packaged WITHOUT the frozen binary present falls back to dev resolution', () => {
    process.resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-res-empty-'));
    const r = mcpInstaller.resolveMcpCommand();
    expect(r.args).toEqual(['-m', 'lore.mcp_server']);
  });
});

describe('resolveNode', () => {
  it('returns an absolute path to a real node binary (never Electron)', () => {
    const n = hooksInstaller.resolveNode();
    expect(n).toBeTruthy();
    expect(path.isAbsolute(n)).toBe(true);
    expect(fs.existsSync(n)).toBe(true);
    expect(n.toLowerCase()).not.toContain('electron');
  });
});
