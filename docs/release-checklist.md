# Release checklist

The first stable candidate is **v1.0.0** (`v1.0.0`). Its version and release notes are prepared. Build it as a draft and complete review and installed-package acceptance before publication. This checklist does not claim that those checks have already been completed.

## Build the draft

1. Confirm the release-preparation PR is merged, `main` CI passes, and all version checks pass (`npm run check`).
2. Confirm no release already uses the candidate tag, including a draft. Check any previous Stable Release run before starting another.
3. Run **Actions → Stable Release → Run workflow**, selecting `main`, or use `gh workflow run release.yml --ref main`. Record the run URL and commit SHA. Read-only validation checks the stable version and runs the frontend/Rust checks. The main-only **Prepare one candidate draft** job has push permission to detect existing drafts, refuses any reused tag/release, and creates exactly one unpublished candidate.
4. Record that draft's release ID. All three platform builds upload to this ID; they do not create or look up a draft by tag. Review and approve the pending `release-signing` environment deployment for the three build jobs. An empty draft already exists at this point; it is not ready to publish.
5. Require validation, preparation, all three signed build jobs, and **Verify complete signed draft** to pass. The release must remain a draft with `prerelease: false`, tag `v1.0.0`, and the reviewed source commit. The final job has push permission to read the draft and downloads each of its eight assets by the asset IDs in that same release's metadata. It checks the release ID and upload digests, then compares every file's size/SHA-256 with independent records created after platform signature verification (after stapling on macOS). Those records must come from this workflow run and match the candidate's release ID, version and source commit. It also verifies the downloaded `SHA256SUMS.asc` using only the checked-in public key, checks exact Linux checksum coverage, and confirms website-manifest recognition of all six installers. Successful upload alone is not enough.

## Recover a failed candidate

Keep the release as a draft and inspect the failed job. For a transient failure after preparation succeeded, use **Re-run failed jobs** in the original run. This retains its source commit and prepared release ID; successful platforms' verification records remain available, and a platform that reruns replaces its own record only after its checks succeed. The final job requires all three records and rejects any changed asset that does not match them. If evidence artifacts have expired, start a fresh candidate as described below. Repeat installed-package acceptance for any rebuilt packages.

**Re-run all jobs** reruns preparation and deliberately refuses the existing draft, as does a new dispatch for the same version. To restart the entire build, first stop any active or queued release runs. Record the failed run URL, release ID and source commit. Confirm the candidate was never published and is not an accepted package set, then deliberately delete that failed draft and any corresponding unpublished candidate tag before starting a fresh run. Never remove a published release or reuse its version. If publication status is uncertain, investigate before cleanup. Fix code through a PR and record the new reviewed commit before dispatching again. Do not mix assets or verification records from separate workflow runs.

The workflow fails if GitHub cannot be queried. Keep one intentional release run active: `cancel-in-progress: false` protects the active run, but GitHub's default concurrency queue allows only one pending run, which a later dispatch can replace. An environment approval wait is separate from waiting in that concurrency queue. Check the original run's status before dispatching or approving another.

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
- **Windows:** browser-download both installers on a clean test system. Check file properties and UAC show the expected publisher, record SmartScreen behavior, then install, launch, edit/save/reopen, connect an MCP client with the installed executable, and uninstall each package.
- **Linux:** download packages and checksum files from the same draft. Follow [Verifying Linux downloads](verify-linux-downloads.md), then test AppImage launch and `.deb` installation on a supported clean system. Edit, save, reopen a note, and connect an MCP client with each installed package.
- **Upgrade:** on each platform, follow [Upgrading from beta to 1.0](transition-to-1.0.md) from a v0.8.2 installation with backed-up test data. Confirm local notes, folders/order, pins, trash, preferences, workspace connections, and MCP paths remain available. Test the MSI upgrade and the EXE installer-controlled transition separately. On macOS, remove the old Beta app bundle after verifying the new app and its data; check LaunchServices/Spotlight and the configured MCP command no longer launch the old app. Do not use an app cleaner or delete app data.

Only publish the draft after recording these acceptance results and reviewing the release notes and complete asset list. Publishing updates the website's release manifest; draft builds do not replace the public downloads.

## Final 1.0 sign-off and publication

Record the exact candidate commit/version and results under [#35](https://github.com/crims0n/scratchpad/issues/35). Complete the [final code review (#70)](https://github.com/crims0n/scratchpad/issues/70) and [documentation pass (#69)](https://github.com/crims0n/scratchpad/issues/69); resolve blocking findings and repeat affected acceptance checks after any candidate changes.

Publish the reviewed draft as a normal stable release only after sign-off. Do not recreate the beta workflow or publish a second beta copy of 1.0. Existing clients discover the same stable release through the manifest's compatibility alias.

After publishing:

1. Require the **Deploy website** workflow triggered by publication to pass.
2. Check the live website and `https://crims0n.github.io/scratchpad/release.json`: `release` and `channels.stable` must point to `v1.0.0`, with `prerelease: false` and all six final installer URLs and SHA-256 values. Download links must use the published release, not a draft or the development profile.
3. Confirm `channels.beta` is only the compatibility alias for the same stable version/tag/URL, with legacy flags for installed beta clients. Check update discovery from an installed v0.8.2 client and the stable app; same/older versions must not be offered.
4. Record website/update results under [#34](https://github.com/crims0n/scratchpad/issues/34), along with the signed build and final artifact checks. Close release-readiness issues only when their remaining acceptance criteria are complete.
