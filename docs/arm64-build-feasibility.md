# ARM64 build feasibility

This is the first implementation step for [#132](https://github.com/crims0n/scratchpad/issues/132). The **ARM64 build feasibility** workflow builds unsigned Linux and Windows development packages on native ARM64 GitHub-hosted runners. It does not establish production ARM64 release support.

| Platform | Runner | Rust target | Formats |
| --- | --- | --- | --- |
| Linux | `ubuntu-22.04-arm` | `aarch64-unknown-linux-gnu` | AppImage, DEB |
| Windows | `windows-11-arm` | `aarch64-pc-windows-msvc` | NSIS EXE, MSI |

The workflow runs for PR changes to the frontend (`src/`), Rust/native code and configuration (`src-tauri/`), build/inspection scripts, dependency manifests and lockfiles, Rust toolchain/Cargo/npm configuration, versioned release notes, bundled license notices, or its own workflow/tests. Once merged, maintainers can also run it from **Actions → ARM64 build feasibility → Run workflow**, choosing the branch to inspect. It has read-only repository permission, no signing environment/secrets, and no release creation or upload steps. Failures in one platform do not cancel the other.

## Identity and artifacts

Packages use the existing **Scratchpad Development** configuration: identifier `io.github.crims0n.scratchpad.dev`, executable `scratchpad-dev`, and separate local data, preferences, and MCP discovery. Production release and signing overrides are not applied. Deliberately opening the same workspace file in two apps still shares that file; use disposable data when testing.

Each passing job saves an `unsigned-arm64-feasibility-linux` or `unsigned-arm64-feasibility-windows` workflow artifact for seven days. It contains the two packages and `architecture-evidence.json`, recording the actual checked-out Git `commit`, durable `prHeadCommit`, event type, workflow run/attempt, version, target, Rust toolchain host/version/verbose details, package sizes/hashes, and inspected application sizes/hashes. For PR runs, `commit` identifies the tested merge of the PR into its base and `prHeadCommit` identifies the reviewed branch head; retaining both avoids mistaking the branch head for the source actually built. For manual dispatch, `prHeadCommit` is explicitly `null`. These are development test downloads, not signed releases or public website downloads.

## What the checks establish

- Node.js and Rust must use the expected native ARM64 host. Rust's version, host, and full `rustc -vV` output are saved in the JSON evidence.
- `npm run check:versions` runs before building, requiring matching versions in npm manifests/lockfile, Tauri configuration, Cargo manifest/lockfile, release notes, and the About dialog.
- Linux requires one AppImage and one DEB. The DEB must declare `Architecture: arm64`. The AppImage is extracted using its own runtime, without requiring a FUSE mount, and the DEB is unpacked with `dpkg-deb`.
- Windows requires one NSIS setup and one MSI. The MSI is unpacked using an administrative installation; NSIS performs a silent development-profile install into a temporary directory on the disposable runner.
- The compiled application and the application extracted from **each** package must have native ARM64 executable headers: little-endian ELF64/AArch64 with executable type and an entry point on Linux (dynamically linked PIE applications also require an interpreter program header); PE32+/ARM64 with the executable-image flag and no DLL flag on Windows. These are bounded header inspections, not full loader validation. Installer wrapper architecture is deliberately separate: Tauri's NSIS wrapper can be x86 while its application is ARM64.
- Inspected packages are copied to the artifact directory and their hashes checked again before upload.

## Remaining release work

A successful run proves that the selected toolchain can build both formats and that the inspected application payloads are ARM64. It does not establish signing, GUI startup, functional MCP, installation/upgrade acceptance, or x64-to-ARM64 data continuity. MSI administrative extraction is not a normal MSI installation test.

Follow-up PRs must extend production target/asset/evidence contracts; adapt Windows signing and payload verification; gather both Linux architectures into one authenticated checksum pair; update manifest/download selection and regression tests; and record native installed-package acceptance. Keep the current stable release workflow and published catalog unchanged until those changes are ready together.

References: [GitHub-hosted ARM runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [Tauri ARM AppImages](https://tauri.app/distribute/appimage/#appimages-for-arm-based-devices), and [Tauri Windows ARM builds](https://tauri.app/distribute/windows-installer/#building-for-32-bit-or-arm). The locked Tauri CLI's [MSI bundler source](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.4/crates/tauri-bundler/src/bundle/windows/msi/mod.rs) handles ARM64; actual packaging results must still be recorded on the PR.
