# Scratchpad Beta v0.8.2

## Highlights

- Linux packages are now signed. Each release includes a `SHA256SUMS` file covering the AppImage and `.deb`, signed with the Scratchpad release-signing key as `SHA256SUMS.asc`. The AppImage also carries an embedded GPG signature.
- The website's new **Verify Linux packages** section publishes the release-signing key and its full fingerprint, `1AD2 0240 0B0C 14AD 86F4 3E14 4F6B 122C D9DC CB40`, with step-by-step verification instructions.

## Release signing

- The release workflow signs Linux artifacts with a dedicated signing subkey held in a protected environment. A signing or verification failure stops the release.
- Before publishing, the workflow verifies the final uploaded packages using only the published key, and confirms that modified packages or checksums are rejected.
- Launching an AppImage does not check its signature, and `apt`/`dpkg` do not verify a `.deb` you downloaded directly. Use the `SHA256SUMS` procedure to verify either package before installing.
- Application features and behavior are unchanged from v0.8.1. See the v0.8.1 release for the CodeMirror 6 editors, format detection, section folding, HTML export, and printing.

## Compatibility and beta notice

- v0.8.2 retains the existing beta application identity and packaging. No manual collection migration is required from v0.8.0 or v0.8.1.
- Existing notes, folders, trash, themes, preferences, and workspace files continue to use their existing locations. Back up important data before upgrading, and do not delete app data while recovery is pending.
- macOS and Windows builds are not yet production-signed and may display a security warning. Automated checks do not replace installed-package acceptance testing on macOS, Windows, and Linux.
