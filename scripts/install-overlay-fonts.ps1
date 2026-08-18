<#
.SYNOPSIS
    Installs IBM Plex Sans and IBM Plex Sans Thai for the broadcast overlay.

.DESCRIPTION
    The overlay asks for these families by name; a browser can only use a font
    that is installed on the machine drawing it, so this has to run on whichever
    machine runs OBS.

    Both families are needed, not one: IBM Plex Sans carries no Thai glyphs, so
    a Thai team name would fall through to whatever Windows chose next — a
    different face at a different weight, mid-scene.

    Installs per user, into %LOCALAPPDATA%\Microsoft\Windows\Fonts, so it needs
    no administrator rights. Re-running is safe: existing files are replaced and
    registry entries overwritten.

    IBM Plex is licensed under the SIL Open Font License 1.1; the licence file
    ships inside each archive and is kept alongside the fonts.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\install-overlay-fonts.ps1
#>
[CmdletBinding()]
param(
    # Pinned so every machine at the event renders identically.
    [string]$SansUrl = 'https://github.com/IBM/plex/releases/download/%40ibm/plex-sans%401.1.0/ibm-plex-sans.zip',
    [string]$ThaiUrl = 'https://github.com/IBM/plex/releases/download/%40ibm/plex-sans-thai%401.1.0/ibm-plex-sans-thai.zip'
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$fontDir = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts'
$regPath = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts'
New-Item -ItemType Directory -Force -Path $fontDir | Out-Null
New-Item -Path $regPath -Force | Out-Null

$work = Join-Path $env:TEMP ("skrc-fonts-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work | Out-Null

function Install-PlexFamily {
    param([string]$Url, [string]$Name)

    Write-Host "Downloading $Name ..."
    $zip = Join-Path $work "$Name.zip"
    Invoke-WebRequest -Uri $Url -OutFile $zip -UseBasicParsing

    $extract = Join-Path $work $Name
    Expand-Archive -Path $zip -DestinationPath $extract -Force

    # Only the complete TTFs: the archives also carry split web fonts, which
    # Windows cannot install and the overlay does not use.
    $fonts = Get-ChildItem -Path $extract -Recurse -Filter '*.ttf' |
        Where-Object { $_.FullName -match '\\complete\\ttf\\' }
    if (-not $fonts) { throw "$Name archive contained no complete TTFs — the release layout may have changed." }

    foreach ($font in $fonts) {
        $target = Join-Path $fontDir $font.Name
        Copy-Item -Path $font.FullName -Destination $target -Force

        # Windows finds a per-user font through this registry value; the name is
        # what shows in a font picker, so keep the conventional " (TrueType)".
        $face = [IO.Path]::GetFileNameWithoutExtension($font.Name) -replace '-', ' '
        New-ItemProperty -Path $regPath -Name "$face (TrueType)" -Value $target -PropertyType String -Force | Out-Null
    }

    $license = Get-ChildItem -Path $extract -Recurse -Filter 'LICENSE.txt' | Select-Object -First 1
    if ($license) { Copy-Item $license.FullName (Join-Path $fontDir "$Name-LICENSE.txt") -Force }

    Write-Host "  installed $($fonts.Count) faces"
}

try {
    Install-PlexFamily -Url $SansUrl -Name 'ibm-plex-sans'
    Install-PlexFamily -Url $ThaiUrl -Name 'ibm-plex-sans-thai'
} finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'Done. Restart OBS so it picks up the new fonts.'
Write-Host 'Verify with:  [Drawing.FontFamily]::Families | Where-Object Name -like "IBM Plex*"'
