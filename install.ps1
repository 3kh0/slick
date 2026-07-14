#Requires -Version 5.1
[CmdletBinding()]
param(
  [switch]$Force,
  [switch]$RestoreHandler,
  [switch]$Uninstall,
  [switch]$Purge,
  [string]$Target = (Join-Path $env:LOCALAPPDATA 'Slick')
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$Root = $PSScriptRoot
$Repo = '3kh0/slick'

function Step($m) { Write-Host "==> " -ForegroundColor Magenta -NoNewline; Write-Host $m -ForegroundColor White }
function Die($m)  { Write-Host "error: " -ForegroundColor Red -NoNewline; Write-Host $m; exit 1 }

function Assert-ReleaseAttestation([string]$Path) {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "    (gh CLI not found; skipping provenance check — https://cli.github.com)" -ForegroundColor DarkGray
    return
  }
  Step "Verifying build provenance"
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = & gh attestation verify $Path -R $Repo 2>&1 | Out-String
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
  if ($code -eq 0) {
    Write-Host "    attestation OK (signed by $Repo)"
    return
  }
  Write-Host ""
  Write-Host "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!" -ForegroundColor Red
  Write-Host "  BUILD PROVENANCE VERIFICATION FAILED" -ForegroundColor Red
  Write-Host "  This download may have been tampered with." -ForegroundColor Red
  Write-Host "  Refusing to install." -ForegroundColor Red
  Write-Host "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!" -ForegroundColor Red
  if ($out) { Write-Host $out }
  Die "refusing to install an unattested or mismatched build"
}

