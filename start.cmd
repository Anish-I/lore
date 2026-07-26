@echo off
REM Double-click launcher for Lore — clean start (kills stale, boots fresh).
REM Just calls start.ps1 with an execution-policy bypass so no setup is needed.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
pause
