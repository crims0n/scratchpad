# SPDX-License-Identifier: GPL-3.0-or-later
# Runs only on a fresh GitHub Actions Windows runner. Exercises the real hook
# against the published signed v0.8.2 installer, with disposable profile data.
param([Parameter(Mandatory)][string]$MakeNsis)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) {
  throw 'This test requires an ephemeral GitHub Actions Windows runner.'
}

$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Scratchpad Beta'
$installKey = 'HKCU:\Software\github\Scratchpad Beta'
$profiles = @(
  (Join-Path $env:APPDATA 'io.github.crims0n.scratchpad.beta'),
  (Join-Path $env:LOCALAPPDATA 'io.github.crims0n.scratchpad.beta')
)
foreach ($path in @($uninstallKey, $installKey) + $profiles) {
  if (Test-Path -LiteralPath $path) { throw "Refusing to touch existing Beta state: $path" }
}

$work = Join-Path $env:RUNNER_TEMP "scratchpad-beta-transition-$PID"
$betaDir = Join-Path $work 'old install with spaces'
$marker = Join-Path $work 'installed.txt'
$fixture = Join-Path $work 'transition.exe'
$hook = (Resolve-Path (Join-Path $PSScriptRoot '../src-tauri/windows/beta-transition.nsh')).Path
$ownsBetaState = $false
New-Item -ItemType Directory $work | Out-Null

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Invoke-Transition([bool]$Success) {
  Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
  $process = Start-Process $fixture -ArgumentList '/S' -PassThru -Wait
  Assert-True (($process.ExitCode -eq 0) -eq $Success) "Unexpected transition exit code: $($process.ExitCode), expected success=$Success"
  Assert-True ((Test-Path -LiteralPath $marker) -eq $Success) 'Failed transition must stop before installing new files.'
}

function Assert-DataPreserved {
  foreach ($path in $profiles) {
    Assert-True ((Get-Content -LiteralPath (Join-Path $path 'notes-and-preferences.txt') -Raw) -eq 'keep this data') "Profile data was changed or deleted: $path"
    Assert-True ((Get-Content -LiteralPath (Join-Path $path 'collection-backups/safety.json') -Raw) -eq 'keep safety copy') "Safety copy was changed or deleted: $path"
  }
}

