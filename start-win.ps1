#!/usr/bin/env pwsh
# Siliu Browser - Windows Startup Script
# This script starts the Siliu Browser and redirects logs to the logs folder

param(
    [switch]$Dev,
    [switch]$Debug,
    [string]$LogLevel = "info"
)

$ErrorActionPreference = "Stop"

# Configuration
$ProjectName = "Siliu Browser"
$LogDir = Join-Path $PSScriptRoot "logs"
$Timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$LogFile = Join-Path $LogDir "siliu_$Timestamp.log"

# Create logs directory if not exists
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    Write-Host "[INFO] Created logs directory: $LogDir" -ForegroundColor Green
}

# Function to write log with timestamp
function Write-Log {
    param(
        [string]$Message,
        [string]$Level = "INFO"
    )
    $Time = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $LogEntry = "[$Time] [$Level] $Message"
    
    # Output to console with color
    switch ($Level) {
        "INFO" { Write-Host $LogEntry -ForegroundColor Cyan }
        "WARN" { Write-Host $LogEntry -ForegroundColor Yellow }
        "ERROR" { Write-Host $LogEntry -ForegroundColor Red }
        "SUCCESS" { Write-Host $LogEntry -ForegroundColor Green }
        default { Write-Host $LogEntry }
    }
    
    # Append to log file
    Add-Content -Path $LogFile -Value $LogEntry
}

# Print startup banner
Write-Log "========================================" "INFO"
Write-Log "  $ProjectName v2.0.0" "INFO"
Write-Log "  Windows Launcher" "INFO"
Write-Log "========================================" "INFO"
Write-Log "Log file: $LogFile" "INFO"
Write-Log "Working directory: $PSScriptRoot" "INFO"

# Check if Node.js is installed
Write-Log "Checking Node.js installation..." "INFO"
try {
    $NodeVersion = node --version 2>&1
    $NpmVersion = npm --version 2>&1
    Write-Log "Node.js version: $NodeVersion" "SUCCESS"
    Write-Log "npm version: $NpmVersion" "SUCCESS"
} catch {
    Write-Log "Node.js is not installed or not in PATH" "ERROR"
    Write-Log "Please install Node.js from https://nodejs.org/" "ERROR"
    exit 1
}

# Check if node_modules exists
$NodeModulesPath = Join-Path $PSScriptRoot "node_modules"
if (-not (Test-Path $NodeModulesPath)) {
    Write-Log "node_modules not found, running npm install..." "WARN"
    try {
        npm install 2>&1 | ForEach-Object { Write-Log $_ "INFO" }
        Write-Log "Dependencies installed successfully" "SUCCESS"
    } catch {
        Write-Log "Failed to install dependencies: $_" "ERROR"
        exit 1
    }
} else {
    Write-Log "Dependencies already installed" "INFO"
}

# Determine start command
$StartCommand = "start"
if ($Dev) {
    $StartCommand = "dev"
    Write-Log "Starting in DEVELOPMENT mode" "INFO"
} else {
    Write-Log "Starting in PRODUCTION mode" "INFO"
}

if ($Debug) {
    $env:DEBUG = "*"
    Write-Log "Debug mode enabled" "INFO"
}

# Set environment variables
$env:SILIU_LOG_LEVEL = $LogLevel
$env:SILIU_LOG_FILE = $LogFile

Write-Log "Starting $ProjectName..." "INFO"
Write-Log "Command: npm run $StartCommand" "INFO"
Write-Log "Press Ctrl+C to stop the application" "WARN"
Write-Log "----------------------------------------" "INFO"

# Start the application and redirect output
try {
    npm run $StartCommand 2>&1 | ForEach-Object {
        $Line = $_
        Write-Log $Line "INFO"
    }
} catch {
    Write-Log "Application exited with error: $_" "ERROR"
} finally {
    Write-Log "----------------------------------------" "INFO"
    Write-Log "Application stopped" "INFO"
    Write-Log "Log saved to: $LogFile" "SUCCESS"
}
