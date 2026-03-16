@echo off
REM Siliu Browser Launcher - Windows

cd /d "%~dp0"
if not exist logs mkdir logs

echo Stopping any existing Siliu processes...
taskkill /F /IM electron.exe 2>nul

ping -n 2 127.0.0.1 >nul

echo Starting Siliu Browser...
chcp 65001 >nul
.\node_modules\.bin\electron . --no-sandbox 2>&1 | powershell -Command "$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $input | Tee-Object -FilePath logs\siliu.log"
