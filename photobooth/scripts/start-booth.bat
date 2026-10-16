@echo off
rem Starts the booth server in a minimised window, then opens the guest screen full-screen.
rem Double-click this file (or put a shortcut to it in shell:startup so the booth starts with Windows).
rem NOTE: written for Windows but not yet run on a real Windows PC - see README "What has been verified".
setlocal
cd /d "%~dp0\.."
title Nexus Booth launcher

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 22 LTS from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist config.json (
  echo config.json was not found.
  echo Copy config.hardware.example.json to config.json, edit it, then run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing the booth's dependencies ^(first run only, needs internet^)...
  call npm ci --omit=dev
  if errorlevel 1 (
    echo Dependency install failed.
    pause
    exit /b 1
  )
)

if not exist logs mkdir logs

set PORT=3000
for /f %%p in ('node scripts\print-port.mjs') do set PORT=%%p

echo Starting the booth server on port %PORT%...
start "Nexus Booth server" /min cmd /c "node server\index.js >> logs\server-console.log 2>&1"

rem Wait up to 30 seconds for the server to answer.
powershell -NoProfile -Command "$u='http://127.0.0.1:%PORT%/api/health'; for($i=0;$i -lt 60;$i++){ try{ if((Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200){ exit 0 } }catch{}; Start-Sleep -Milliseconds 500 }; exit 1"
if errorlevel 1 (
  echo The booth server did not start. See logs\booth.log and logs\server-console.log.
  pause
  exit /b 1
)

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

if exist "%CHROME%" (
  start "" "%CHROME%" --kiosk --noerrdialogs --disable-infobars --disable-pinch --overscroll-history-navigation=0 --user-data-dir="%CD%\logs\chrome-profile" http://127.0.0.1:%PORT%
) else (
  echo Google Chrome was not found, using Microsoft Edge.
  start msedge --kiosk http://127.0.0.1:%PORT% --edge-kiosk-type=fullscreen --no-first-run
)

echo.
echo The booth is running. Close the minimised "Nexus Booth server" window to stop it.
echo Leave kiosk mode with Alt+F4. Operator panel: tap the top-left corner of the start screen 5 times.
timeout /t 5 >nul
