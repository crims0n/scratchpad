# Upgrading from beta to 1.0

This is the upgrade procedure prepared for the 1.0 candidate. The current
published release is v0.8.2. Installed-package verification remains tracked in
[#33](https://github.com/crims0n/scratchpad/issues/33) and
[#35](https://github.com/crims0n/scratchpad/issues/35); the configuration changes
and automated checks alone do not establish that every platform upgrade works.

Scratchpad 1.0 will remove the visible Beta name and use one release track.
It keeps the published application identifier,
`io.github.crims0n.scratchpad.beta`, for continuity of local storage, native
recovery and safety copies, workspace preferences, and MCP discovery. The
internal suffix does not select a beta update channel. No separate collection
import is required solely because of the display-name change.

## Before upgrading

1. In the existing app, save pending edits and use **Back Up Collection…** for
   local notes and each workspace you need. Copy the backups outside the app
   data directory. Backups contain notes, folders, pins, order, and trash;
   they do not include preferences, themes, workspace paths, or MCP settings.
2. Record the workspace file locations, important preferences, and MCP client
   command. Keep workspace files and app data in place. A collection backup is
   additional protection, not a reason to delete or reset app data.
3. Resolve any recovery-required or failed-save message before proceeding.
   Quit Scratchpad and stop MCP clients that launch its executable. Do not run
   beta and 1.0 against the same data at the same time.
4. Download the candidate for your platform. Review the signing checks in the
   [release checklist](beta-release-checklist.md#review-signing-results), and
   [verify Linux downloads](verify-linux-downloads.md) before installing them.

## Install the renamed app

- **macOS:** install `Scratchpad.app` in Applications. The old
  `Scratchpad Beta.app` has a different filename; dragging the new app into
  Applications does not replace that file. Open the new app explicitly and
  check your data before removing the old application bundle. Do not use an
  app cleaner or remove its associated data. Update MCP clients to use
  `/Applications/Scratchpad.app/Contents/MacOS/scratchpad` when installed there.
- **Windows, MSI:** upgrade using the MSI installer. The 1.0 configuration
  explicitly retains the upgrade code generated for the published beta, so
  the product-name change does not create a different MSI upgrade family.
  Verify the installed path before updating your MCP client.
- **Windows, NSIS EXE:** after backing up and quitting, uninstall
  **Scratchpad Beta**, leaving any **delete application data** option unchecked.
  Install Scratchpad using the new EXE. This is an explicit uninstall/reinstall
  transition: NSIS looks up previous installations by product name, and the
  rename changes that name. Keep your backups until notes, preferences, and
  workspace connections have been checked. Update MCP clients to the new
  installed `scratchpad.exe` path. Keep the same installer format for this
  transition; switching between MSI and EXE is not an acceptance-tested path.
- **Linux, Debian package:** install the new `.deb` through the system package
  manager, for example `sudo apt install ./Scratchpad_1.0.0_amd64.deb` from its
  download directory. The new `scratchpad` package declares that it conflicts
  with and replaces `scratchpad-beta`, so both packages cannot own the same
  executable. Do not purge app data as part of the transition. The packaged
  executable remains `scratchpad`; check the MCP command after installation.
- **Linux, AppImage:** replace the AppImage at your chosen location and make
  the new file executable if needed. Update any launcher or MCP command that
  includes the old filename. Keep the old AppImage closed while checking the
  new app.

## Check data and agent access

On first launch, check local notes, folders and order, pins, trash, themes, and
supported preferences before editing. Check the remembered workspace, and use
**Open or create workspace…** to select the existing file if reconnection is
needed; do not create a replacement file over it. Restart and check persistence
again. If expected data is missing, stop and preserve the existing app data
and backups before trying recovery or restore.

Agent access starts off on each launch. Use **MCP Configuration** in the new app
to copy its actual executable path and `--mcp-stdio` argument, update the client,
then enable the required permissions and reconnect. Permission choices are not
carried over as enabled access. See the [MCP reference](mcp.md).

## Release discovery compatibility

The website and new desktop code read the preferred `release` from
`release.json`. A published stable release takes precedence over all betas,
including a beta with a higher version. Draft releases are never advertised.
Before the first stable exists, the manifest still serves the newest published
beta. The desktop retains semantic-version downgrade protection and never
offers a prerelease to an installed stable version at 1.0 or later.

Already-installed v0.7.x/v0.8.x clients read only `channels.beta` and require
legacy `channel: "beta"` / `prerelease: true` metadata. Once stable exists, the
publisher retains that entry as a compatibility alias pointing to the actual
stable tag, URL, version, and notes. These legacy metadata flags do not create
a second GitHub release or make the stable release a prerelease. Older clients
may still show their old Beta channel label until upgraded. New clients do not
use the alias. Automatic checks remain off by default; users can check manually.

## Candidate acceptance record

For each installed candidate, record the commit, release tag, package filename,
OS version and architecture, installer format, previous installed version,
results, and any defect links. Include:

- Clean installation and the supported v0.8.2 upgrade path, including cancel
  and retry where applicable, with data-bearing test profiles.
- Local notes, folders/order, pins, trash and preferences surviving the rename,
  restart, and uninstall/reinstall with app data retained.
- Existing workspace reconnection and edit/save/relaunch, with only one app
  using the file; immediate-close saves and failed-save protection.
- Installed MCP command, permissions, connection and writes, and confirmation
  that clients no longer start an old executable.
- MSI replacing the previous product, NSIS retaining data during the documented
  uninstall/reinstall, Debian replacing `scratchpad-beta`, and removal of stale
  launchers without deleting user data.
- An installed v0.8.2 client discovering the published stable release; the new
  client reporting no update to the same or an older version.

Stable packaging and publication are tracked separately in
[#34](https://github.com/crims0n/scratchpad/issues/34). Complete the broader
[#35 acceptance checklist](https://github.com/crims0n/scratchpad/issues/35)
before signing off for publication.

## Persistent packaging values

Keep the application identifier and Cargo executable name unchanged. The MSI
upgrade code is `425f5eeb-5cef-5929-8fcc-d21bcbaf7de9`, derived from the beta
product name by Tauri 2.12.3 as
`UUIDv5(DNS, "Scratchpad Beta.exe.app.x64")`. Tauri documents the effects of
[`productName`](https://v2.tauri.app/reference/config/#productname), the need to
retain [`wix.upgradeCode`](https://v2.tauri.app/reference/config/#wixconfig), and
Debian [`conflicts` / `replaces`](https://v2.tauri.app/reference/config/#debconfig).
The retained beta build override clears Debian replacement metadata to avoid
conflicting with its own package name. The remaining beta workflow is temporary
until the stable release path in #34 replaces it.
