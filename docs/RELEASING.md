# Releasing Lore

## Cutting a release

```bash
git checkout main && git pull
git tag v0.1.0-beta.2          # any tag containing '-' is auto-marked prerelease
git push origin v0.1.0-beta.2
```

The `Release` workflow then, **per platform** (macOS / Windows / Linux):
1. Freezes the Python backend with PyInstaller (`core/build_backend*.sh`).
2. **Smoke-boots the frozen binary** against `GET /presets` — a build whose backend
   can't start fails the job and never ships.
3. Builds the installer with electron-builder (dmg+zip / nsis exe / AppImage+deb).
4. Attaches artifacts **plus the `latest*.yml` update metadata** to a **draft**
   GitHub Release with generated notes.

Review the draft on the Releases page, edit notes if needed, click **Publish**.
Auto-update (electron-updater) serves new versions to existing installs straight
from the published release — no update server.

## Code signing

Builds are **unsigned** until these repo secrets exist (Settings → Secrets →
Actions). The workflow picks them up automatically — no YAML changes needed:

| Secret | Platform | What it is |
| --- | --- | --- |
| `CSC_LINK` | macOS | base64 of the Developer ID Application `.p12` |
| `CSC_KEY_PASSWORD` | macOS | password for that `.p12` |
| `APPLE_ID` | macOS | Apple ID email (for notarization) |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS | app-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | macOS | 10-char team ID |
| `WIN_CSC_LINK` | Windows | base64 of the code-signing `.pfx` |
| `WIN_CSC_KEY_PASSWORD` | Windows | password for that `.pfx` |

Requires an Apple Developer Program membership ($99/yr) for mac; Azure Trusted
Signing or an OV/EV cert for Windows. Linux artifacts are not signed.

### Consequences of shipping unsigned (current state)
- **macOS**: Gatekeeper blocks double-click. Users right-click → Open (once), or
  `xattr -dr com.apple.quarantine /Applications/Lore.app`.
  **Auto-update is inert on unsigned mac builds** — electron-updater refuses them
  by design. It lights up the first signed release.
- **Windows**: SmartScreen shows "unrecognized app" (More info → Run anyway).
  Auto-update works unsigned.
- **Linux**: no signing concept for AppImage/deb; everything works.

## Version bumps

`desktop/package.json` `version` drives the artifact version — bump it before
tagging (`npm version prerelease --preid beta --no-git-tag-version` in desktop/).
