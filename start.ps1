# start.ps1 — one clean start for Lore (backend + desktop front-end).
#
# The desktop app already spawns its OWN backend (uvicorn on the backend port),
# so "front" boots "back" for you — you do NOT run core/run_server.py separately
# (that just collides on the port: WinError 10048). This launcher's whole job is
# to guarantee a CLEAN slate first: kill anything stale left over from a previous
# run (a backend still squatting on the port, an orphaned Electron window, a
# zombie uvicorn), then start the app fresh so there's no port clash and no race.
#
# It is deliberately CONSERVATIVE about what it kills and what it deletes:
#   • Kills ONLY processes tied to THIS repo — the process on the backend port,
#     python running THIS repo's `lore.api`, and Electron launched from THIS
#     folder. Your VS Code, browsers, and other apps are never touched.
#   • Deletes NOTHING of yours — not your notes, not the local SQLite DB, not the
#     Qdrant embeddings. "Clean" here means clean PROCESSES, not wiped data.
#
# Usage:   .\start.ps1
# Options: -ServerMode   pass through LORE_SERVER_MODE=1 for a server-mode boot
#          -Port <n>     override the backend port to clear (else $env:LORE_PORT or 8099)

param(
  [switch]$ServerMode,
  [int]$Port
)

$ErrorActionPreference = 'Stop'
$repo    = $PSScriptRoot
$desktop = Join-Path $repo 'desktop'

# --- resolve the backend port the app will use (env LORE_PORT -> arg -> 8099) ---
if (-not $Port) {
  if ($env:LORE_PORT) { $Port = [int]$env:LORE_PORT } else { $Port = 8099 }
}

function Write-Step($msg) { Write-Host "  $msg" -ForegroundColor Cyan }
function Write-Kill($msg) { Write-Host "  killed $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "==> Lore clean start" -ForegroundColor Green
Write-Host "    repo: $repo"
Write-Host "    backend port: $Port"
Write-Host ""

# 1) Free the backend port — this is the stale backend that causes WinError 10048.
Write-Step "clearing anything on port $Port ..."
try {
  $owners = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique |
            Where-Object { $_ -and $_ -ne 0 }
  foreach ($procId in $owners) {
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($p) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue; Write-Kill "$($p.ProcessName) (pid $procId) on :$Port" }
  }
} catch { Write-Step "  (nothing on :$Port)" }

# 2) Kill zombie uvicorn/python running THIS repo's lore.api (matched by command line,
#    so unrelated python you may be running elsewhere is left alone).
Write-Step "clearing stale lore backends (uvicorn lore.api) ..."
try {
  Get-CimInstance Win32_Process -Filter "Name = 'python.exe' OR Name = 'pythonw.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match 'lore\.api' } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      Write-Kill "python (pid $($_.ProcessId)) running lore.api"
    }
} catch { }

# 3) Kill orphaned Electron windows launched from THIS repo (matched by path, so
#    VS Code and other Electron apps are never touched).
Write-Step "clearing orphaned Lore desktop windows ..."
try {
  Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match [regex]::Escape($desktop) } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      Write-Kill "electron (pid $($_.ProcessId)) from this repo"
    }
} catch { }

# Give the OS a moment to release the socket (TIME_WAIT) before we rebind it.
Start-Sleep -Milliseconds 600

# 4) Boot fresh. `npm start` rebuilds the renderer (prestart) and the app spawns
#    its own backend — one process tree, one terminal, both logs here.
if ($ServerMode) { $env:LORE_SERVER_MODE = '1'; Write-Step "LORE_SERVER_MODE=1 (server-mode boot)" }
$env:LORE_PORT = "$Port"

Write-Host ""
Write-Host "==> starting Lore (front spawns back) ..." -ForegroundColor Green
Write-Host ""
Push-Location $desktop
try {
  npm start
} finally {
  Pop-Location
}
