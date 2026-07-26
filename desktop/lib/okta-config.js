'use strict';

const fs = require('fs');

function readJson(filePath) {
  if (!filePath) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function serializedGroupMap(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && !Array.isArray(value)) return JSON.stringify(value);
  throw new Error('Okta group_scope_map must be a JSON object or JSON string.');
}

function loadOktaClient({ env = process.env, defaultFile } = {}) {
  const filePath = env.OKTA_CLIENT_FILE || defaultFile;
  const file = readJson(filePath);
  const cfg = {
    ...file,
    issuer: env.OKTA_ISSUER || file.issuer,
    client_id: env.OKTA_CLIENT_ID || file.client_id,
    client_secret: env.OKTA_CLIENT_SECRET || file.client_secret,
    scope: env.OKTA_SCOPES || file.scope,
    token_endpoint_auth_method:
      env.OKTA_TOKEN_ENDPOINT_AUTH_METHOD || file.token_endpoint_auth_method,
  };

  const envMap = env.OKTA_GROUP_SCOPE_MAP;
  cfg.group_scope_map = serializedGroupMap(
    envMap != null && envMap !== '' ? envMap : file.group_scope_map,
  );

  if (!cfg.issuer || !cfg.client_id) return null;
  cfg.issuer = String(cfg.issuer).replace(/\/+$/, '');
  return cfg;
}

function applyOktaBackendEnv(target, cfg) {
  if (!cfg) return target;
  if (!target.OKTA_ISSUER) target.OKTA_ISSUER = cfg.issuer;
  if (!target.OKTA_CLIENT_ID) target.OKTA_CLIENT_ID = cfg.client_id;
  if (!target.OKTA_GROUP_SCOPE_MAP && cfg.group_scope_map) {
    target.OKTA_GROUP_SCOPE_MAP = cfg.group_scope_map;
  }
  return target;
}

module.exports = { loadOktaClient, applyOktaBackendEnv };
