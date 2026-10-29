# SPDX-License-Identifier: GPL-3.0-or-later
#
# Verifies the final Windows release artifacts. Checks that the NSIS setup and
# MSI, and every executable and DLL each of them installs, carry a valid
# SHA-256 Authenticode signature from the expected publisher, chained to
# Microsoft's ID Verified code signing CA, with a trusted timestamp. Installs
# the NSIS package into a temporary directory and extracts the MSI with an
# administrative install to reach the installed files.
#
# Usage: verify-windows-release.ps1 -Setup <setup.exe> -Msi <installer.msi>
# Env:   SIGNTOOL_PATH (exported by setup-windows-signing.ps1)
#        WINDOWS_SIGNING_PUBLISHER  expected certificate common name
#        RUNNER_TEMP

param(
  [Parameter(Mandatory)][string]$Setup,
  [Parameter(Mandatory)][string]$Msi,
  [ValidateSet('x64', 'arm64')][string]$Architecture = 'x64',
  [string]$BinaryName = 'scratchpad.exe',
  [string]$SigningEvidencePath,
  [switch]$PassThru
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-pe.ps1')

function Require-Env([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if (-not $value) { throw "$Name must be set" }
  return $value
}

$signtool = Require-Env 'SIGNTOOL_PATH'
$publisher = Require-Env 'WINDOWS_SIGNING_PUBLISHER'
$work = Join-Path (Require-Env 'RUNNER_TEMP') "windows-release-$PID"
$failures = [System.Collections.Generic.List[string]]::new()
$records = [System.Collections.Generic.List[object]]::new()
$payloadPaths = [ordered]@{}

function Test-ReleaseSignature([string]$File, [string]$Package, [string]$Role) {
  $problems = @()

  # SignTool checks the chain against the Windows Authenticode policy (/pa)
  # and reports the file digest and timestamp.
  $output = & $signtool verify /pa /v $File | Out-String
  if ($LASTEXITCODE -ne 0) { $problems += "signtool verify exited with $LASTEXITCODE" }
  if ($output -notmatch 'Hash of file \(sha256\)') { $problems += 'file digest is not SHA-256' }
  if ($output -notmatch 'The signature is timestamped') { $problems += 'signature is not timestamped' }

  $signature = Get-AuthenticodeSignature -LiteralPath $File
  if ($signature.Status -ne 'Valid') {
    $problems += "Authenticode status is $($signature.Status): $($signature.StatusMessage)"
  } else {
    $signer = $signature.SignerCertificate.GetNameInfo('SimpleName', $false)
    $issuer = $signature.SignerCertificate.GetNameInfo('SimpleName', $true)
    if ($signer -ne $publisher) { $problems += "publisher is '$signer', expected '$publisher'" }
    if ($issuer -notlike 'Microsoft ID Verified CS*') { $problems += "issuer is '$issuer', expected Microsoft ID Verified CS" }
    if (-not $signature.TimeStamperCertificate) { $problems += 'no timestamp countersignature' }
  }

  if ($problems) {
    foreach ($problem in $problems) { $failures.Add("${File}: $problem") }
    Write-Host "FAIL $File"
  } else {
    Write-Host "OK   $File"
    $records.Add([ordered]@{
      name = (Split-Path $File -Leaf); package = (Split-Path $Package -Leaf); role = $Role
      size = (Get-Item -LiteralPath $File).Length; sha256 = (Get-FileHash -Algorithm SHA256 $File).Hash.ToLowerInvariant()
      publisher = $publisher; certificateThumbprint = $signature.SignerCertificate.Thumbprint
      timestampCertificateThumbprint = $signature.TimeStamperCertificate.Thumbprint
      architecture = $(if ([IO.Path]::GetExtension($File) -in '.exe', '.dll') { (Get-PeImage $File).Architecture } else { $null })
    })
  }
}

function Test-InstalledFiles([string]$Directory, [string]$Package, [int]$MinimumExecutables) {
  # PowerShell 5.1 ignores -Include with -LiteralPath. Filter the results so
  # documentation and other unsigned resources are not treated as binaries.
  $files = @(Get-ChildItem -LiteralPath $Directory -Recurse -File |
    Where-Object { $_.Extension -in '.exe', '.dll' })
  $executables = @($files | Where-Object Extension -eq '.exe')
  if ($executables.Count -lt $MinimumExecutables) {
    $failures.Add("${Package}: expected at least $MinimumExecutables executables, found $($executables.Count)")
  }
  $applications = @($files | Where-Object Name -eq $BinaryName)
  if ($applications.Count -ne 1) { $failures.Add("${Package}: expected exactly one $BinaryName application") }
  else { $payloadPaths[$(if ($Package -eq $Msi) { 'msi' } else { 'nsis' })] = $applications[0].FullName }
  foreach ($file in $files) {
    try {
      $image = Get-PeImage $file.FullName
      # Only the NSIS uninstaller may use an emulated x86 wrapper. All other
      # installed executables/DLLs must match the application's architecture.
      $uninstaller = $file.Name -eq 'uninstall.exe' -and $Package -eq $Setup
      $allowed = if ($uninstaller) { @('x86', $Architecture) } else { @($Architecture) }
      if ($image.Architecture -notin $allowed -or -not $image.ExecutableImage) {
        $failures.Add("${Package}: $($file.Name) architecture $($image.Architecture), expected $($allowed -join '/') executable image")
      }
      if ($file.Name -eq $BinaryName -and $image.IsDll) { $failures.Add("${Package}: application is marked as a DLL") }
      Write-Host "PE $($image.Architecture) $($file.FullName)"
    } catch { $failures.Add($_.Exception.Message) }
    Test-ReleaseSignature $file.FullName $Package 'payload'
  }
}

foreach ($file in @($Setup, $Msi)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Artifact not found: $file" }
  Test-ReleaseSignature $file $file 'installer'
}
if ($failures.Count) {
  foreach ($failure in $failures) { Write-Host "::error::$failure" }
  throw 'Installer signature verification failed before installation'
}

# Administrative install: unpacks the MSI's files without installing it.
$msiDir = Join-Path $work 'msi'
$msiLog = Join-Path $work 'msi.log'
New-Item -ItemType Directory -Force $msiDir | Out-Null
$msiexec = Start-Process msiexec.exe -Wait -PassThru -ArgumentList @(
  '/a', "`"$Msi`"", '/qn', "TARGETDIR=`"$msiDir`"", '/l*v', "`"$msiLog`""
)
if ($msiexec.ExitCode -ne 0) {
  $failures.Add("${Msi}: administrative install exited with $($msiexec.ExitCode); see $msiLog")
} else {
  Test-InstalledFiles $msiDir $Msi 1
}

# Silent per-user install. NSIS requires /D to be last and unquoted.
$nsisDir = Join-Path $work 'nsis'
$nsis = Start-Process $Setup -Wait -PassThru -ArgumentList @('/S', "/D=$nsisDir")
if ($nsis.ExitCode -ne 0) {
  $failures.Add("${Setup}: silent install exited with $($nsis.ExitCode)")
} else {
  # The application and its uninstaller.
  Test-InstalledFiles $nsisDir $Setup 2
}

if ($failures.Count) {
  foreach ($failure in $failures) { Write-Host "::error::$failure" }
  exit 1
}
Write-Host "All Windows release signatures verified for publisher '$publisher'."
if ($SigningEvidencePath) {
  $commit = (& git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Could not read checked-out signing source' }
  $report = [ordered]@{
    schemaVersion = 1; platform = 'windows'; method = 'authenticode'; publisher = $publisher
    commit = $commit; runId = $env:GITHUB_RUN_ID; runAttempt = $env:GITHUB_RUN_ATTEMPT
    architecture = $Architecture; assets = @($records | Where-Object role -eq 'installer')
    payloads = @($records | Where-Object role -eq 'payload')
    tools = [ordered]@{
      signToolArchitecture = (Get-PeImage $signtool).Architecture
      dlibSha256 = (Get-FileHash -Algorithm SHA256 $env:ARTIFACT_SIGNING_DLIB).Hash.ToLowerInvariant()
      dotnetX64 = $env:WINDOWS_SIGNING_DOTNET_X64
    }
  }
  if (Test-Path -LiteralPath $SigningEvidencePath) { throw 'Signing evidence already exists' }
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $SigningEvidencePath -Encoding utf8
}
if ($PassThru) { [pscustomobject]$payloadPaths }
