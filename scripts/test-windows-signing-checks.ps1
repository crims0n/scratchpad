# SPDX-License-Identifier: GPL-3.0-or-later
# Control-flow/trust-parser regression tests with explicit signature mocks.
# Real Microsoft and published-installer signatures are checked separately.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-signing-trust.ps1')
. (Join-Path $PSScriptRoot 'windows-pe.ps1')

$fixtureStatus = 'Valid'
function Get-AuthenticodeSignature {
  param([string]$LiteralPath)
  [pscustomobject]@{ Status = $fixtureStatus; SignerCertificate = [pscustomobject]@{ SubjectName = $fixtureSubject } }
}
foreach ($case in @(
  @('CN=Test, O=Microsoft Corporation', $true),
  @('CN=Test, O=Microsoft Corporation Evil', $false),
  @('CN="O=Microsoft Corporation", O=Other', $false),
  @('O=Microsoft Corporation, O=Other', $false)
)) {
  $fixtureSubject = [Security.Cryptography.X509Certificates.X500DistinguishedName]::new($case[0])
  $accepted = $true
  try { Assert-MicrosoftAuthenticode fixture | Out-Null } catch { $accepted = $false }
  if ($accepted -ne $case[1]) { throw "Incorrect organization trust decision: $($case[0])" }
}
$fixtureStatus = 'NotSigned'
$fixtureSubject = [Security.Cryptography.X509Certificates.X500DistinguishedName]::new('O=Microsoft Corporation')
$rejected = $false
try { Assert-MicrosoftAuthenticode fixture | Out-Null } catch { $rejected = $true }
if (-not $rejected) { throw 'Unsigned Microsoft-named fixture was trusted' }

# Import only the production function definitions, without running its
# installer entrypoint. This tests the exact functions used by the workflow.
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'verify-windows-release.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Windows verifier failed PowerShell parsing' }
$definitions = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in 'Test-InstalledFiles', 'Test-ReleaseSignature' }, $false))
if ($definitions.Count -ne 2) { throw 'Could not load verifier functions' }
foreach ($definition in $definitions) { . ([scriptblock]::Create($definition.Extent.Text)) }

$publisher = 'Fixture Publisher'
$signer = [pscustomobject]@{ Thumbprint = ('A' * 40) }
$signer | Add-Member ScriptMethod GetNameInfo { param($type, $issuer) if ($issuer) { 'Microsoft ID Verified CS Fixture' } else { 'Fixture Publisher' } }
function Get-AuthenticodeSignature {
  param([string]$LiteralPath)
  [pscustomobject]@{ Status = 'Valid'; SignerCertificate = $signer; TimeStamperCertificate = [pscustomobject]@{ Thumbprint = ('B' * 40) } }
}
function Invoke-FixtureSignTool {
  $global:LASTEXITCODE = 0
  'Hash of file (sha256)'
  'The signature is timestamped'
}
$signtool = 'Invoke-FixtureSignTool'
$work = Join-Path $env:RUNNER_TEMP 'windows-verifier-control-flow'
New-Item -ItemType Directory -Force $work | Out-Null
foreach ($name in @('a-malformed.dll', 'b-arm64ec.dll', 'scratchpad.exe', 'z-valid.dll')) {
  $bytes = [byte[]]::new(128)
  [BitConverter]::GetBytes([uint16]0x5a4d).CopyTo($bytes, 0)
  [BitConverter]::GetBytes([uint32]64).CopyTo($bytes, 0x3c)
  [BitConverter]::GetBytes([uint32]0x4550).CopyTo($bytes, 64)
  [BitConverter]::GetBytes([uint16]$(if ($name -eq 'b-arm64ec.dll') { 0xa641 } else { 0x8664 })).CopyTo($bytes, 68)
  [BitConverter]::GetBytes([uint16]2).CopyTo($bytes, 86)
  [BitConverter]::GetBytes([uint16]0x20b).CopyTo($bytes, 88)
  if ($name -eq 'a-malformed.dll') { $bytes = [byte[]]::new(63) }
  [IO.File]::WriteAllBytes((Join-Path $work $name), $bytes)
}
$originalParser = ${function:Get-PeImage}
$parserCalls = @{}
function Get-PeImage([string]$Path) {
  $parserCalls[$Path] = 1 + $parserCalls[$Path]
  & $originalParser $Path
}
$Architecture = 'x64'; $BinaryName = 'scratchpad.exe'; $Msi = 'fixture.msi'; $Setup = 'fixture-setup.exe'
$failures = [Collections.Generic.List[string]]::new()
$records = [Collections.Generic.List[object]]::new()
$payloadPaths = [ordered]@{}
Test-InstalledFiles $work $Msi 1
if ($failures.Count -ne 2 -or $records.Count -ne 4 -or $parserCalls.Count -ne 4) { throw 'Payload checks stopped early or lost failures' }
if ($parserCalls.Values | Where-Object { $_ -ne 1 }) { throw 'A payload was parsed more than once' }
if (-not ($failures | Where-Object { $_ -match 'Invalid PE' }) -or -not ($failures | Where-Object { $_ -match 'Unsupported PE machine' })) { throw 'Header failures were not retained' }
Write-Host 'Trust parser rejects misleading organizations; malformed/ARM64EC payloads are reported while every remaining file is checked once.'
