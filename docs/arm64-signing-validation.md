# ARM64 signing validation

The **ARM64 signing validation** workflow is the next step after [build feasibility](arm64-build-feasibility.md) for [#132](https://github.com/crims0n/scratchpad/issues/132). It prepares a protected signing experiment before expanding the normal Stable Release asset/evidence matrix.

## PR checks

Changes to the signing workflow and its scripts run a credential-free prerequisite job on both `windows-latest` (x64) and `windows-11-arm`. It verifies the pinned Microsoft signing DLL, checks PE architecture parsing, and executes x64 SignTool and the x64 .NET runtime. This job has repository read permission and no signing environment, OIDC permission, or Azure credentials. Dummy account/profile identifiers are written to a local configuration file but never used to request a signature.

The x64 job also downloads the published v1.0.0 Windows installers, requires their recorded SHA-256 hashes, and verifies publisher/chain/timestamps and installed payload architecture with the updated verifier. These pinned packages are regression fixtures, not new release candidates. Tests run only on disposable CI machines.

The existing unsigned native ARM64 feasibility jobs continue to run independently when shared scripts change.

## Protected signing run

After this workflow is merged, choose **Actions → ARM64 signing validation → Run workflow → main**. The signing jobs require `workflow_dispatch` on `refs/heads/main` and the existing protected `release-signing` environment. Keep its main-only policy and existing reviewer rules. Dispatching another branch runs prerequisite checks but cannot enter a signing job. No environment policy or Azure federation changes are required.

The signing matrix uses `ubuntu-22.04-arm` and `windows-11-arm`, native ARM64 Node/Rust, and **Scratchpad Development** identity (`io.github.crims0n.scratchpad.dev`, `scratchpad-dev`). It uses the existing signing secrets/variables through the same environment as Stable Release; it does not create a draft, tag, published release, or public manifest entry.

- **Windows:** the pinned Artifact Signing client 1.0.146 provides x64/x86 DLLs only. x64 SignTool, x64 dlib, and an x64 .NET 8 runtime run together on Windows ARM. The runtime installer is pinned to 8.0.33 with its official SHA-512 and a valid Microsoft Authenticode signature; an already installed x64 .NET 8 runtime at least that version can be used. ARM64 application builds remain native. Both installers must verify before either is executed/extracted. All installed executables/DLLs retain publisher/chain/timestamp checks and must match ARM64; only the NSIS uninstaller may be an x86 wrapper. A normal MSI install, GUI launch and upgrades still need later acceptance.
- **Linux:** AppImage creation must embed a signature using the published GPG identity. `sign-linux-release.sh --architecture arm64` selects `aarch64.AppImage` and `arm64.deb`, signs their checksum manifest, verifies it using only the published public key, and requires modified checksums/packages to fail verification. The private keyring is confined to a temporary directory and removed on job exit.

The two passing jobs save `signed-arm64-validation-linux` and `signed-arm64-validation-windows` artifacts for seven days. Each includes its packages and `architecture-evidence.json`; Linux also includes `SHA256SUMS` and `SHA256SUMS.asc`. The JSON contains native toolchain details, checked-out main commit, run/attempt, application header/hash evidence, signing metadata, and the exact signature-checked package hashes. On Windows, the MSI/NSIS application hashes must also match the payload records saved after publisher/timestamp verification. The final collector rejects another source/run or changed bytes and checks the staged copies again. These are signed **development test packages**, not a stable ARM64 release.

## Remaining integration

A successful protected run must be recorded before claiming ARM64 signing works. PR prerequisite checks alone establish no Azure/GPG signing result. This run covers only the ARM64 Linux pair; the eventual Stable Release integration must gather **both Linux architectures into one final authenticated checksum pair**, introduce architecture-specific candidate records/canonical names, extend exact upload/download verification and catalog recognition, and complete native GUI/MCP/install/upgrade acceptance before publication. Existing stable packaging and the public download catalog keep their current package set until that work is reviewed.

References: [Microsoft Artifact Signing prerequisites](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations), [.NET architecture paths on Windows ARM](https://learn.microsoft.com/en-us/dotnet/core/install/windows#arm-based-windows-pcs).
