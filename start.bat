@echo off
REM Siliu Browser Launcher - Windows

cd /d "%~dp0"
if not exist logs mkdir logs

echo Stopping any existing Siliu processes...
taskkill /F /IM electron.exe 2>nul

ping -n 2 127.0.0.1 >nul

echo Starting Siliu Browser...
.\node_modules\.bin\electron . --no-sandbox 2>&1 | powershell -Command "$input | Tee-Object -FilePath logs\siliu.log"
