# Scratchpad v1.1.0

## Highlights

- Native ARM64 packages join the stable release: Windows ARM64 EXE/MSI installers and Linux ARM64 AppImage/DEB packages. Windows and Linux x64 packages and the macOS Universal package remain available.
- The download website includes operating-system and processor choices. Supported browser architecture hints can suggest a matching download; otherwise, choose your processor manually. macOS uses Universal for Apple Silicon and Intel. Each package lists its size and SHA-256 hash.
- All four Linux packages share one signed `SHA256SUMS` manifest. Windows installers and their application payloads retain Authenticode signing and timestamps; macOS packages retain Developer ID signing, notarization and stapling.

## Choosing a package and upgrading

Choose the package for your operating system and processor. Windows/Linux **ARM64** packages require an ARM64 system; **x64 (Intel / AMD)** packages target x64 systems. See [Download selection](https://github.com/crims0n/scratchpad/blob/main/docs/download-selection.md) for browser detection limits and manual selection.

Before upgrading, back up local notes and workspace collections, resolve any failed-save or recovery message, and quit Scratchpad and its MCP clients. AppImage users should replace their chosen file and update launchers and MCP commands if its path changes.

The production app/data identity and executable names are retained. Check notes, folders/order, pins, trash, preferences, workspace reconnection and MCP access after installation and restart. Collection backups do not include preferences or MCP configuration; preserve those separately. Do not delete app data or use an app cleaner during an upgrade.

The first native ARM64 packages have no earlier native stable package to upgrade from. Switching an emulated x64 installation to ARM64, or changing installer formats, is a separate migration; do not assume these paths preserve an existing installation.

## Upgrading directly from Beta

The [Beta-to-stable upgrade guide](https://github.com/crims0n/scratchpad/blob/main/docs/transition-to-1.0.md) also applies when upgrading directly to v1.1.0. Keep the same processor architecture and installer format for this transition.

- On macOS, install `Scratchpad.app` and check your data before removing the old `Scratchpad Beta.app` bundle. Keep its associated app data and update MCP clients to the new app path.
- Windows MSI retains the Beta upgrade family. The EXE installer detects the old per-user Beta installation and removes it with app-data deletion disabled; close Beta and its MCP clients first. A locked executable or failed removal stops the transition.
- The Debian package replaces `scratchpad-beta`. AppImage users should replace their chosen file and update launchers and MCP commands containing the old filename.

## Verification and limitations

The Linux checksum manifest covers both architectures; use the entry for your exact filename.

Windows signatures identify Patrick McDowell as the publisher; SmartScreen may still warn while download reputation builds.

Notes, workspace files, backups, trash and recovery copies are unencrypted. Do not run multiple instances against the same collection or workspace file. Keep important backups outside the app data directory. Folding remains limited to 100,000 characters and 10,000 lines. Encryption, remote sync, dedicated PDF export and in-app update installation are not included; native printing can save to PDF where the operating system supports it. Update checks remain optional, off by default, and installation is manual.
