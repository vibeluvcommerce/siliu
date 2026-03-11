@echo off
REM Siliu Browser - Windows Startup Script (Batch Wrapper)
REM This script launches the PowerShell launcher

title Siliu Browser Launcher

REM Check if PowerShell is available
where pwsh >nul 2>&1
if %errorlevel% equ 0 (
    set POWERSHELL=pwsh
) else (
    where powershell >nul 2>&1
    if %errorlevel% equ 0 (
        set POWERSHELL=powershell
    ) else (
        echo [ERROR] PowerShell is not installed
        pause
        exit /b 1
    )
)

REM Launch the PowerShell script with passed arguments
%POWERSHELL% -ExecutionPolicy Bypass -File "%~dp0start-win.ps1" %*

REM Pause if there was an error
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Application exited with code %errorlevel%
    pause
)
