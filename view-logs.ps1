#!/usr/bin/env pwsh
# Siliu Browser - Log Viewer Script
# View and filter application logs

param(
    [int]$Tail = 50,
    [string]$Filter = "",
    [switch]$Follow,
    [string]$Date = ""
)

$LogDir = Join-Path $PSScriptRoot "logs"

if (-not (Test-Path $LogDir)) {
    Write-Host "[ERROR] Logs directory not found: $LogDir" -ForegroundColor Red
    exit 1
}

# Get log files
$LogFiles = Get-ChildItem -Path $LogDir -Filter "siliu_*.log" | Sort-Object LastWriteTime -Descending

if ($LogFiles.Count -eq 0) {
    Write-Host "[INFO] No log files found in $LogDir" -ForegroundColor Yellow
    exit 0
}

# Filter by date if specified
if ($Date) {
    $LogFiles = $LogFiles | Where-Object { $_.Name -like "*_$Date*.log" }
    if ($LogFiles.Count -eq 0) {
        Write-Host "[ERROR] No logs found for date: $Date" -ForegroundColor Red
        exit 1
    }
}

# Display available logs if no filter and multiple files
if (-not $Filter -and $LogFiles.Count -gt 1 -and -not $Follow) {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Available Log Files" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    
    for ($i = 0; $i -lt [Math]::Min(10, $LogFiles.Count); $i++) {
        $file = $LogFiles[$i]
        $size = "{0:N2} KB" -f ($file.Length / 1KB)
        Write-Host "  $($i + 1). $($file.Name) ($size)" -ForegroundColor White
    }
    
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Use -Follow to tail the latest log" -ForegroundColor Gray
    Write-Host "Use -Date YYYY-MM-DD to filter by date" -ForegroundColor Gray
    Write-Host ""
}

# Select the most recent log file
$LatestLog = $LogFiles[0]
Write-Host "[INFO] Viewing: $($LatestLog.Name)" -ForegroundColor Green

# Read and display log
if ($Follow) {
    # Tail -f style following
    Get-Content -Path $LatestLog.FullName -Tail $Tail -Wait | ForEach-Object {
        $Line = $_
        if (-not $Filter -or $Line -match $Filter) {
            # Colorize based on log level
            if ($Line -match "\[ERROR\]") {
                Write-Host $Line -ForegroundColor Red
            } elseif ($Line -match "\[WARN\]") {
                Write-Host $Line -ForegroundColor Yellow
            } elseif ($Line -match "\[SUCCESS\]") {
                Write-Host $Line -ForegroundColor Green
            } else {
                Write-Host $Line
            }
        }
    }
} else {
    # Static display
    $Content = Get-Content -Path $LatestLog.FullName -Tail $Tail
    
    foreach ($Line in $Content) {
        if (-not $Filter -or $Line -match $Filter) {
            if ($Line -match "\[ERROR\]") {
                Write-Host $Line -ForegroundColor Red
            } elseif ($Line -match "\[WARN\]") {
                Write-Host $Line -ForegroundColor Yellow
            } elseif ($Line -match "\[SUCCESS\]") {
                Write-Host $Line -ForegroundColor Green
            } else {
                Write-Host $Line
            }
        }
    }
}
