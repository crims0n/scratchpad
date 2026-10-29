# SPDX-License-Identifier: GPL-3.0-or-later
# Runs without Azure credentials/signing authority on a disposable CI runner.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-pe.ps1')
$work = Join-Path $env:RUNNER_TEMP 'pe-header-tests'
New-Item -ItemType Directory -Force $work | Out-Null
foreach ($case in @(@('x86', 0x14c, 0x10b), @('x64', 0x8664, 0x20b), @('arm64', 0xaa64, 0x20b))) {
  $file = Join-Path $work "$($case[0]).exe"
  $bytes = [byte[]]::new(128)
  [BitConverter]::GetBytes([uint16]0x5a4d).CopyTo($bytes, 0)
  [BitConverter]::GetBytes([uint32]64).CopyTo($bytes, 0x3c)
  [BitConverter]::GetBytes([uint32]0x4550).CopyTo($bytes, 64)
  [BitConverter]::GetBytes([uint16]$case[1]).CopyTo($bytes, 68)
  [BitConverter]::GetBytes([uint16]2).CopyTo($bytes, 86)
  [BitConverter]::GetBytes([uint16]$case[2]).CopyTo($bytes, 88)
  [IO.File]::WriteAllBytes($file, $bytes)
  $image = Get-PeImage $file
  if ($image.Architecture -ne $case[0] -or -not $image.ExecutableImage -or $image.IsDll) { throw 'PE architecture/flags mismatch' }
  $bytes[86] = 0; $bytes[87] = 0x20
  [IO.File]::WriteAllBytes($file, $bytes)
  $image = Get-PeImage $file
  if ($image.ExecutableImage -or -not $image.IsDll) { throw 'PE object/DLL flags were lost' }
  [IO.File]::WriteAllBytes($file, [byte[]]::new(63))
  $rejected = $false
  try { Get-PeImage $file | Out-Null } catch { $rejected = $true }
  if (-not $rejected) { throw 'Truncated PE image was accepted' }
}
foreach ($tool in @($env:SIGNTOOL_PATH, $env:ARTIFACT_SIGNING_DLIB, $env:WINDOWS_SIGNING_DOTNET_X64)) {
  if (-not $tool -or (Get-PeImage $tool).Architecture -ne 'x64') { throw "Expected an x64 signing prerequisite: $tool" }
}
& $env:SIGNTOOL_PATH verify /pa /v $env:SIGNTOOL_PATH
if ($LASTEXITCODE -ne 0) { throw 'x64 SignTool could not verify its Microsoft signature on this ARM runner' }
& $env:WINDOWS_SIGNING_DOTNET_X64 --list-runtimes
if ($LASTEXITCODE -ne 0) { throw 'x64 .NET runtime failed on this ARM runner' }
Write-Host 'PE regression cases and x64 signing prerequisites passed on this Windows runner.'
