# Scratchpad v1.1.0

## Highlights

- Native ARM64 packages join the stable release: Windows ARM64 EXE/MSI installers and Linux ARM64 AppImage/DEB packages. Windows and Linux x64 packages and the macOS Universal package remain available.
- The download website includes operating-system and processor choices. Supported browser architecture hints can suggest a matching download; otherwise, choose your processor manually. macOS uses Universal for Apple Silicon and Intel. Each package lists its size and SHA-256 hash.
- All four Linux packages share one signed `SHA256SUMS` manifest. Windows installers and their application payloads retain Authenticode signing and timestamps; macOS packages retain Developer ID signing, notarization and stapling.

## Choosing a package and upgrading

Choose the package for your operating system and processor. Windows/Linux **ARM64** packages require an ARM64 system; **x64 (Intel / AMD)** packages target x64 systems. See [Download selection](https://github.com/crims0n/scratchpad/blob/main/docs/download-selection.md) for browser detection limits and manual selection.

Before upgrading from v1.0.0, back up local notes and workspace collections, resolve any failed-save or recovery message, and quit Scratchpad and its MCP clients. Keep the same processor architecture and installer format for a routine upgrade. AppImage users should replace their chosen file and update launchers and MCP commands if its path changes.

The production app/data identity and executable names are retained. Check notes, folders/order, pins, trash, preferences, workspace reconnection and MCP access after installation and restart. Collection backups do not include preferences or MCP configuration; preserve those separately. Do not delete app data or use an app cleaner during an upgrade.

The first native ARM64 packages have no earlier native stable package to upgrade from. Switching an emulated x64 installation to ARM64, or changing installer formats, requires separate acceptance testing; do not assume these paths preserve an existing installation. The [v1.1.0 candidate record](https://github.com/crims0n/scratchpad/blob/main/docs/releases/1.1.0.md) tracks the required results before publication. Beta users should also follow [Upgrading from beta to 1.0](https://github.com/crims0n/scratchpad/blob/main/docs/transition-to-1.0.md).

## Verification and limitations

Verify Linux downloads with `SHA256SUMS`, `SHA256SUMS.asc` and the published release-signing key, following [Verifying Linux downloads](https://github.com/crims0n/scratchpad/blob/main/docs/verify-linux-downloads.md). The manifest covers both architectures; use the entry for your exact filename. Launching an AppImage does not automatically validate its signature, and a directly downloaded Debian package requires explicit verification.

Windows signatures identify Patrick McDowell as the publisher; SmartScreen may still warn while download reputation builds. Signing and automated payload checks do not establish native installed-package acceptance. The candidate remains unpublished until its package, upgrade and MCP checks are recorded.

Notes, workspace files, backups, trash and recovery copies are unencrypted. Do not run multiple instances against the same collection or workspace file. Keep important backups outside the app data directory. Update checks remain optional, off by default, and installation is manual.
