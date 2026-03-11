@echo off
REM Siliu Browser - Log Viewer (Batch Wrapper)

where pwsh >nul 2>&1
if %errorlevel% equ 0 (
    pwsh -ExecutionPolicy Bypass -File "%~dp0view-logs.ps1" %*
) else (
    powershell -ExecutionPolicy Bypass -File "%~dp0view-logs.ps1" %*
)