function Get-File($url, $dest, $label) {
  $ProgressPreference = 'Continue'
  $resp = $null; $stream = $null; $out = $null
  try {
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.UserAgent = 'slick-install'
    $req.AllowAutoRedirect = $true
    $resp = $req.GetResponse()
    $total = $resp.ContentLength
    $stream = $resp.GetResponseStream()
    $out = [System.IO.File]::Create($dest)
    $buffer = New-Object byte[] 1048576
    $read = 0L
    while (($n = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $out.Write($buffer, 0, $n)
      $read += $n
      if ($total -gt 0) {
        Write-Progress -Activity $label `
          -Status ('{0:N1} / {1:N1} MB' -f ($read / 1MB), ($total / 1MB)) `
          -PercentComplete ([int](($read / $total) * 100))
      } else {
        Write-Progress -Activity $label -Status ('{0:N1} MB' -f ($read / 1MB))
      }
    }
  } finally {
    Write-Progress -Activity $label -Completed
    if ($out) { $out.Close() }
    if ($stream) { $stream.Close() }
    if ($resp) { $resp.Close() }
  }
}

function Reg($key, $vals) {
  New-Item $key -Force | Out-Null
  foreach ($n in $vals.Keys) { Set-ItemProperty $key $n $vals[$n] }
}

$Protocol = 'slack'
$ProgId = 'Slick.slack'
$Shortcuts = @("$env:USERPROFILE\Desktop\Slick.lnk", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Slick.lnk")

function Register-SlackHandler($exe, $iconFile) {
  $cmd = "`"$exe`" `"%1`""
  $iconRes = if ($iconFile -and (Test-Path $iconFile)) { $iconFile } else { "$exe,0" }
  Reg "HKCU:\Software\Classes\$ProgId"                    @{ '(default)' = 'Slick'; 'FriendlyTypeName' = 'Slick'; 'URL Protocol' = '' }
  Reg "HKCU:\Software\Classes\$ProgId\DefaultIcon"        @{ '(default)' = $iconRes }
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

function Find-SlackStandalone {
  $base = Join-Path $env:LOCALAPPDATA 'slack'
  if (-not (Test-Path $base)) { return $null }
  Get-ChildItem $base -Directory -Filter 'app-*' -EA SilentlyContinue |
    Sort-Object { [version]($_.Name -replace '^app-', '') } -Descending |
    ForEach-Object { Join-Path $_.FullName 'resources' } |
    Where-Object { Test-Path (Join-Path $_ 'app.asar') } |
    Select-Object -First 1
}

function Find-SlackMsix {
  $base = 'HKLM:\SOFTWARE\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\PackageRepository\Packages'
  try {
    $pkgs = Get-ChildItem $base -EA Stop | Where-Object { $_.PSChildName -match '^com\.tinyspeck\.slackdesktop_' }
    $pkgs = $pkgs | Sort-Object { try { [version](($_.PSChildName -split '_')[1]) } catch { [version]'0.0.0' } } -Descending
    foreach ($pkg in $pkgs) {
      try {
        $installPath = (Get-ItemProperty $pkg.PSPath -Name Path -EA Stop).Path
        $res = Join-Path $installPath 'app\resources'
        if (Test-Path (Join-Path $res 'app.asar')) { return $res }
      } catch {}
    }
  } catch {}
  return $null
}

function Find-SlackResources {
  $standalone = Find-SlackStandalone
  $msix = Find-SlackMsix
  $cands = @($standalone, $msix) | Where-Object { $_ }
  if (-not $cands) { return $null }
  $want = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  foreach ($res in $cands) {
    $exe = Get-ChildItem (Split-Path $res) -Filter 'slack.exe' -EA SilentlyContinue | Select-Object -First 1
    if ($exe -and (Get-PEArch $exe.FullName) -eq $want) { return $res }
  }
  return $cands | Select-Object -First 1
}

function Slack-Exe($res) { if ($res) { Get-ChildItem (Split-Path $res) -Filter 'slack.exe' -EA SilentlyContinue | Select-Object -First 1 } }

function New-Shortcuts($exe, $iconFile) {
  $ws = New-Object -ComObject WScript.Shell
  foreach ($lnk in $Shortcuts) {
    $sc = $ws.CreateShortcut($lnk)
    $sc.TargetPath = $exe; $sc.WorkingDirectory = (Split-Path $exe); $sc.Description = 'Slick (Slack mod)'
    if ($iconFile -and (Test-Path $iconFile)) { $sc.IconLocation = "$iconFile,0" }
    $sc.Save()
  }
}

function Stop-Slick {
  Get-Process Slick -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue
  Start-Sleep -Milliseconds 400
}

function Restore-OfficialHandler {
  $exe = Slack-Exe (Find-SlackResources)
  if ($exe) {
    Reg "HKCU:\Software\Classes\$Protocol\shell\open\command" @{ '(default)' = "`"$($exe.FullName)`" `"%1`"" }
    & ie4uinit.exe -show 2>$null
    return $true
  }
  return $false
}

if ($RestoreHandler) {
  Unregister-SlackHandler
  if (Restore-OfficialHandler) { Write-Host "Slick unregistered; slack:// now points at the official Slack." }
  else { Write-Host "Slick unregistered. Launch the official Slack once to reclaim slack://." }
  exit 0
}

if ($Uninstall) {
  Step "Uninstalling Slick"
  Stop-Slick
  Unregister-SlackHandler
  Restore-OfficialHandler | Out-Null
  $Shortcuts | ForEach-Object { Remove-Item $_ -Force -EA SilentlyContinue }
  Remove-Item $Target -Recurse -Force -EA SilentlyContinue
  Write-Host "    removed $Target, shortcuts, and the slack:// handler"
  if ($Purge) {
    $profileDir = Join-Path $env:APPDATA 'Slick'
    Remove-Item $profileDir, (Join-Path $env:LOCALAPPDATA 'slick-byoe') -Recurse -Force -EA SilentlyContinue
    Write-Host "    purged profile ($profileDir) and the Electron/rcedit cache"
  }
  Write-Host ""
  Write-Host "Slick uninstalled." -ForegroundColor Green
  if (-not $Purge) { Write-Host "Your sign-in/settings are kept at $env:APPDATA\Slick (rerun with -Purge to remove them too)." }
  exit 0
}

Step "Checking prerequisites"
$slackRes = Find-SlackResources
if (-not $slackRes) { Die "Slack not found. Install Slack Desktop from https://slack.com/download or the Microsoft Store, then rerun." }
Write-Host "    Slack resources: $slackRes"

$slackExe  = Slack-Exe $slackRes
$slackArch = if ($slackExe) { Get-PEArch $slackExe.FullName } else {
  if ($slackRes -match '\\WindowsApps\\[^\\]+_arm64_') { 'arm64' }
  elseif ($slackRes -match '\\WindowsApps\\[^\\]+_x64_') { 'x64' }
  else { 'x64' }
}
if ($slackArch -eq 'arm64') {
  Write-Host "    Microsoft Store (MSIX) ARM64 Slack detected." -ForegroundColor Cyan
} elseif ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
  Write-Host "    note: x64 Slack on an ARM64 PC runs emulated (a drop in performance is expected)." -ForegroundColor Yellow
}

Stop-Slick
if (Test-Path $Target) {
  if ($Force) { Write-Host "    replacing existing install at $Target" }
  else { Write-Host "    existing install found at $Target; updating it" }
  Remove-Item $Target -Recurse -Force
}

$FromSource = [bool]$Root -and (Test-Path (Join-Path $Root 'scripts\byoe\build-handoff-app-win.js'))

if ($FromSource) {
  if (-not (Get-Command node -EA SilentlyContinue)) { Die "Node.js is required to build from source (get it from nodejs.org)" }

  $eVer = ((Get-Content (Join-Path $Root 'byoe\package.json') -Raw | ConvertFrom-Json).dependencies.electron -replace '[^\d.]', '')
  if (-not $eVer) { Die "could not get electron version from byoe/package.json" }
  $electronArch = $slackArch
  Write-Host "    BYOE Electron pin: $eVer (win32-$electronArch)"

  $dist = Join-Path $env:LOCALAPPDATA "slick-byoe\electron-$eVer-win32-$electronArch"
  if (Test-Path (Join-Path $dist 'electron.exe')) {
    Step "Found Electron $eVer in cache"
  } else {
    Step "Downloading Electron $eVer (win32-$electronArch, ~140MB)"
    $zip = Join-Path $env:TEMP "electron-$eVer-win32-$electronArch.zip"
    Get-File "https://github.com/electron/electron/releases/download/v$eVer/electron-v$eVer-win32-$electronArch.zip" $zip "Downloading Electron $eVer (win32-$electronArch)"
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

  Step "Building Slick (Build $build) at $Target"
  $out = & node (Join-Path $Root 'scripts\byoe\build-handoff-app-win.js') `
    --target $Target --app-version "1.0.$build" --build-number "$build" --source-dist $dist --force 2>&1
  if ($LASTEXITCODE -ne 0) { Write-Host $out; Die "build failed" }

  $icon = Join-Path $Root 'assets\icon.ico'
  if (Test-Path $icon) {
    Step "Branding Slick.exe (icon + version info)"
    $rcedit = Join-Path $env:LOCALAPPDATA 'slick-byoe\rcedit-x64.exe'
    if (-not (Test-Path $rcedit)) {
      New-Item -ItemType Directory -Force (Split-Path $rcedit) | Out-Null
      Get-File 'https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe' $rcedit 'Downloading rcedit'
    }
    & $rcedit (Join-Path $Target 'Slick.exe') `
      --set-icon $icon `
      --set-version-string FileDescription 'Slick' `
      --set-version-string ProductName 'Slick' `
      --set-version-string InternalName 'Slick' `
      --set-version-string OriginalFilename 'Slick.exe' `
      --set-version-string CompanyName 'Slick' `
      --set-version-string LegalCopyright 'Slick (Slack client mod) by @3kh0' `
      --set-file-version "1.0.$build.0" `
      --set-product-version "1.0.$build"
    if ($LASTEXITCODE -ne 0) { Write-Host "    warning: rcedit failed; keeping the default Electron icon." -ForegroundColor Yellow }
  } else {
    Write-Host "    note: assets\icon.ico missing - skipping icon embed." -ForegroundColor Yellow
  }
} else {
  Step "Finding the latest Slick release"
  $asset = $null; $tag = $null
  $releaseArch = $slackArch
  
  try {
    $rel = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ 'User-Agent' = 'slick-install' }
    $tag = $rel.tag_name
    $asset = $rel.assets |
      Where-Object { $_.name -match "win32-$releaseArch\.zip$" } |
      Select-Object -First 1
  } catch {
    Die "could not reach GitHub to find a release ($($_.Exception.Message))"
  }
  
  if (-not $asset) {
    Die "the latest release ($tag) has no Windows (win32-$releaseArch) build yet. Clone the repo and run install.ps1 to build from source: git clone https://github.com/$Repo"
  }
  
  Step "Downloading Slick $tag (win32-$releaseArch)"
  $zip = Join-Path $env:TEMP "slick-$tag-win32-$releaseArch.zip"
  Get-File $asset.browser_download_url $zip "Downloading Slick $tag (win32-$releaseArch)"
  Assert-ReleaseAttestation $zip
  $stage = Join-Path $env:TEMP ("slick-stage-" + [Guid]::NewGuid().ToString('N'))
  Expand-Archive $zip -DestinationPath $stage -Force
  Remove-Item $zip -EA SilentlyContinue
  $exeItem = Get-ChildItem $stage -Recurse -Filter 'Slick.exe' -EA SilentlyContinue | Select-Object -First 1
  if (-not $exeItem) { Die "release zip did not contain Slick.exe" }
  New-Item -ItemType Directory -Force (Split-Path $Target) | Out-Null
  Move-Item $exeItem.Directory.FullName $Target
  Remove-Item $stage -Recurse -Force -EA SilentlyContinue
}

$exe = Join-Path $Target 'Slick.exe'
if (-not (Test-Path $exe)) { Die "install incomplete: $exe is missing" }

$iconFile = if ($FromSource) { Join-Path $Root 'assets\icon.ico' } else { $null }

$muiCache = 'HKCU:\Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache'
Remove-ItemProperty $muiCache -Name "$exe.FriendlyAppName" -EA SilentlyContinue
Remove-ItemProperty $muiCache -Name "$exe.ApplicationCompany" -EA SilentlyContinue

Step "Registering Slick as the slack:// handler"
Register-SlackHandler $exe $iconFile

Step "Creating shortcuts"
New-Shortcuts $exe $iconFile

Step "Launching Slick"
Start-Process $exe

Write-Host ""
Write-Host "Yippee! " -ForegroundColor Green -NoNewline
Write-Host "Slick is installed at $Target"
Write-Host "Things to know:"
Write-Host "- First launch shows a sign-in screen (separate profile from official Slack). Sign in once; it persists."
Write-Host "- Configure at Preferences -> Slick."
Write-Host "- Uninstall:  powershell -File install.ps1 -Uninstall   (add -Purge to also wipe your profile)"
Write-Host "- Restore slack:// to official Slack:  powershell -File install.ps1 -RestoreHandler"
