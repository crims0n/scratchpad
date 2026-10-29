# SPDX-License-Identifier: GPL-3.0-or-later
# The pinned signing dlib ships x64/x86, not ARM64. Run x64 SignTool/dlib
# together with an x64 .NET 8 runtime, including on Windows 11 ARM64.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
. (Join-Path $PSScriptRoot 'windows-pe.ps1')

$version = [version]'8.0.33'
$url = 'https://builds.dotnet.microsoft.com/dotnet/Runtime/8.0.33/dotnet-runtime-8.0.33-win-x64.exe'
$sha512 = '9da969a8eb34daa8d1ecc1013b3d2f09f7df805a78d963c54efaab3cdddb7ad0a04f9a950ada7057fcddfd664a20f2ab6e1ac4cc50cd96dabfa66c7fc325e10f'

function Find-X64Runtime {
  $programFiles = [Environment]::GetFolderPath('ProgramFiles')
  $candidates = @((Join-Path $programFiles 'dotnet/x64/dotnet.exe'), (Join-Path $programFiles 'dotnet/dotnet.exe'))
  foreach ($candidate in $candidates) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    if ((Get-PeImage $candidate).Architecture -ne 'x64') { continue }
    $runtimes = @(& $candidate --list-runtimes)
    if ($LASTEXITCODE -ne 0) { throw "Could not inspect x64 .NET runtimes: $candidate" }
    foreach ($line in $runtimes) {
      if ($line -match '^Microsoft.NETCore.App (8\.0\.\d+) ') {
        if ([version]$Matches[1] -ge $version) { return $candidate }
      }
    }
  }
  return $null
}

$dotnet = Find-X64Runtime
if (-not $dotnet) {
  if (-not $env:RUNNER_TEMP) { throw 'RUNNER_TEMP must be set' }
  $installer = Join-Path $env:RUNNER_TEMP 'dotnet-runtime-x64.exe'
  Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing
  if ((Get-FileHash -Algorithm SHA512 $installer).Hash -ne $sha512) { throw 'Pinned .NET runtime installer hash mismatch' }
  $signature = Get-AuthenticodeSignature -LiteralPath $installer
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
    throw 'The .NET runtime installer is not validly signed by Microsoft'
  }
  $process = Start-Process $installer -Wait -PassThru -ArgumentList @('/install', '/quiet', '/norestart')
  if ($process.ExitCode -notin 0, 3010) { throw ".NET runtime installation failed: $($process.ExitCode)" }
  $dotnet = Find-X64Runtime
  if (-not $dotnet) { throw 'No supported x64 .NET 8 runtime found after installation' }
}
if (-not $env:GITHUB_ENV) { throw 'GITHUB_ENV must be set' }
@("DOTNET_ROOT_X64=$(Split-Path $dotnet)", "WINDOWS_SIGNING_DOTNET_X64=$dotnet") | Add-Content -Path $env:GITHUB_ENV -Encoding ascii
Write-Host "Verified x64 .NET 8 runtime for signing: $dotnet"
& $dotnet --list-runtimes
if ($LASTEXITCODE -ne 0) { throw 'Could not execute the x64 .NET runtime' }
