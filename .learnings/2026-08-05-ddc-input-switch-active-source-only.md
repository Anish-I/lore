# DDC/CI input switching: most monitors only obey the active source (and the blink workaround)

**Date:** 2026-08-05
**Context:** Built `~/.monitor-switch` — one-sided auto-switch of monitor inputs between home PC and work machine keyed to Yeti Nano USB presence (poor man's KVM, no software allowed on the work machine).

## Learning 1: DDC obeys only the active source

Tested on three monitors via `dxva2.dll` (`SetVCPFeature`, VCP 0x60):

- **MSI G274QPF E2**: DDC completely dead while displaying another input (reads fail with `0xC0262589` graphics I2C error).
- **ASUS VG24VQE**: answers DDC *reads* from the inactive input but silently ignores input-switch *writes* — `SetVCPFeature` returns TRUE with no effect. Never trust the set's return value; verify by read-back.
- **Acer QG271 E**: fully controllable from either machine, active or not.

## Learning 2: the signal-blink workaround (verified live)

A one-sided switcher can still *pull* stubborn monitors back: detach the display (`ChangeDisplaySettingsExW` with 0x0 resolution + `CDS_UPDATEREGISTRY|CDS_NORESET`, then apply staged with all-NULL call), wait ~5 s, reattach with the saved DEVMODE. The monitor sees a "new" signal and its **auto input detection grabs it** — but ONLY if auto-detect is enabled in the monitor OSD (ASUS: had to enable it; default was off and the blink did nothing).

## Learning 2b: auto-detect cuts both ways (bounce-back)

With auto input detect enabled, a monitor pushed to a **dead** input refuses to stay: traced the ASUS holding HDMI2 for ~6 s after a successful DDC push, then bouncing back to the live DP signal because the work machine was asleep. A user-visible "the switch didn't work" can actually be "the switch worked and the monitor bounced". Fix: bounded re-push loop after switching away (every 30 s for ~2.5 min) — once the other machine's signal wakes, the push sticks; monitors also auto-grab that new signal themselves. Diagnose with a 500 ms read-back trace, not a single read.

## Learning 2c: two live signals = immovable (the hard limit)

When BOTH sources are actively outputting, MSI/ASUS-class monitors cannot be moved from the inactive side at all: DDC is ignored/dead, and auto input detect does not leave a live signal for a new one (the blink that worked against a sleeping work machine does nothing against an awake one). They only come home via signal events (a desktop re-layout re-driving links sometimes triggers the grab) or when the other machine's screens sleep. Set expectations accordingly: one-sided KVM returns are staged, not instant — unless the other machine drops its signal quickly (short display-off timeout / lid close).

## Learning 3: Win32 display API gotchas (cost real debugging time)

- **PowerShell marshals `$null` as empty string** for `string` P/Invoke params. `ChangeDisplaySettingsEx(NULL,...)` (apply-staged) and `EnumDisplayDevices(NULL, i, ...)` (adapter enum) then fail (-5 BADPARAM / FALSE). Fix: declare an `IntPtr` overload via `EntryPoint` and pass `[IntPtr]::Zero`.
- **`\\.\DISPLAYn` numbering shifts after detach/attach** (ASUS moved DISPLAY2→DISPLAY4→DISPLAY3 within minutes). Re-applying a saved mode to a stale device name gives BADMODE (-2) or hits the wrong display. Always re-locate the adapter by matching the monitor PnP ID (`EnumDisplayDevices(adapter, 0, EDD_GET_DEVICE_INTERFACE_NAME)` → DeviceID contains `AUS2406` etc.) immediately before every stage+apply.
- A failed reattach leaves the display detached and persisted in the registry — guard the blink so it never detaches without a restorable DEVMODE in hand.

## Learning 4: Git Bash `tail -f` locks Windows files against writers

Tailing the watcher's log with msys `tail -f` (via the Monitor tool) made PowerShell's `Add-Content` fail with "file is being used by another process" — the watcher ran a whole dock cycle with ZERO log lines because its `Write-Log` swallowed the errors. Observation tooling silently destroyed the telemetry it was meant to capture. Reproduced deliberately, confirmed, and verified writes recover the moment tail dies. Tail Windows log files with `Get-Content -Wait -Tail N` (share-friendly), never msys tail; and never let a logging helper swallow errors without any fallback signal.

## Other gotchas

- `$home` is a read-only automatic variable in PowerShell.
- `Get-PnpDevice` keeps phantom entries for unplugged devices (`Status='Unknown'`); presence = `Status -eq 'OK'`.
- When probing processes by command-line substring, your own probe matches too — build the pattern by concatenation (`'monitor-' + 'switch.ps1'`).
