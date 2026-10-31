# Scratchpad documentation

## Using Scratchpad

- [README and first steps](../README.md): installation, editing, shortcuts, collections, backup/restore, trash, and recovery.
- **In-app Help & reference**: open from the Scratchpad menu, **Cmd/Ctrl+/**, or **F1**. The Guide, Keyboard Shortcuts, Markdown Cheatsheet, and MCP Functions topics are bundled and work offline. **Tab / Shift+Tab** switches topics; **Escape** closes Help.
- [Welcome note source](../src/welcome-note.js): the editable onboarding note created for a fresh local collection. Startup also creates it when initializing a workspace with no readable local notes to copy. Local folders are copied only when the local collection is not in recovery mode. Unreadable local data is not copied into that workspace. Updating the app does not overwrite existing notes or insert the guide into an initialized, intentionally empty collection.
- [MCP agent access](mcp.md): installed-client configuration, permissions, tools, revisions, retries, and privacy.
- [Upgrading from beta to 1.0](transition-to-1.0.md): data continuity, installer differences, workspace reconnection, and MCP paths.
- [Verifying Linux downloads](verify-linux-downloads.md): public key, signed checksums, and verification commands.
- [Choosing a download](download-selection.md): OS/processor selection, detection limits, unavailable packages, and per-package checksums.
- [Release notes](../RELEASE_NOTES.md) and [security policy](../SECURITY.md).

The [product website](https://crims0n.github.io/scratchpad/) lists published downloads. Draft candidates do not replace the public release catalog.

## Contributing

- [Contributing](../CONTRIBUTING.md): prerequisites, isolated development profile, branch/PR workflow, and validation.
- [Architecture and data flow](architecture.md): runtime diagrams, source ownership, storage and recovery, MCP, quit handling, and release handoff.
- [Third-party notices](../THIRD_PARTY_NOTICES.md), [license](../LICENSE), and [app store exception](../APP_STORE_EXCEPTION.md).

## Maintaining releases

Start with the [release checklist](release-checklist.md). It links the required source review, installed-package acceptance, and publication records. A passing source test or signing job does not establish that every native installation/upgrade scenario has passed.

The [v1.1.0 release record](releases/1.1.0.md) records publication, verified signed/public downloads, the live feed and the maintainer's acceptance of documented gaps. Per-platform evidence, functional/MCP/uninstall checks, upgrades, visual catalog verification and installed-client update discovery remain open.

- [macOS signing and notarization](macos-release-signing.md).
- [Windows signing](windows-release-signing.md).
- [Linux signing, key rotation, and revocation](release-signing.md).
- [ARM64 build feasibility](arm64-build-feasibility.md): isolated unsigned package checks for future Linux and Windows ARM64 release support.
- [ARM64 signing validation](arm64-signing-validation.md): credential-free Windows prerequisite checks and protected main-only signed development packages.

Use one stable release stream. Development builds use a separate identity; the released app retains its historical `.beta` identifier for data and installation continuity, not as a channel selector.
