# SPDX-License-Identifier: GPL-3.0-or-later
#
# Prepares a Windows runner for sign-windows.ps1. Downloads the pinned Azure
# Artifact Signing dlib, checks its hash and Microsoft signature, finds an x64
# SignTool, writes the dlib metadata, and exports everything the sign command
# needs through GITHUB_ENV.
#
# Usage: setup-windows-signing.ps1 -Description <product name shown in UAC prompts>
# Env:   ARTIFACT_SIGNING_ENDPOINT, ARTIFACT_SIGNING_ACCOUNT, ARTIFACT_SIGNING_PROFILE
#        AZURE_CLIENT_ID, AZURE_TENANT_ID
#        RUNNER_TEMP, GITHUB_ENV

param([Parameter(Mandatory)][string]$Description)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Microsoft.ArtifactSigning.Client on nuget.org. Update both together.
$dlibVersion = '1.0.146'
$dlibSha256 = '7761E5D8F31E54B764DA21D33CD8B0A2940E1B05526C7DFCB5E94B0431426F70'

function Require-Env([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if (-not $value) { throw "$Name must be set" }
  return $value
}

$endpoint = Require-Env 'ARTIFACT_SIGNING_ENDPOINT'
$account = Require-Env 'ARTIFACT_SIGNING_ACCOUNT'
$profileName = Require-Env 'ARTIFACT_SIGNING_PROFILE'
$clientId = Require-Env 'AZURE_CLIENT_ID'
$tenantId = Require-Env 'AZURE_TENANT_ID'
$githubEnv = Require-Env 'GITHUB_ENV'
$root = Join-Path (Require-Env 'RUNNER_TEMP') 'artifact-signing'

if ($endpoint -notmatch '^https://[a-z0-9]+\.codesigning\.azure\.net/?$') {
  throw "ARTIFACT_SIGNING_ENDPOINT is not an Artifact Signing endpoint: $endpoint"
}

New-Item -ItemType Directory -Force $root | Out-Null

# Expand-Archive in Windows PowerShell 5.1 only accepts a .zip extension.
$package = Join-Path $root "microsoft.artifactsigning.client.$dlibVersion.zip"
$packageUrl = "https://api.nuget.org/v3-flatcontainer/microsoft.artifactsigning.client/$dlibVersion/microsoft.artifactsigning.client.$dlibVersion.nupkg"
Invoke-WebRequest -Uri $packageUrl -OutFile $package -UseBasicParsing
$actualSha256 = (Get-FileHash -Algorithm SHA256 $package).Hash
if ($actualSha256 -ne $dlibSha256) {
  throw "Artifact Signing client $dlibVersion has SHA-256 $actualSha256, expected $dlibSha256"
}

$clientDir = Join-Path $root 'client'
Expand-Archive -Path $package -DestinationPath $clientDir -Force
$dlib = Join-Path $clientDir 'bin\x64\Azure.CodeSigning.Dlib.dll'
$dlibSignature = Get-AuthenticodeSignature $dlib
if ($dlibSignature.Status -ne 'Valid' -or $dlibSignature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
  throw "Artifact Signing dlib is not validly signed by Microsoft: $($dlibSignature.Status) $($dlibSignature.SignerCertificate.Subject)"
}

# The dlib architecture must match SignTool's, so use the newest x64 SignTool.
$kitsBin = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
$signtool = Get-ChildItem -Path $kitsBin -Directory |
  Where-Object { $_.Name -as [version] } |
  Sort-Object { [version]$_.Name } -Descending |
  ForEach-Object { Join-Path $_.FullName 'x64\signtool.exe' } |
  Where-Object { Test-Path $_ } |
  Select-Object -First 1
if (-not $signtool) { throw "No x64 signtool.exe found under $kitsBin" }

# sign-windows.ps1 exchanges a fresh GitHub OIDC token for each file, so allow
# only the workload identity credential; anything else would mean signing as
# some other identity that happens to be on the runner.
$metadata = Join-Path $root 'metadata.json'
[ordered]@{
  Endpoint = $endpoint
  CodeSigningAccountName = $account
  CertificateProfileName = $profileName
  ExcludeCredentials = @(
    'EnvironmentCredential',
    'ManagedIdentityCredential',
    'SharedTokenCacheCredential',
    'VisualStudioCredential',
    'VisualStudioCodeCredential',
    'AzureCliCredential',
    'AzurePowerShellCredential',
    'AzureDeveloperCliCredential',
    'InteractiveBrowserCredential'
  )
} | ConvertTo-Json | Set-Content -Path $metadata -Encoding ascii

# ASCII avoids the byte order mark Windows PowerShell 5.1 adds for UTF-8.
@(
  "SIGNTOOL_PATH=$signtool",
  "ARTIFACT_SIGNING_DLIB=$dlib",
  "ARTIFACT_SIGNING_METADATA=$metadata",
  "AZURE_CLIENT_ID=$clientId",
  "AZURE_TENANT_ID=$tenantId",
  "WINDOWS_SIGNING_DESCRIPTION=$Description"
) | Add-Content -Path $githubEnv -Encoding ascii

Write-Host "Artifact Signing client $dlibVersion ready; SignTool: $signtool"
