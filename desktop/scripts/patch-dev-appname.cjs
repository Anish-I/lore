// Dev-only (macOS): the Dock tooltip/name comes from the app BUNDLE's
// Info.plist — `app.setName('Lore')` fixes menus and userData but the dev
// bundle is node_modules/electron/dist/Electron.app, so the Dock still says
// "Electron". Patch its CFBundleName/CFBundleDisplayName to "Lore".
// Idempotent; re-runs automatically after every npm install (postinstall) so
// Electron upgrades (which replace the bundle) get re-patched. Packaged builds
// are unaffected — electron-builder produces a real Lore.app.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.platform !== 'darwin') process.exit(0);

const plist = path.join(__dirname, '..', 'node_modules', 'electron', 'dist',
  'Electron.app', 'Contents', 'Info.plist');
if (!fs.existsSync(plist)) process.exit(0);

try {
  const cur = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleName', plist],
    { encoding: 'utf8' }).trim();
  if (cur === 'Lore') process.exit(0); // already patched
  for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} Lore`, plist]);
    } catch {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string Lore`, plist]);
    }
  }
  // Nudge LaunchServices to re-read the bundle metadata.
  try {
    execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
      ['-f', path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app')]);
  } catch { /* cosmetic; Dock picks it up on next app launch regardless */ }
  console.log('[patch-dev-appname] dev Electron.app renamed to Lore in Info.plist');
} catch (e) {
  console.warn('[patch-dev-appname] skipped:', e.message);
}
