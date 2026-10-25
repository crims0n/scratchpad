# SPDX-License-Identifier: GPL-3.0-or-later
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$manifest = Join-Path $repoRoot 'src-tauri/windows/test-harness.manifest'
$cargoManifest = Join-Path $repoRoot 'src-tauri/Cargo.toml'

# rfd's common-controls-v6 feature imports TaskDialogIndirect. Tauri embeds the
# required activation manifest in the application, but Cargo's lib-test EXE
# needs its own. Apply the same Common Controls dependency before running it.
$manifestTool = Get-ChildItem -Path "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\mt.exe" -File |
    Sort-Object FullName -Descending | Select-Object -First 1
if (-not $manifestTool) { throw 'Windows SDK manifest tool (mt.exe) was not found.' }

$records = @(& cargo test --locked --manifest-path $cargoManifest --lib --no-run --message-format=json-render-diagnostics)
if ($LASTEXITCODE -ne 0) {
    $records | Write-Output
    throw 'Could not build the Windows test executable.'
}
$testArtifacts = @($records | ForEach-Object { $_ | ConvertFrom-Json } |
    Where-Object { $_.reason -eq 'compiler-artifact' -and $_.profile.test -and $_.executable })
if ($testArtifacts.Count -ne 1) {
    throw "Expected one library test executable, got $($testArtifacts.Count)."
}
$testExecutable = $testArtifacts[0].executable
& $manifestTool.FullName -nologo -manifest $manifest "-outputresource:$testExecutable;#1"
if ($LASTEXITCODE -ne 0) { throw 'Could not embed the test activation manifest.' }

& $testExecutable 'workspace::tests'
if ($LASTEXITCODE -ne 0) { throw 'Windows workspace tests failed.' }
