# Agent Chat start script for Windows (works with Windows PowerShell 5.1).
# Finds Node.js (or downloads a portable copy into .runtime\), installs dependencies if needed,
# then starts the server. Nothing is installed outside this folder and no admin rights are needed.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # makes Invoke-WebRequest much faster on PowerShell 5.1

$AppDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $AppDir

$RuntimeDir = Join-Path $AppDir '.runtime'
$NodeMajorWanted = 24
$NodeMajorMin = 20
$NodeDist = "https://nodejs.org/dist/latest-v$NodeMajorWanted.x"
# Only for testing the start script itself; normal use always starts server.js.
$Entry = if ($env:AGENT_CHAT_ENTRY) { $env:AGENT_CHAT_ENTRY } else { 'server.js' }
$Help = 'More help: docs\troubleshooting.md in the Agent Chat folder.'

function Say([string]$Text) { Write-Host $Text }
function Fail([string]$Text) {
  Write-Host ''
  Write-Host 'Agent Chat could not start.' -ForegroundColor Red
  Write-Host $Text
  Write-Host $Help
  exit 1
}

# Older Windows versions do not use TLS 1.2 by default, which nodejs.org requires.
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

Say 'Starting Agent Chat...'

# 1. Pick a Node.js: the one already on this computer (if new enough), or a portable copy.
$NodeExe = $null
$NpmCmd = $null

if ($env:FORCE_PORTABLE -ne '1') {
  $systemNode = Get-Command node -ErrorAction SilentlyContinue
  if ($systemNode) {
    try {
      $major = [int](& $systemNode.Source -p "process.versions.node.split('.')[0]")
      if ($major -ge $NodeMajorMin) {
        $NodeExe = $systemNode.Source
        $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if ($npm) { $NpmCmd = $npm.Source }
        Say "Using Node.js $(& $NodeExe -v) that is already on this computer."
      }
    } catch { }
  }
}

function Find-Portable {
  if (-not (Test-Path -LiteralPath $RuntimeDir)) { return $null }
  $dirs = Get-ChildItem -LiteralPath $RuntimeDir -Directory -Filter 'node-v*' -ErrorAction SilentlyContinue
  foreach ($d in $dirs) {
    if (Test-Path -LiteralPath (Join-Path $d.FullName 'node.exe')) { return $d.FullName }
  }
  return $null
}

if (-not $NodeExe) {
  $PortableDir = Find-Portable

  if (-not $PortableDir) {
    Say 'Node.js is needed. Downloading a private copy into this folder (about 30 MB, one time only).'

    $arch = $env:PROCESSOR_ARCHITECTURE
    if ($env:PROCESSOR_ARCHITEW6432) { $arch = $env:PROCESSOR_ARCHITEW6432 }
    switch ($arch) {
      'ARM64' { $platform = 'win-arm64' }
      'AMD64' { $platform = 'win-x64' }
      default { Fail "This computer type ($arch) is not supported by the automatic download. Install Node.js 20 or newer from nodejs.org and try again." }
    }

    try {
      New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
    } catch {
      Fail 'Could not create the folder .runtime inside the Agent Chat folder. Move the Agent Chat folder somewhere you can write to, for example your Documents folder. Do not run it from inside the zip file.'
    }

    try {
      $sums = (Invoke-WebRequest -UseBasicParsing -Uri "$NodeDist/SHASUMS256.txt").Content
      if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
    } catch {
      Fail 'Could not reach nodejs.org to download Node.js. Check your internet connection. On a company network, try home wifi or a phone hotspot.'
    }

    $line = ($sums -split "`n") | Where-Object { $_ -match "node-v[0-9.]+-$platform\.zip\s*$" } | Select-Object -First 1
    if (-not $line) { Fail "Could not find the right Node.js download for this computer ($platform) on nodejs.org." }
    $parts = $line.Trim() -split '\s+'
    $expected = $parts[0].ToLower()
    $file = $parts[1]
    $archive = Join-Path $RuntimeDir $file

    Say "Downloading $file ..."
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$NodeDist/$file" -OutFile $archive
    } catch {
      Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
      Fail 'The Node.js download stopped before it finished. Check your internet connection and double-click the start file again.'
    }

    Say 'Checking the download is genuine...'
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLower()
    if ($actual -ne $expected) {
      Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
      Fail 'The downloaded Node.js does not match the official checksum, so it was deleted for safety. This can happen on networks that change downloads. Try again on another network.'
    }

    Say 'Unpacking (this can take a minute)...'
    try {
      Expand-Archive -LiteralPath $archive -DestinationPath $RuntimeDir -Force
    } catch {
      Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
      Fail 'Could not unpack Node.js. Check there is enough free disk space (about 200 MB). If your antivirus blocked it, see the troubleshooting page.'
    }
    Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue

    $PortableDir = Find-Portable
    if (-not $PortableDir) { Fail 'Node.js was unpacked but could not be found afterwards. Delete the .runtime folder and try again.' }
  }

  $NodeExe = Join-Path $PortableDir 'node.exe'
  $NpmCmd = Join-Path $PortableDir 'npm.cmd'
  # Only for this session, so npm finds the portable node. Nothing changes permanently.
  $env:Path = "$PortableDir;$env:Path"
  try {
    $version = & $NodeExe -v
  } catch {
    Fail 'The private copy of Node.js does not run. Delete the .runtime folder and try again. If your antivirus removed it, see the troubleshooting page.'
  }
  Say "Using the private copy of Node.js $version."
}

# 2. Install dependencies, only when package.json lists some and they are missing or out of date.
$pkg = Join-Path $AppDir 'package.json'
if (Test-Path -LiteralPath $pkg) {
  $hasDeps = 'no'
  try {
    $hasDeps = & $NodeExe -e "const p=require('./package.json');process.stdout.write(Object.keys(p.dependencies||{}).length?'yes':'no')"
  } catch { }
  $stamp = Join-Path $AppDir 'node_modules\.install-stamp'
  $needInstall = $false
  if ($hasDeps -eq 'yes') {
    if (-not (Test-Path -LiteralPath $stamp)) { $needInstall = $true }
    elseif ((Get-Item -LiteralPath $pkg).LastWriteTime -gt (Get-Item -LiteralPath $stamp).LastWriteTime) { $needInstall = $true }
  }
  if ($needInstall) {
    Say 'Installing the extra parts Agent Chat needs (one time only)...'
    if (-not $NpmCmd -or -not (Test-Path -LiteralPath $NpmCmd)) { Fail 'npm (part of Node.js) was not found. Delete the .runtime folder and try again.' }
    & $NpmCmd install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Fail 'Installing the extra parts failed. Check your internet connection and try again.' }
    New-Item -ItemType File -Force -Path $stamp | Out-Null
  }
}

# 3. Start the server. It opens the browser by itself and keeps running until this window is closed.
if (-not (Test-Path -LiteralPath (Join-Path $AppDir $Entry))) { Fail "The file $Entry is missing from the Agent Chat folder. Download Agent Chat again." }
Say ''
Say 'Agent Chat is starting. Keep this window open while you use it. Close it to stop Agent Chat.'
Say ''
& $NodeExe $Entry
if ($LASTEXITCODE -ne 0) {
  Fail "Agent Chat stopped with an error (code $LASTEXITCODE). Read the message above for details."
}
exit 0
