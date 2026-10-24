# Scratchpad v1.0.0

## Highlights

- Scratchpad's first stable release brings the existing local-first Markdown editor, dual-note view and comparison, search, folders, persistent trash, themes, and optional local MCP agent access into one release stream.
- macOS universal packages are Developer ID-signed and notarized. Windows EXE/MSI installers and installed executables are Authenticode-signed and timestamped. Linux AppImage and Debian downloads are covered by a GPG-signed checksum manifest; the AppImage also carries an embedded signature.
- Complete collection backup/restore and guarded local collection clearing retain verified safety copies. Unreadable local data is preserved for recovery instead of being silently replaced.
- Updates use one preferred release feed. Existing beta clients can discover 1.0, and newer clients no longer select a channel from the internal application identifier. Update checks remain optional and off by default; installation is manual.

## Upgrading from beta

Back up local notes and workspace collections, resolve any failed-save or recovery message, and quit Scratchpad and its MCP clients before upgrading. Follow [Upgrading from beta to 1.0](https://github.com/crims0n/scratchpad/blob/main/docs/transition-to-1.0.md) for the platform-specific procedure.

- Existing data locations and the published executable name are retained. Do not delete or reset app data during the transition.
- On macOS the new app is `Scratchpad.app`. The old `Scratchpad Beta.app` has a different filename; remove the old application bundle after checking the new app, without removing its associated data. Update MCP clients to the new application path.
- The Windows MSI retains the beta upgrade identity. The EXE installer detects the old per-user Beta install, removes it with app-data deletion disabled, and stops if the previous executable is locked or removal fails. Use the same installer format for this transition and update MCP paths as needed.
- The Debian package replaces `scratchpad-beta`. AppImage users should replace their chosen file and update launchers/MCP commands containing the old filename.
- Check local notes, folders/order, pins, trash, preferences, and workspace reconnection after installation and restart. Collection backups do not include preferences or MCP configuration.

## Verification and limitations

Verify Linux packages using `SHA256SUMS`, `SHA256SUMS.asc`, and the published release-signing key. Follow [Verifying Linux downloads](https://github.com/crims0n/scratchpad/blob/main/docs/verify-linux-downloads.md). Launching an AppImage does not automatically validate its signature, and a directly downloaded Debian package requires explicit verification.

Windows signatures identify Patrick McDowell as the publisher; SmartScreen may still warn while download reputation builds. Signing and automated checks do not replace installed-package acceptance on each supported platform.

Notes, workspace files, backups, trash, and recovery copies are unencrypted. Do not run multiple instances against the same collection or workspace file. Keep important backups outside the app data directory. Folding remains limited to 100,000 characters and 10,000 lines. In-app update installation, encryption, remote sync, and dedicated PDF export remain outside 1.0; native printing can save to PDF where the operating system supports it.
