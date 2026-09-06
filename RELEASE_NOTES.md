# Scratchpad Beta v0.7.2

## Highlights

- Check for updates from **Scratchpad menu → About Scratchpad**, and read the release notes inside the app before deciding to download.
- Opt into quiet automatic update checks, off by default, with separate Beta and Stable release channels.
- Type more smoothly while comparing large notes: live comparisons refresh after a brief pause instead of recalculating on every input frame.
- Open an empty remembered workspace reliably when your local collection contains folders but no notes.

## Optional update checks

- About shows the installed version, release channel, last check time, and any available update. The About menu item and a quiet menu indicator show when a newer release is available.
- **Read release notes** expands the specific release’s notes inside the app. Notes are displayed as plain text without loading remote images.
- **Download Update** opens that version’s GitHub release page in your browser. **Later** closes the panel; **Skip This Version** suppresses background notices for that version. Manual checks can still reveal a skipped release.
- **Automatically check for updates** is off by default. When enabled, checks run shortly after launch and at most once every 24 hours, including failed attempts. The preference, last attempt time, and skipped version are saved locally.
- Checks contact GitHub Pages for public release information. GitHub receives normal connection information such as your IP address, but no notes or workspace data. Background failures do not interrupt editing; manual failures offer **Retry**.
- Beta and Stable releases stay separate. Semantic-version comparison prevents older releases published later from being offered as updates or downgrades.
- Turning automatic checks off cancels future checks; a request already sent may finish. Scratchpad never installs updates automatically.

## Comparison and workspace reliability

- Live note comparison waits for a 150 ms pause in typing and reuses results when neither note has changed. Opening Compare still computes the initial comparison immediately.
- While a comparison is pending, the toolbar shows **Updating comparison…** and old diff highlights are hidden so they do not mark the wrong text. Closing Compare or changing the selected notes cancels pending work.
- Startup seeding now saves a folders-only local collection into an empty remembered workspace in one transaction. If the save fails, Scratchpad falls back to local notes without leaving a partially seeded workspace or reporting a successful connection.

## Maintenance

- Updated the Rust dependencies and GitHub Pages deployment action.
- Updated the README, in-app Help, welcome guide, and MCP privacy reference for optional update checks.

## Compatibility and beta notice

- Existing local notes, folders, trash, and workspace files continue to work; no manual migration is required from v0.7.1.
- Existing welcome notes are left untouched. The updated guide is used for newly created welcome notes.
- v0.7.2 retains the existing beta application identity and packaging. Builds are not yet production-signed; macOS and Windows may display a security warning.
- This release adds update discovery and download links, not in-app installation. Install downloaded packages using the usual platform process.
