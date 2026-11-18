@echo off
setlocal
cd /d "%~dp0"
where python >nul 2>nul
if %errorlevel%==0 (
  start "Cue Vault" http://127.0.0.1:8765/CueVault.html
  python -m http.server 8765 --bind 127.0.0.1
) else (
  start "" "%~dp0CueVault.html"
  echo If browser crypto is unavailable for local files, install Python 3 and rerun this launcher.
  pause
)