try {
  # A small installer that inserts the production hook immediately before the
  # marker standing in for Tauri's new-file copy. No application is launched.
  @'
Unicode true
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
!include "${HOOK_FILE}"
!define PRODUCTNAME "Scratchpad"
!define BUNDLEID "io.github.crims0n.scratchpad.beta"
OutFile "${OUTPUT_FILE}"
Section
  SetShellVarContext current
  SetRegView 64
  !insertmacro NSIS_HOOK_PREINSTALL
  FileOpen $0 "$EXEDIR\installed.txt" w
  FileWrite $0 "installed"
  FileClose $0
SectionEnd
'@ | Set-Content -LiteralPath (Join-Path $work 'transition.nsi')
  & $MakeNsis /WX /V2 "/DHOOK_FILE=$hook" "/DOUTPUT_FILE=$fixture" (Join-Path $work 'transition.nsi')
  if ($LASTEXITCODE -ne 0) { throw 'Could not compile the production hook.' }

  # Controlled failing/no-op uninstallers check the actual ExecWait arguments
  # and prove that exit codes and incomplete removal block the new installer.
  @'
Unicode true
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
!include FileFunc.nsh
OutFile "${OUTPUT_FILE}"
Section
  ${GetParameters} $1
  FileOpen $0 "$EXEDIR\uninstaller-args.txt" w
  FileWrite $0 $1
  FileClose $0
  SetErrorLevel ${RESULT}
  Quit
SectionEnd
'@ | Set-Content -LiteralPath (Join-Path $work 'mock.nsi')
  foreach ($result in @(0, 7)) {
    & $MakeNsis /WX /V2 "/DOUTPUT_FILE=$(Join-Path $work "mock-$result.exe")" "/DRESULT=$result" (Join-Path $work 'mock.nsi')
    if ($LASTEXITCODE -ne 0) { throw 'Could not compile the test uninstaller.' }
  }

  Invoke-Transition $true
  Write-Host 'PASS clean install without Beta'

  $setup = Join-Path $work 'beta-setup.exe'
  Invoke-WebRequest 'https://github.com/crims0n/scratchpad/releases/download/scratchpad-beta-v0.8.2/Scratchpad.Beta_0.8.2_x64-setup.exe' -OutFile $setup
  Assert-True ((Get-FileHash -Algorithm SHA256 -LiteralPath $setup).Hash -eq '109bd2dae7aa77336cba1e410310213b904c60dbab0ad8ab97e40d15d0283edf') 'Published Beta installer digest mismatch.'
  $ownsBetaState = $true
  $process = Start-Process $setup -ArgumentList @('/S', "/D=$betaDir") -Wait -PassThru
  Assert-True ($process.ExitCode -eq 0) "Beta installation failed: $($process.ExitCode)"
  Assert-True (Test-Path -LiteralPath (Join-Path $betaDir 'scratchpad.exe')) 'Beta executable missing.'
  Assert-True (Test-Path -LiteralPath $uninstallKey) 'Beta uninstall registration missing.'
  foreach ($path in $profiles) {
    New-Item -ItemType Directory -Force (Join-Path $path 'collection-backups') | Out-Null
    [IO.File]::WriteAllText((Join-Path $path 'notes-and-preferences.txt'), 'keep this data')
    [IO.File]::WriteAllText((Join-Path $path 'collection-backups/safety.json'), 'keep safety copy')
  }

  $publisher = (Get-ItemProperty -LiteralPath $uninstallKey).Publisher
  try {
    Set-ItemProperty -LiteralPath $uninstallKey -Name Publisher -Value 'unexpected publisher'
    Invoke-Transition $false
    Assert-DataPreserved
  } finally { Set-ItemProperty -LiteralPath $uninstallKey -Name Publisher -Value $publisher }
  Write-Host 'PASS invalid installation metadata blocks migration'

  $uninstaller = Join-Path $betaDir 'uninstall.exe'
  $savedUninstaller = Join-Path $betaDir 'uninstall.saved'
  Move-Item -LiteralPath $uninstaller -Destination $savedUninstaller
  try {
    Invoke-Transition $false
    Assert-DataPreserved
  } finally { Move-Item -LiteralPath $savedUninstaller -Destination $uninstaller }
  Write-Host 'PASS missing uninstaller blocks migration'

  $locked = [IO.File]::Open((Join-Path $betaDir 'scratchpad.exe'), 'Open', 'Read', 'Read')
  try {
    Invoke-Transition $false
    Assert-DataPreserved
    Assert-True (Test-Path -LiteralPath $uninstaller) 'Locked executable must not start uninstallation.'
  } finally { $locked.Dispose() }
  Write-Host 'PASS locked executable blocks migration'

  foreach ($result in @(7, 0)) {
    Move-Item -LiteralPath $uninstaller -Destination $savedUninstaller
    try {
      Copy-Item -LiteralPath (Join-Path $work "mock-$result.exe") -Destination $uninstaller
      Invoke-Transition $false
      Assert-DataPreserved
      $arguments = Get-Content -LiteralPath (Join-Path $betaDir 'uninstaller-args.txt') -Raw
      Assert-True ($arguments -eq "/S /UPDATE _?=$betaDir") "Unsafe uninstaller arguments: $arguments"
      Assert-True (Test-Path -LiteralPath (Join-Path $betaDir 'scratchpad.exe')) 'Mock uninstaller must leave the old executable intact.'
    } finally {
      Remove-Item -LiteralPath $uninstaller -Force -ErrorAction SilentlyContinue
      Move-Item -LiteralPath $savedUninstaller -Destination $uninstaller
    }
  }
  Write-Host 'PASS nonzero exit and incomplete removal block migration; /UPDATE is always passed'

  # Retry with the real signed Beta uninstaller. /UPDATE prevents removal of
  # both profile roots; the hook must also remove the old uninstaller itself.
  Invoke-Transition $true
  Assert-DataPreserved
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $betaDir 'scratchpad.exe'))) 'Old executable remains.'
  Assert-True (-not (Test-Path -LiteralPath $uninstaller)) 'Old uninstaller remains.'
  Assert-True (-not (Test-Path -LiteralPath $uninstallKey)) 'Old uninstall registration remains.'
  Assert-True (-not (Test-Path -LiteralPath $installKey)) 'Old installer settings remain.'
  Assert-True (Test-Path -LiteralPath (Join-Path $betaDir 'uninstaller-args.txt')) 'Unrelated install-directory files must be preserved.'
  Invoke-Transition $true
  Assert-DataPreserved
  Write-Host 'PASS real v0.8.2 transition, data retention, old-uninstaller cleanup, and repeat install'
} finally {
  if ($ownsBetaState) {
    $uninstaller = Join-Path $betaDir 'uninstall.exe'
    if (Test-Path -LiteralPath $uninstaller) {
      Start-Process $uninstaller -ArgumentList @('/S', '/UPDATE', "_?=$betaDir") -Wait | Out-Null
    }
    foreach ($path in @($uninstallKey, $installKey) + $profiles) {
      Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
