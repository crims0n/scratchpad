# SPDX-License-Identifier: GPL-3.0-or-later
#
# Tauri signCommand for Windows release builds (src-tauri/tauri.windows-signing.conf.json).
# Signs one file with Azure Artifact Signing through SignTool and the Artifact
# Signing dlib, using SHA-256 and an RFC 3161 timestamp. Tauri calls it for the
# application executable, NSIS plugins and uninstaller, and both installers.
#
# Each call exchanges a fresh GitHub Actions OIDC token. GitHub's ID tokens
# expire after about five minutes, and the Rust build runs much longer than
# that before the first file is signed, so a single login at the start of the
# job would not last.
#
# Usage: sign-windows.ps1 <file>
# Env:   SIGNTOOL_PATH, ARTIFACT_SIGNING_DLIB, ARTIFACT_SIGNING_METADATA,
#        AZURE_CLIENT_ID, AZURE_TENANT_ID, WINDOWS_SIGNING_DESCRIPTION
#          (exported by setup-windows-signing.ps1)
#        ACTIONS_ID_TOKEN_REQUEST_URL, ACTIONS_ID_TOKEN_REQUEST_TOKEN
#          (provided by GitHub Actions when the job has id-token: write)

param([Parameter(Mandatory)][string]$Path)

$ErrorActionPreference = 'Stop'

$timestampUrl = 'http://timestamp.acs.microsoft.com'
$attempts = 3

function Require-Env([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if (-not $value) { throw "$Name must be set" }
  return $value
}

$signtool = Require-Env 'SIGNTOOL_PATH'
$dlib = Require-Env 'ARTIFACT_SIGNING_DLIB'
$metadata = Require-Env 'ARTIFACT_SIGNING_METADATA'
$description = Require-Env 'WINDOWS_SIGNING_DESCRIPTION'
Require-Env 'AZURE_CLIENT_ID' | Out-Null
Require-Env 'AZURE_TENANT_ID' | Out-Null
$tokenRequestUrl = Require-Env 'ACTIONS_ID_TOKEN_REQUEST_URL'
$tokenRequestToken = Require-Env 'ACTIONS_ID_TOKEN_REQUEST_TOKEN'

if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "File to sign not found: $Path" }

$tokenFile = Join-Path ([IO.Path]::GetTempPath()) "artifact-signing-$PID.jwt"
$env:AZURE_FEDERATED_TOKEN_FILE = $tokenFile

try {
  for ($attempt = 1; $attempt -le $attempts; $attempt++) {
    $response = Invoke-RestMethod -UseBasicParsing `
      -Uri "$tokenRequestUrl&audience=api%3A%2F%2FAzureADTokenExchange" `
      -Headers @{ Authorization = "Bearer $tokenRequestToken" }
    [IO.File]::WriteAllText($tokenFile, $response.value)

    & $signtool sign /v /fd SHA256 /tr $timestampUrl /td SHA256 /d $description `
      /dlib $dlib /dmdf $metadata $Path
    if ($LASTEXITCODE -eq 0) { break }

    if ($attempt -eq $attempts) { throw "SignTool failed to sign $Path (exit code $LASTEXITCODE)" }
    Write-Host "SignTool exited with $LASTEXITCODE; retrying $Path"
    Start-Sleep -Seconds (10 * $attempt)
  }
} finally {
  Remove-Item -LiteralPath $tokenFile -Force -ErrorAction SilentlyContinue
}
