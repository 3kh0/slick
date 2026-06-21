#Requires -Version 5.1
[CmdletBinding()]
param(
  [switch]$Force,
  [switch]$RestoreHandler,
  [string]$Target = (Join-Path $env:LOCALAPPDATA 'Slick')
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Root = $PSScriptRoot

function Step($m) { Write-Host "==> " -ForegroundColor Magenta -NoNewline; Write-Host $m -ForegroundColor White }
function Die($m)  { Write-Host "error: " -ForegroundColor Red -NoNewline; Write-Host $m; exit 1 }

function Reg($key, $vals) {
  New-Item $key -Force | Out-Null
  foreach ($n in $vals.Keys) { Set-ItemProperty $key $n $vals[$n] }
}

$Protocol = 'slack'
$ProgId = 'Slick.slack'

function Register-SlackHandler($exe) {
  $cmd = "`"$exe`" `"%1`""
  Reg "HKCU:\Software\Classes\$ProgId"                    @{ '(default)' = 'Slick'; 'FriendlyTypeName' = 'Slick'; 'URL Protocol' = '' }
  Reg "HKCU:\Software\Classes\$ProgId\DefaultIcon"        @{ '(default)' = "$exe,0" }
  Reg "HKCU:\Software\Classes\$ProgId\shell\open\command" @{ '(default)' = $cmd }
  Reg "HKCU:\Software\Slick\Capabilities"                 @{ ApplicationName = 'Slick'; ApplicationDescription = 'Slack client mod (BYOE)' }
  Reg "HKCU:\Software\Slick\Capabilities\URLAssociations" @{ $Protocol = $ProgId }
  Reg "HKCU:\Software\RegisteredApplications"             @{ Slick = 'Software\Slick\Capabilities' }
  New-Item "HKCU:\Software\Classes\$Protocol\OpenWithProgids" -Force | Out-Null
  New-ItemProperty "HKCU:\Software\Classes\$Protocol\OpenWithProgids" -Name $ProgId -PropertyType None -Value ([byte[]]@()) -Force | Out-Null
  Reg "HKCU:\Software\Classes\$Protocol"                    @{ '(default)' = 'URL:Slack Protocol'; 'URL Protocol' = '' }
  Reg "HKCU:\Software\Classes\$Protocol\shell\open\command" @{ '(default)' = $cmd }
  & ie4uinit.exe -show 2>$null
}

function Unregister-SlackHandler {
  Remove-Item "HKCU:\Software\Classes\$ProgId", 'HKCU:\Software\Slick' -Recurse -Force -EA SilentlyContinue
  Remove-ItemProperty 'HKCU:\Software\RegisteredApplications' -Name Slick -EA SilentlyContinue
  Remove-ItemProperty "HKCU:\Software\Classes\$Protocol\OpenWithProgids" -Name $ProgId -EA SilentlyContinue
}

function Get-PEArch($exe) {
  try {
    $fs = [IO.File]::OpenRead($exe); $br = New-Object IO.BinaryReader($fs)
    $fs.Position = 0x3C; $fs.Position = $br.ReadInt32() + 4
    $m = $br.ReadUInt16(); $br.Close(); $fs.Close()
    switch ($m) { 0x8664 { 'x64' } 0xAA64 { 'arm64' } default { '' } }
  } catch { '' }
}

function Find-SlackResources {
  $base = Join-Path $env:LOCALAPPDATA 'slack'
  if (-not (Test-Path $base)) { return $null }
  Get-ChildItem $base -Directory -Filter 'app-*' -EA SilentlyContinue |
    Sort-Object { [version]($_.Name -replace '^app-', '') } -Descending |
    ForEach-Object { Join-Path $_.FullName 'resources' } |
    Where-Object { Test-Path (Join-Path $_ 'app.asar') } |
    Select-Object -First 1
}

function Slack-Exe($res) { Get-ChildItem (Split-Path $res) -Filter 'slack.exe' -EA SilentlyContinue | Select-Object -First 1 }

if ($RestoreHandler) {
  Unregister-SlackHandler
  $exe = Slack-Exe (Find-SlackResources)
  if ($exe) {
    Reg "HKCU:\Software\Classes\$Protocol\shell\open\command" @{ '(default)' = "`"$($exe.FullName)`" `"%1`"" }
    & ie4uinit.exe -show 2>$null
    Write-Host "Slick unregistered; slack:// now points at the official Slack."
  } else {
    Write-Host "Slick unregistered. Launch the official Slack once to reclaim slack://."
  }
  exit 0
}

Step "Checking prerequisites"
$slackRes = Find-SlackResources
if (-not $slackRes) { Die "Slack not found under %LOCALAPPDATA%\slack - install the standalone Slack from https://slack.com/download first!" }
Write-Host "    Slack resources: $slackRes"
if (-not (Get-Command node -EA SilentlyContinue)) { Die "Node.js is required (get it from nodejs.org)" }

$exe = Slack-Exe $slackRes
if ($exe -and (Get-PEArch $exe.FullName) -eq 'arm64') {
  Die "Slick doesn't support the ARM64 (aka Microsoft Store) Slack. Install the x64 Slack from https://slack.com/download instead (it runs okish on ARM via fancy emulation), then rerun. Otherwise Slick can't be used here."
}
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
  Write-Host "    note: x64 Slack on an ARM64 PC runs emulated (a drop in performance is expected)." -ForegroundColor Yellow
}

$eVer = ((Get-Content (Join-Path $Root 'byoe\package.json') -Raw | ConvertFrom-Json).dependencies.electron -replace '[^\d.]', '')
if (-not $eVer) { Die "could not get electron version from byoe/package.json" }
Write-Host "    BYOE Electron pin: $eVer (win32-x64)"

$dist = Join-Path $env:LOCALAPPDATA "slick-byoe\electron-$eVer-win32-x64"
if (Test-Path (Join-Path $dist 'electron.exe')) {
  Step "Found Electron $eVer in cache"
} else {
  Step "Downloading Electron $eVer (win32-x64, ~140MB)"
  $zip = Join-Path $env:TEMP "electron-$eVer-win32-x64.zip"
  Invoke-WebRequest "https://github.com/electron/electron/releases/download/v$eVer/electron-v$eVer-win32-x64.zip" -OutFile $zip -UseBasicParsing
  New-Item -ItemType Directory -Force $dist | Out-Null
  Expand-Archive $zip -DestinationPath $dist -Force
  Remove-Item $zip -EA SilentlyContinue
  if (-not (Test-Path (Join-Path $dist 'electron.exe'))) { Die "extraction failed" }
}

$build = 0
try {
  if ((Get-Command git -EA SilentlyContinue) -and (Test-Path (Join-Path $Root '.git'))) {
    $tag = git -C $Root tag --list 'v[0-9]*' --sort=-v:refname 2>$null | Where-Object { $_ -match '^v([1-9][0-9]*)$' } | Select-Object -First 1
    if ($tag -match '^v([1-9][0-9]*)$') { $build = [int]$Matches[1] }
  }
} catch {}

Get-Process Slick -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue
Start-Sleep -Milliseconds 400

Step "Building Slick (Build $build) at $Target"
$buildArgs = @(
  (Join-Path $Root 'scripts\byoe\build-handoff-app-win.js'),
  '--target', $Target, '--app-version', "1.0.$build", '--build-number', "$build", '--source-dist', $dist
)
if ($Force -or (Test-Path $Target)) { $buildArgs += '--force' }
$out = & node @buildArgs 2>&1
if ($LASTEXITCODE -ne 0) { Write-Host $out; Die "build failed" }
$exe = Join-Path $Target 'Slick.exe'

$icon = Join-Path $Root 'assets\icon.ico'
if (Test-Path $icon) {
  Step "Branding Slick.exe (icon + version info)"
  $rcedit = Join-Path $env:LOCALAPPDATA 'slick-byoe\rcedit-x64.exe'
  if (-not (Test-Path $rcedit)) {
    New-Item -ItemType Directory -Force (Split-Path $rcedit) | Out-Null
    Invoke-WebRequest 'https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe' -OutFile $rcedit -UseBasicParsing
  }
  & $rcedit $exe `
    --set-icon $icon `
    --set-version-string FileDescription 'Slick' `
    --set-version-string ProductName 'Slick' `
    --set-version-string InternalName 'Slick' `
    --set-version-string OriginalFilename 'Slick.exe' `
    --set-version-string CompanyName 'Slick' `
    --set-version-string LegalCopyright 'Slick (Slack client mod, BYOE)' `
    --set-file-version "1.0.$build.0" `
    --set-product-version "1.0.$build"
  if ($LASTEXITCODE -ne 0) { Write-Host "    warning: rcedit failed; keeping the default Electron icon." -ForegroundColor Yellow }
} else {
  Write-Host "    note: assets\icon.ico missing - skipping icon embed." -ForegroundColor Yellow
}

Step "Registering Slick as the slack:// handler"
Register-SlackHandler $exe

Step "Creating shortcuts"
$ws = New-Object -ComObject WScript.Shell
foreach ($lnk in @("$env:USERPROFILE\Desktop\Slick.lnk", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Slick.lnk")) {
  $sc = $ws.CreateShortcut($lnk)
  $sc.TargetPath = $exe; $sc.WorkingDirectory = $Target; $sc.Description = 'Slick (Slack mod)'
  $sc.Save()
}

Step "Launching Slick"
Start-Process $exe

Write-Host ""
Write-Host "Yippee! " -ForegroundColor Green -NoNewline
Write-Host "Slick is installed at $Target"
Write-Host "Things to know:"
Write-Host "- First launch shows a sign-in screen (separate profile from official Slack). Sign in once; it persists."
Write-Host "- Configure at Preferences -> Slick."
Write-Host "- Restore slack:// to official Slack:  powershell -File install.ps1 -RestoreHandler"
