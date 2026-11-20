@echo off
setlocal
cd /d "%~dp0"
if exist "PolySim-Play.html" (
  start "" "%~dp0PolySim-Play.html"
  exit /b 0
)
if exist "dist-offline\PolySim-Play.html" (
  start "" "%~dp0dist-offline\PolySim-Play.html"
  exit /b 0
)
set "POLYSIM_NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    set "POLYSIM_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  ) else (
    echo PolySim requires Node.js 24 or newer. Install Node.js, then reopen this launcher.
    pause
    exit /b 1
  )
)
if not exist "dist-offline\index.html" (
  echo Build missing. In this folder run npm ci, then npm run build:offline.
  pause
  exit /b 1
)
"%POLYSIM_NODE%" scripts\serve.mjs --open
if errorlevel 1 pause
