<#
.SYNOPSIS
    Updates the SKRC Competition Day console on this machine.

.DESCRIPTION
    Replaces the installed folder with the current build. Extracting over a
    running copy silently does nothing — Windows skips locked files, and
    resources\app.asar is locked while the app runs — which looks exactly like
    an update that worked, so this stops every copy first and replaces the
    folder outright.

    Configuration and data are untouched: competition-day.env, the overlay text
    files and the logs all live in %APPDATA%\SKRC Competition Day, and the
    competition itself lives in DynamoDB. Only the program is replaced.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\update-desktop.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\update-desktop.ps1 -NoLaunch
#>
[CmdletBinding()]
param(
    [string]$ZipPath = '\\wsl.localhost\Ubuntu\home\thanakornbua\skrc-builds\SKRC-Competition-Day-win32-x64.zip',
    [string]$InstallDir = (Join-Path $env:USERPROFILE 'Desktop\SKRC-Competition-Day-win32-x64'),
    [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'
$exe = Join-Path $InstallDir 'SKRC-Competition-Day.exe'

if (-not (Test-Path $ZipPath)) {
    throw "Build not found at $ZipPath. Run scripts/package-desktop.sh in WSL first."
}

# A config file beside the EXE outranks the one in %APPDATA% and is about to be
# deleted with the folder. Say so rather than quietly losing it.
$portableConfig = Join-Path $InstallDir 'competition-day.env'
if (Test-Path $portableConfig) {
    $rescue = Join-Path $env:APPDATA 'SKRC Competition Day\competition-day.env.rescued'
    New-Item -ItemType Directory -Force -Path (Split-Path $rescue) | Out-Null
    Copy-Item $portableConfig $rescue -Force
    Write-Warning "Config found beside the EXE; copied to $rescue before replacing the folder."
}

$running = @(Get-Process SKRC-Competition-Day -ErrorAction SilentlyContinue)
if ($running) {
    Write-Host "Stopping $($running.Count) running process(es) ..."
    $running | Stop-Process -Force
    # The COM port and the asar stay locked for a moment after the process goes.
    Start-Sleep -Seconds 2
}

if (Test-Path $InstallDir) {
    Write-Host "Removing $InstallDir ..."
    Remove-Item -Recurse -Force $InstallDir
}

Write-Host "Extracting $ZipPath ..."
Expand-Archive -Path $ZipPath -DestinationPath $InstallDir -Force
if (-not (Test-Path $exe)) { throw "Extract finished but $exe is missing — the zip layout is not what was expected." }

$build = Join-Path (Split-Path $ZipPath) 'BUILD.txt'
if (Test-Path $build) { Get-Content $build | ForEach-Object { Write-Host "  $_" } }

if ($NoLaunch) { Write-Host 'Done (not launched).'; return }

Write-Host 'Starting ...'
Start-Process $exe

# The port opening is the first honest sign it came up; a window can appear
# before the API is listening, and a startup failure shows a dialog instead.
$deadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $deadline) {
    if (Test-NetConnection -ComputerName 127.0.0.1 -Port 7070 -InformationLevel Quiet -WarningAction SilentlyContinue) {
        Write-Host 'Up: http://127.0.0.1:7070 is listening.'
        Write-Host 'Overlay: http://127.0.0.1:7070/overlay'
        return
    }
    Start-Sleep -Seconds 2
}

Write-Warning 'Port 7070 never opened. Check the startup dialog, then:'
Write-Warning '  Get-Content "$env:APPDATA\SKRC Competition Day\console.log" -Tail 40'
