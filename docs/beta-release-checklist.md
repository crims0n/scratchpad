# Beta release checklist

The next candidate is **v0.8.2** (`scratchpad-beta-v0.8.2`), the first beta with macOS, Windows, and Linux signing. Its version and release notes are already prepared. Do not bump the version again unless that release already exists.

## Build the draft

1. Confirm the release-preparation PR is merged, `main` CI passes, and all version checks pass (`npm run check`).
2. Confirm no release already uses the candidate tag, including a draft. Check any previous Beta Release run before starting another.
3. Run **Actions → Beta Release → Run workflow**, selecting `main`, or use `gh workflow run beta-release.yml --ref main`. Record the run URL and commit SHA.
4. Review and approve the pending `release-signing` environment deployment for the three build jobs.
5. Require the validation job and all three build jobs to pass. The release remains a draft prerelease; successful upload alone is not enough.

If a signing step fails, keep the release as a draft and inspect the failed job. Fix code through a PR. The workflow refuses an existing release tag, so deliberately remove a failed draft before rebuilding the same version; do not publish or reuse incomplete assets. Keep the failed run URL for diagnosis.

## Review signing results

Record each result with the run URL in the release-preparation PR or tracking issue:

| Platform | Required pipeline evidence | Expected draft assets |
| --- | --- | --- |
| macOS | Expected Developer ID team `B62UYUQ6C3`; app and DMG notarized and stapled; Gatekeeper acceptance; hardened runtime without entitlements; native and Rosetta MCP launch checks; stapled DMG upload digest matches | One universal `.dmg` and `.app.tar.gz` |
| Windows | Expected publisher `Patrick McDowell`; SHA-256 signatures and trusted timestamps on both installers and their installed executables/DLLs | One `-setup.exe` and `.msi` |
| Linux | Published GPG key fingerprint matches; AppImage embedded signature issuer matches; signed checksums verify with only the public key; modified checksums and packages are rejected | One `_amd64.AppImage`, `_amd64.deb`, `SHA256SUMS`, and `SHA256SUMS.asc` |

Read the platform signing guides for detailed checks: [macOS](macos-release-signing.md), [Windows](windows-release-signing.md), and [Linux](release-signing.md).

## Install before publishing

- **macOS (Apple Silicon and Intel):** browser-download the DMG, install to Applications, and launch without a Gatekeeper bypass. Edit, save, and reopen a note; enable agent access and connect an MCP client with the installed executable.
- **Windows:** browser-download both installers on a clean test system. Check file properties and UAC show the expected publisher, record SmartScreen behavior, then install, launch, edit/save/reopen, and uninstall each package.
- **Linux:** download packages and checksum files from the same draft. Follow [Verifying Linux downloads](verify-linux-downloads.md), then test AppImage launch and `.deb` installation on a supported clean system. Edit, save, and reopen a note.

Only publish the draft after recording these acceptance results and reviewing the release notes and complete asset list. Publishing updates the website's release manifest; draft builds do not replace the public downloads.
