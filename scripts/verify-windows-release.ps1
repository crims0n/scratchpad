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
  [Parameter(Mandatory)][string]$Msi
)

$ErrorActionPreference = 'Stop'

function Require-Env([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if (-not $value) { throw "$Name must be set" }
  return $value
}

$signtool = Require-Env 'SIGNTOOL_PATH'
$publisher = Require-Env 'WINDOWS_SIGNING_PUBLISHER'
$work = Join-Path (Require-Env 'RUNNER_TEMP') "windows-release-$PID"
$failures = [System.Collections.Generic.List[string]]::new()

function Test-ReleaseSignature([string]$File) {
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
  foreach ($file in $files) { Test-ReleaseSignature $file.FullName }
}

foreach ($file in @($Setup, $Msi)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Artifact not found: $file" }
  Test-ReleaseSignature $file
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
