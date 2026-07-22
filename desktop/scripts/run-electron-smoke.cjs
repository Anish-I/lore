// Cross-platform runner for the opt-in Playwright Electron smoke test.
// Sets LORE_E2E_ELECTRON (which the test gates on) without needing cross-env,
// then runs vitest for just the smoke file. `npm run test:e2e:electron`.
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const vitestBin = path.join(__dirname, '..', 'node_modules', 'vitest', 'vitest.mjs');
const r = spawnSync(
  process.execPath,
  [vitestBin, 'run', 'tests/okta-electron.smoke.test.js'],
  { stdio: 'inherit', env: { ...process.env, LORE_E2E_ELECTRON: '1' }, cwd: path.join(__dirname, '..') });

process.exit(r.status == null ? 1 : r.status);
