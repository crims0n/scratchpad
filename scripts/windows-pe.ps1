# SPDX-License-Identifier: GPL-3.0-or-later

# Keep the PE layout checks aligned with assertArm64Binary in
# scripts/verify-arm64-build.mjs (the application-only ARM64 counterpart).
function Get-PeImage([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $reader = [IO.BinaryReader]::new($stream)
  try {
    if ($stream.Length -lt 64 -or $reader.ReadUInt16() -ne 0x5a4d) { throw "Invalid PE image: $Path" }
    $stream.Position = 0x3c
    $offset = $reader.ReadUInt32()
    if ($offset -lt 64 -or ($offset + 26L) -gt $stream.Length) { throw "Invalid PE header offset: $Path" }
    $stream.Position = $offset
    if ($reader.ReadUInt32() -ne 0x4550) { throw "Invalid PE signature: $Path" }
    $machine = $reader.ReadUInt16()
    $architecture = switch ($machine) { 0x14c { 'x86' }; 0x8664 { 'x64' }; 0xaa64 { 'arm64' }; default { throw "Unsupported PE machine ${machine}: $Path" } }
    $stream.Position = $offset + 22
    $flags = $reader.ReadUInt16()
    $magic = $reader.ReadUInt16()
    $expectedMagic = if ($architecture -eq 'x86') { 0x10b } else { 0x20b }
    if ($magic -ne $expectedMagic) { throw "PE optional-header width does not match machine: $Path" }
    return [pscustomobject]@{ Architecture = $architecture; ExecutableImage = [bool]($flags -band 2); IsDll = [bool]($flags -band 0x2000) }
  } finally {
    $reader.Dispose()
    $stream.Dispose()
  }
}
