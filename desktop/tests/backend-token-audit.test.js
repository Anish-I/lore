import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import * as espree from 'espree';

const desktopDir = path.join(__dirname, '..');

function backendFetchCalls(relPath, urlMarker) {
  const filePath = path.join(desktopDir, relPath);
  const source = fs.readFileSync(filePath, 'utf8');
  const ast = espree.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    range: true,
    loc: true,
  });
  const calls = [];

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression'
        && node.callee.type === 'Identifier'
        && node.callee.name === 'fetch'
        && node.arguments[0]) {
      const urlSource = source.slice(node.arguments[0].range[0], node.arguments[0].range[1]);
      if (urlSource.includes(urlMarker)) {
        calls.push({
          line: node.loc.start.line,
          url: urlSource,
          source: source.slice(node.range[0], node.range[1]),
        });
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object' && value.type) walk(value);
    }
  }

  walk(ast);
  return calls;
}

function missingAuth(calls, authPattern, exempt = () => false) {
  return calls
    .filter((call) => !exempt(call) && !authPattern.test(call.source))
    .map((call) => `${call.line}: ${call.url}`);
}

describe('local backend token audit', () => {
  it('protects every main-process backend fetch except the documented health probe', () => {
    const calls = backendFetchCalls('main.js', 'BACKEND_URL()');
    const offenders = missingAuth(
      calls,
      /authHeaders\(|authedBackendHeaders\(/,
      (call) => call.url.includes('/presets'),
    );
    expect(offenders, `Tokenless main.js backend fetches:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('protects every preload backend fetch', () => {
    const calls = backendFetchCalls('preload.js', 'BACKEND');
    const offenders = missingAuth(calls, /authH\(/);
    expect(offenders, `Tokenless preload backend fetches:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('keeps refresh, logout, and retried user requests behind local authentication', () => {
    const calls = backendFetchCalls('lib/auth-session.js', 'baseUrl()');
    const offenders = missingAuth(calls, /local\(\)|authedBackendHeaders\(/);
    expect(
      offenders,
      `Tokenless auth-session backend fetches:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('passes authentication into hook status polling', () => {
    const calls = backendFetchCalls('hooks-installer.js', 'runtime.backendUrl()');
    const offenders = missingAuth(calls, /\{\s*headers\s*\}/);
    expect(offenders, `Tokenless hook backend fetches:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('keeps scraper and installed hook transports token-aware', () => {
    const scraper = fs.readFileSync(path.join(desktopDir, 'scraper.js'), 'utf8');
    expect(scraper).toContain("headers: { 'content-type': 'application/json', ...AUTH_HEADERS }");
    expect(scraper).toContain('AUTH_HEADERS = headers || {}');

    for (const relPath of [
      'assets/lore-inject.js',
      'assets/lore-capture.js',
      'assets/lore-codex-notify.js',
    ]) {
      const calls = backendFetchCalls(relPath, 'BACKEND');
      const offenders = missingAuth(calls, /X-Lore-Token/);
      expect(offenders, `Tokenless ${relPath} backend fetches:\n${offenders.join('\n')}`).toEqual([]);
    }
  });
});
