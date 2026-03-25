@echo off
REM Siliu Launcher - Windows

cd /d "%~dp0"
if not exist logs mkdir logs

echo Stopping any existing Siliu processes...
taskkill /F /IM electron.exe 2>nul

ping -n 2 127.0.0.1 >nul

echo Starting Siliu...

REM Clear environment variable that may cause Electron to run in Node mode
set ELECTRON_RUN_AS_NODE=

.\node_modules\.bin\electron . --no-sandbox 2>&1 | powershell -Command "$input | Tee-Object -FilePath logs\siliu.log"
