@echo off
REM Siliu Browser Launcher (Dev Mode) - Windows

cd /d "%~dp0"
if not exist logs mkdir logs

echo Starting Siliu Browser (Dev Mode)...
powershell -Command "npm run dev 2>&1 | Tee-Object -FilePath logs\siliu.log"
