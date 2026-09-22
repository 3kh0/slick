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
    Write-Host "    (gh CLI not found; skipping provenance check - https://cli.github.com)" -ForegroundColor DarkGray
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

# Windows PowerShell 5.1 turns every stderr line of a native command into an
# ErrorRecord once it is redirected, and under $ErrorActionPreference = 'Stop'
# the first one is fatal -- so a Node warning aborted the build. Run the tool
# with errors non-terminating and judge it by its exit code alone; its output
# goes to a log that is shown only when it fails.
function Invoke-Logged([string]$Log, [scriptblock]$Command) {
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $Command *> $Log
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevEap
  }
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

function Get-ShellFolder($name, $fallback) {
  try {
    $p = [Environment]::GetFolderPath($name)
    if ($p) { return $p }
  } catch {}
  $fallback
}
$DesktopDir  = Get-ShellFolder 'DesktopDirectory' (Join-Path $env:USERPROFILE 'Desktop')
$ProgramsDir = Get-ShellFolder 'Programs' (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')
$Shortcuts = @((Join-Path $DesktopDir 'Slick.lnk'), (Join-Path $ProgramsDir 'Slick.lnk'))
$LegacyShortcuts = @("$env:USERPROFILE\Desktop\Slick.lnk", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Slick.lnk")

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
    try {
      New-Item -ItemType Directory -Force (Split-Path $lnk) | Out-Null
      $sc = $ws.CreateShortcut($lnk)
      $sc.TargetPath = $exe; $sc.WorkingDirectory = (Split-Path $exe); $sc.Description = 'Slick (Slack mod)'
      if ($iconFile -and (Test-Path $iconFile)) { $sc.IconLocation = "$iconFile,0" }
      $sc.Save()
      Write-Host "    $lnk"
    } catch {
      Write-Host "    warning: could not create $lnk ($($_.Exception.Message))" -ForegroundColor Yellow
    }
  }
}

function Stop-Slick([string]$InstalledAt) {
  $expected = [IO.Path]::GetFullPath((Join-Path $InstalledAt 'Slick.exe'))
  Get-Process Slick -EA SilentlyContinue | Where-Object {
    try { $_.Path -and ([IO.Path]::GetFullPath($_.Path) -eq $expected) } catch { $false }
  } | Stop-Process -Force -EA SilentlyContinue
  Start-Sleep -Milliseconds 400
}

