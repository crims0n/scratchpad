# Release checklist

The first stable release, **v1.0.0**, is published; its evidence is recorded in [#34](https://github.com/crims0n/scratchpad/issues/34). For subsequent releases, substitute the new candidate version/tag in the examples below. Never rebuild or reuse a published version. Build each candidate as a draft and complete review and installed-package acceptance before publication; this checklist does not itself establish those results.

The current **v1.1.0 signed draft** adds native Linux and Windows ARM64 packages. Its source/run/draft identity and verified signing evidence are recorded in the [v1.1.0 candidate acceptance record](releases/1.1.0.md); installed-package acceptance and publication remain pending.

## Build the draft

1. Confirm the release-preparation PR is merged, `main` CI passes, and all version checks pass (`npm run check`).
2. Confirm no release already uses the candidate tag, including a draft. Check any previous Stable Release run before starting another.
3. Run **Actions → Stable Release → Run workflow**, selecting `main`, or use `gh workflow run release.yml --ref main`. Record the run URL and commit SHA. Read-only validation checks the stable version and runs the frontend/Rust checks. The main-only **Prepare one candidate draft** job has push permission to detect existing drafts, refuses any reused tag/release, and creates exactly one unpublished candidate.
4. Record that draft's release ID. All five platform/architecture builds record this ID in their verification evidence; they do not access the draft. They have read-only repository permission. A separate upload job uses the prepared ID after all builds pass. Review and approve the pending `release-signing` environment deployment for the five build jobs, then the combined Linux checksum job. An empty draft already exists at this point; it is not ready to publish.
5. Require validation, preparation, all five signed build jobs, **Sign one combined Linux checksum manifest**, **Upload verified files to the candidate draft**, **Verify downloaded signed draft**, and **Confirm current signed draft** to pass.

   The release must remain a draft with `prerelease: false`, the candidate's exact tag/version, and the reviewed source commit. Only preparation, upload and live confirmation have repository write permission; none installs npm packages or loads npm dependencies.

   The upload job first checks the exact twelve local files against independent records created after platform signature verification (after stapling on macOS). It validates the prepared draft's identity and state before uploading, checks final upload digests, and downloads each asset by ID. It compares the downloads against those same records and saves an exact snapshot for the read-only verification job. Those records must come from this workflow run and match the candidate's release ID, version and source commit. There are six schema-v2 records: macOS universal, Windows x64/ARM64, Linux x64/ARM64, and the single Linux checksum pair. Each includes the candidate ID, version, commit and run; the Linux checksum job first checks both native build records before importing its signing key. Both upload and snapshot verification check the downloaded `SHA256SUMS.asc` using only the checked-in public key and require exact Linux checksum coverage. Snapshot verification also confirms website-manifest recognition of all ten installers.

   Its validated metadata output feeds a final dependency-free confirmation job, which reads the live draft from GitHub and requires the same release identity, unpublished state and exact asset IDs, sizes and digests. A changed, added or removed asset, retargeted draft, or publication between jobs fails that check. The final summary records when GitHub was checked; review the draft again before publication. Successful upload alone is not enough.

## Recover a failed candidate

Keep the release as a draft and inspect the failed job. For a transient failure after preparation succeeded, use **Re-run failed jobs** in the original run. This retains its source commit and prepared release ID; successful platforms' signed-file artifacts and verification records remain available, and a platform that reruns replaces its own artifacts only after its checks succeed. Artifact downloads stay within the same workflow run and fail on a digest mismatch. The upload job requires all six records, keeps existing draft files only when their size and digest match the verified bytes, and replaces stale expected files. If an uploaded file has the expected size but GitHub has not computed its digest yet, it waits briefly and then fails without deleting that file if the digest remains unavailable; retry later. It refuses a published or retargeted draft and any unexpected asset names. Snapshot verification requires all six records and rejects any changed file that does not match them. Final confirmation checks the live draft still matches that verified snapshot. If the file or evidence artifacts have expired, start a fresh candidate as described below. Repeat installed-package acceptance for any rebuilt packages.

**Re-run all jobs** reruns preparation and deliberately refuses the existing draft, as does a new dispatch for the same version. To restart the entire build, first stop any active or queued release runs. Record the failed run URL, release ID and source commit. Confirm the candidate was never published and is not an accepted package set, then deliberately delete that failed draft and any corresponding unpublished candidate tag before starting a fresh run. Never remove a published release or reuse its version. If publication status is uncertain, investigate before cleanup. Fix code through a PR and record the new reviewed commit before dispatching again. Do not mix assets or verification records from separate workflow runs.

The workflow fails if GitHub cannot be queried. Keep one intentional release run active: `cancel-in-progress: false` protects the active run, but GitHub's default concurrency queue allows only one pending run, which a later dispatch can replace. An environment approval wait is separate from waiting in that concurrency queue. Check the original run's status before dispatching or approving another.

## Review signing results

Record each result with the run URL in the release-preparation PR or tracking issue:

| Platform | Required pipeline evidence | Expected draft assets |
| --- | --- | --- |
| macOS | Expected Developer ID team `B62UYUQ6C3`; app and DMG notarized and stapled; Gatekeeper acceptance; hardened runtime without entitlements; native and Rosetta MCP launch checks; stapled DMG bytes match the independent signing record and final upload digest | One universal `.dmg` and `.app.tar.gz` |
| Windows | Expected publisher `Patrick McDowell`; SHA-256 signatures and trusted timestamps on both installers and their installed executables/DLLs | x64 and ARM64 `-setup.exe` / `.msi` pairs |
| Linux | Published GPG key fingerprint matches; AppImage embedded signatures cryptographically verify with only the published key; all bundled ELF files match the selected architecture; signed checksums verify with only the public key; modified checksums and packages are rejected | `_amd64.AppImage`, `_amd64.deb`, `_aarch64.AppImage`, `_arm64.deb`, and one combined `SHA256SUMS` / `SHA256SUMS.asc` |

Read the platform signing guides for detailed checks: [macOS](macos-release-signing.md), [Windows](windows-release-signing.md), and [Linux](release-signing.md).

## Install before publishing

- **macOS (Apple Silicon and Intel):** browser-download the DMG, install to Applications, and launch without a Gatekeeper bypass. Edit, save, and reopen a note; enable agent access and connect an MCP client with the installed executable.
- **Windows (x64 and native ARM64):** browser-download both installers on a clean test system. Check file properties and UAC show the expected publisher, record SmartScreen behavior, then install, launch, edit/save/reopen, connect an MCP client with the installed executable, and uninstall each package.
- **Linux (x64 and native ARM64):** download packages and checksum files from the same draft. Follow [Verifying Linux downloads](verify-linux-downloads.md), then test AppImage launch and `.deb` installation on a supported clean system. Edit, save, reopen a note, and connect an MCP client with each installed package.
- **Upgrade:** on each platform, test from the supported previous release(s) with backed-up test data. For the original Beta transition, follow [Upgrading from beta to 1.0](transition-to-1.0.md). Confirm local notes, folders/order, pins, trash, preferences, workspace connections, and MCP paths remain available. Test supported MSI and EXE transitions separately. When upgrading Beta on macOS, remove the old Beta app bundle after verifying the new app and its data; check LaunchServices/Spotlight and the configured MCP command no longer launch the old app. Do not use an app cleaner or delete app data.

Record OS, hardware/architecture, installer format, source commit and package hashes for each result. On ARM64, verify supported upgrade/package-switching paths with backed-up data and document any cross-architecture or installer-format limitation; x64 emulation and extraction alone do not establish native GUI/MCP acceptance.

Before the first ARM64 publication, complete native acceptance and verify [download selection](download-selection.md) against the real candidate: Windows/Linux x64 and ARM64, macOS Universal, manual platform/processor changes, unknown/denied hints, and unavailable-architecture behavior. Require the rendered catalog and canonical feed to contain every final installer URL/hash. Track the results in [#132](https://github.com/crims0n/scratchpad/issues/132). See [the ARM64 stable pipeline](arm64-stable-release.md) for the complete matrix and evidence flow.

Only publish the draft after recording these acceptance results and reviewing the release notes and complete asset list. Publishing updates the website's release manifest; draft builds do not replace the public downloads.

## Final sign-off and publication

Record the exact candidate commit/version, installed-package acceptance, code review and documentation sign-off in the candidate's tracking issues. For 1.0, these were [#35](https://github.com/crims0n/scratchpad/issues/35), [#70](https://github.com/crims0n/scratchpad/issues/70) and [#69](https://github.com/crims0n/scratchpad/issues/69). Resolve blocking findings and repeat affected acceptance checks after any candidate changes.

Publish the reviewed draft as one normal stable release only after sign-off. Existing Beta clients discover that same published version through the manifest's compatibility alias.

Before publishing, check **Settings → Environments → github-pages → Deployment branches and tags**, or inspect the rules without changing them from the target repository's checkout:

```sh
gh api 'repos/{owner}/{repo}/environments/github-pages/deployment-branch-policies'
```

The actual candidate tag must be allowed to deploy, and `main` must remain allowed for manual website recovery. Branch and tag rules are distinct: allowing `main` alone does not allow a release-tag event. The first stable release needed an explicit `v1.0.0` tag rule because only `main` and `scratchpad-beta-v*` were previously allowed. Future stable tags need an explicitly reviewed rule before publication; do not assume the first version's rule covers later versions. Choose any broader tag policy deliberately. The workflow must not change environment protections or signing access to make itself pass.

After publishing:

1. Require the **Deploy website** workflow triggered by publication to pass, including its separate read-only **Verify live website release** job. It uses the deploy job's exact source commit and immutable expected-manifest artifact ID, plus its actual Pages URL and repository context. Polling is outside the deployment concurrency group so recovery can deploy while an older verification is pending. The check polls canonical `release.json` for up to 12 minutes (15 seconds between attempts, requests bounded to 10 seconds and 1 MiB). It compares release metadata, stable/legacy aliases and complete installer metadata, including URLs, sizes and hashes. Only `generatedAt` is ignored so redeploying the same catalog at a different time can pass. A green `deploy-pages` step alone is insufficient.
2. Check the rendered website and canonical `release.json` at the deployed Pages URL: `release` and `channels.stable` must point to the exact reviewed candidate version/tag, with `prerelease: false` and the complete final installer set and SHA-256 values. Download links must use those published assets, not a draft or the development profile.
3. Confirm `channels.beta` is only the compatibility alias for the same stable version/tag/URL, with legacy flags for installed beta clients. Check update discovery from the supported previous installed release(s), including a legacy Beta client when validating that compatibility path, and the current stable app; same/older versions must not be offered.
4. Record website/update results in this release's tracking issue, along with the signed build and final artifact checks; the first stable release's record is [#34](https://github.com/crims0n/scratchpad/issues/34). Close release-readiness issues only when their remaining acceptance criteria are complete.

## Recover a stale website deployment

If **Verify canonical public release feed** fails, preserve the run URL, event/ref and source SHA, uploaded Pages artifact ID and its generated `release.json`, the last live verification diagnostic, and the canonical endpoint's returned metadata. Compare the expected and served release tags, aliases and installer URLs/hashes. Check whether a newer legitimate release has superseded the run before attempting recovery. Cache/propagation delays can resolve within the polling budget, but repeated stale content after the budget is a failed live check, even if the deployment API reported success.

Cache-control request headers are hints, not a guarantee that the CDN bypasses its cache. The 12-minute limit is a bounded operational budget, not a promise about the edge's TTL. Verification deliberately avoids a cache-busting query: success on a fresh query URL would not prove the ordinary URL used by existing clients is current. If a newer deployment overtakes an older verification, review that expected/live difference and the newer run instead of rolling the site back.

For v1.0.0, the release-event workflow produced a correct artifact and reported success while the site still served 0.8.2. The existing manual workflow recovered it; see [#130](https://github.com/crims0n/scratchpad/issues/130) and the [upstream report](https://github.com/actions/deploy-pages/issues/383). This symptom does not by itself prove a specific GitHub backend cause.

After reviewing the evidence, check for active or queued deployments to avoid dispatching duplicate recovery runs. A stale verification job by itself does not hold the deployment lock. Run **Actions → Deploy website → Run workflow**, selecting `main`, or run from the target repository's checkout:

```sh
gh workflow run pages.yml --ref main
```

Record that recovery run's URL/SHA. It regenerates the website catalog from published releases and uses the same post-deployment verification. Require the actual canonical feed to match and the rendered website to select the published downloads; retry the installed-client check only after the live feed is correct. If verification still fails, retain the failure and investigate Pages rather than declaring recovery complete.

Website recovery does not rebuild application packages. Keep the accepted published release, tag and assets intact. Do not replace/delete a published release or its assets, fake `GITHUB_SHA`, push empty commits directly to `main`, or automatically broaden deployment policies or workflow write permissions as a workaround.
