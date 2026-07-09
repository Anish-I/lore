// Scratch test for the `lore` CLI installer — dev wrapper (python -m lore.cli)
// AND packaged wrapper (frozen `lore-backend cli`). Guards the packaged-mode
// regression where the wrapper baked a PYTHONPATH at a core/ dir that packaged
// builds don't ship.
//   HOME=$(mktemp -d) node desktop/test-cli-installer.js
'use strict';
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-cli-test-'));
process.env.HOME = scratch;
process.env.LOCALAPPDATA = path.join(scratch, 'Local');
os.homedir = () => scratch;

const isWin = process.platform === 'win32';
let pass = 0, fail = 0;
const ok = (l, c) => { if (c) { pass++; console.log('  ✓', l); } else { fail++; console.error('  ✗', l); } };

// Fresh require each time so process.resourcesPath changes are picked up (the
// module reads it at call time, not import time, so one require is enough).
const cli = require('./cli-installer');

// --- Dev mode: no frozen backend → python -m lore.cli wrapper ---
delete process.resourcesPath;
const r1 = cli.installCli();
ok('dev installCli ok', r1 && r1.ok === true);
const wrapperPath = cli.cliTargetPath();
ok('wrapper file written', fs.existsSync(wrapperPath));
let body = fs.readFileSync(wrapperPath, 'utf8');
ok('dev wrapper invokes lore.cli', body.includes('-m lore.cli'));
ok('dev wrapper sets PYTHONPATH', /PYTHONPATH/.test(body));
ok('dev wrapper does NOT reference frozen backend', !body.includes('lore-backend'));
const st1 = cli.cliStatus();
ok('cliStatus reports installed', st1 && st1.installed === true);

// --- Packaged mode: frozen backend present → `lore-backend cli` wrapper ---
const resDir = path.join(scratch, 'Resources');
const beDir = path.join(resDir, 'lore-backend');
fs.mkdirSync(beDir, { recursive: true });
const exeName = isWin ? 'lore-backend.exe' : 'lore-backend';
fs.writeFileSync(path.join(beDir, exeName), '#!/bin/sh\necho frozen\n', 'utf8');
Object.defineProperty(process, 'resourcesPath', { value: resDir, configurable: true });

const r2 = cli.installCli();
ok('packaged installCli ok', r2 && r2.ok === true);
body = fs.readFileSync(cli.cliTargetPath(), 'utf8');
ok('packaged wrapper calls frozen backend', body.includes('lore-backend'));
ok('packaged wrapper uses cli subcommand', /lore-backend(\.exe)?["' ]+.*\bcli\b/.test(body) || /cli /.test(body) || body.includes('" cli'));
ok('packaged wrapper does NOT set PYTHONPATH at core/', !/PYTHONPATH=.*core/.test(body));

console.log(`\ncli-installer: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
