@echo off
REM Siliu Browser Launcher - Windows

cd /d "%~dp0"
if not exist logs mkdir logs

echo Starting Siliu Browser...
powershell -Command "npm start 2>&1 | Tee-Object -FilePath logs\siliu.log"