function Restore-OfficialHandler {
  $res = Find-SlackResources
  # The Store build registers slack:// through its package, under a path that
  # changes with every Store update. Pointing the key at today's Slack.exe
  # would break on the next one; deleting our override lets the package's own
  # registration answer again.
  if ($res -match '\\WindowsApps\\') {
    Remove-Item "HKCU:\Software\Classes\$Protocol" -Recurse -Force -EA SilentlyContinue
    & ie4uinit.exe -show 2>$null
    return $true
  }
  $exe = Slack-Exe $res
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
  Stop-Slick $Target
  Unregister-SlackHandler
  Restore-OfficialHandler | Out-Null
  $Shortcuts + $LegacyShortcuts | Select-Object -Unique | ForEach-Object { Remove-Item $_ -Force -EA SilentlyContinue }
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

$InstallTarget = $Target
# From a checkout, build; piped through `irm | iex`, download the latest release.
$FromSource = [bool]$Root -and (Test-Path (Join-Path $Root 'src\desktop\main.ts'))

if ($FromSource) {
  if (-not (Get-Command node -EA SilentlyContinue)) { Die "Node.js 22+ is required to build Slick v2 (get it from nodejs.org)" }

  $unpacked = if ($slackArch -eq 'arm64') { 'win-arm64-unpacked' } else { 'win-unpacked' }

  if (-not (Test-Path (Join-Path $Root 'node_modules\electron-builder'))) {
    Step "Installing build dependencies"
    Push-Location $Root
    try {
      if (Get-Command bun -EA SilentlyContinue) { & bun install --frozen-lockfile }
      else { & npm install --no-audit --no-fund }
      if ($LASTEXITCODE -ne 0) { Die "dependency install failed" }
    } finally { Pop-Location }
  }

  Step "Building Slick v2 (this bundles Electron; give it a minute)"
  Push-Location $Root
  try {
    $log = Join-Path $env:TEMP 'slick-build.log'
    $code = Invoke-Logged $log { node (Join-Path $Root 'scripts\build.ts') package --arch $slackArch }
    if ($code -ne 0) {
      Get-Content $log -Tail 30 -EA SilentlyContinue | Write-Host
      Die "build failed (full log: $log)"
    }
  } finally { Pop-Location }

  $built = Join-Path $Root "dist\release\$unpacked"
  if (-not (Test-Path (Join-Path $built 'Slick.exe'))) { Die "electron-builder produced no Slick.exe at $built" }

  # Copied rather than moved, so a failed install does not destroy the build.
  $Target = Join-Path (Split-Path $InstallTarget) ('slick-stage-' + [Guid]::NewGuid().ToString('N'))
  Copy-Item $built $Target -Recurse -Force

  # electron-builder already embeds the icon and version info, so the rcedit
  # branding step the v1 path needs does not apply here.
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
  $stage = Join-Path (Split-Path $InstallTarget) ("slick-stage-" + [Guid]::NewGuid().ToString('N'))
  Expand-Archive $zip -DestinationPath $stage -Force
  Remove-Item $zip -EA SilentlyContinue
  $exeItem = Get-ChildItem $stage -Recurse -Filter 'Slick.exe' -EA SilentlyContinue | Select-Object -First 1
  if (-not $exeItem) { Die "release zip did not contain Slick.exe" }
  $Target = $exeItem.Directory.FullName
}

$exe = Join-Path $Target 'Slick.exe'
if (-not (Test-Path $exe)) { Die "install incomplete: $exe is missing" }

Stop-Slick $InstallTarget
$backup = $InstallTarget + '.previous-' + [Guid]::NewGuid().ToString('N')
$hadInstall = Test-Path $InstallTarget
if ($hadInstall) { Move-Item $InstallTarget $backup }
try {
  New-Item -ItemType Directory -Force (Split-Path $InstallTarget) | Out-Null
  Move-Item $Target $InstallTarget
} catch {
  if ($hadInstall) { Move-Item $backup $InstallTarget }
  throw
}
if ($hadInstall) { Remove-Item $backup -Recurse -Force }
if (-not $FromSource) { Remove-Item $stage -Recurse -Force -EA SilentlyContinue }
$Target = $InstallTarget
$exe = Join-Path $Target 'Slick.exe'

$iconFile = if ($FromSource) { Join-Path $Root 'assets\icon.ico' } else { $null }

$muiCache = 'HKCU:\Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache'
Remove-ItemProperty $muiCache -Name "$exe.FriendlyAppName" -EA SilentlyContinue
Remove-ItemProperty $muiCache -Name "$exe.ApplicationCompany" -EA SilentlyContinue

Step "Registering Slick as the slack:// handler"
Register-SlackHandler $exe $iconFile

Step "Creating shortcuts"
New-Shortcuts $exe $iconFile

Step "Launching Slick"
$prevNoAttach = $env:ELECTRON_NO_ATTACH_CONSOLE
$env:ELECTRON_NO_ATTACH_CONSOLE = '1'
# Lets the boot timeline price launch -> electron start. Shortcuts cannot carry
# env vars, so normal launches fall back to the wrapper-entry mark instead.
$prevLaunchT0 = $env:SLICK_LAUNCH_T0
$env:SLICK_LAUNCH_T0 = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()
Start-Process $exe
$env:SLICK_LAUNCH_T0 = $prevLaunchT0
$env:ELECTRON_NO_ATTACH_CONSOLE = $prevNoAttach

Write-Host ""
Write-Host "Yippee! " -ForegroundColor Green -NoNewline
Write-Host "Slick is installed at $Target"
Write-Host "Things to know:"
Write-Host "- A new install starts at Slack's sign-in screen (Slick keeps its own session, separate from the official app). Sign in once; it persists."
Write-Host "- Configure at Preferences -> Slick."
Write-Host "- Uninstall:  powershell -File install.ps1 -Uninstall   (add -Purge to also wipe your profile)"
Write-Host "- Restore slack:// to official Slack:  powershell -File install.ps1 -RestoreHandler"

