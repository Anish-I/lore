import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import oktaConfig from '../lib/okta-config';

function withConfigFile(contents, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-okta-config-'));
  const file = path.join(dir, 'okta.json');
  fs.writeFileSync(file, JSON.stringify(contents));
  try { return fn(file); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

describe('Okta configuration', () => {
  it('returns null when no tenant is configured', () => {
    expect(oktaConfig.loadOktaClient({ env: {}, defaultFile: 'missing.json' })).toBeNull();
  });

  it('loads a local config and serializes its group map for the backend', () => {
    withConfigFile({
      issuer: 'https://example.okta.com/oauth2/default/',
      client_id: 'client-id',
      group_scope_map: { Engineering: 't-eng' },
    }, (file) => {
      const cfg = oktaConfig.loadOktaClient({ env: {}, defaultFile: file });
      expect(cfg.issuer).toBe('https://example.okta.com/oauth2/default');
      expect(cfg.group_scope_map).toBe('{"Engineering":"t-eng"}');

      const childEnv = {};
      oktaConfig.applyOktaBackendEnv(childEnv, cfg);
      expect(childEnv).toEqual({
        OKTA_ISSUER: cfg.issuer,
        OKTA_CLIENT_ID: 'client-id',
        OKTA_GROUP_SCOPE_MAP: '{"Engineering":"t-eng"}',
      });
    });
  });

  it('lets environment values override file values without forwarding the client secret', () => {
    withConfigFile({
      issuer: 'https://file.okta.com',
      client_id: 'file-client',
      client_secret: 'desktop-only-secret',
    }, (file) => {
      const cfg = oktaConfig.loadOktaClient({
        env: {
          OKTA_CLIENT_FILE: file,
          OKTA_ISSUER: 'https://env.okta.com/',
          OKTA_CLIENT_ID: 'env-client',
          OKTA_GROUP_SCOPE_MAP: '{"Legal":"t-legal"}',
        },
      });
      const childEnv = {};
      oktaConfig.applyOktaBackendEnv(childEnv, cfg);
      expect(cfg.client_secret).toBe('desktop-only-secret');
      expect(childEnv.OKTA_CLIENT_SECRET).toBeUndefined();
      expect(childEnv.OKTA_ISSUER).toBe('https://env.okta.com');
      expect(childEnv.OKTA_CLIENT_ID).toBe('env-client');
    });
  });
});
