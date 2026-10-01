# Scratchpad Beta v0.8.0

## Highlights

- Back up and restore a complete local-only or workspace collection, including folders, ordering, pins, and trash.
- Preserve unreadable local notes and folders instead of overwriting them, with read-only protection and a recovery/export path.
- Keep intentionally empty collections empty, with a clear prompt to create or select a note before editing.
- Improve MCP collection switching, top-level folder filtering, and listener resilience.

## Complete collection backup and restore

- Choose **Back Up Collection…** in the desktop app to save the currently open collection as a versioned JSON file. Pending edits are saved first; the backup is staged, synced, and verified before replacing an existing backup file.
- Choose **Restore Collection…** to validate a backup and preview its destination and note, folder, and trash counts before confirming **Replace collection**. Restore replaces the current collection; it does not merge collections. Invalid, truncated, or unsupported files are rejected before replacement.
- Backups preserve supported note and folder metadata, including IDs, titles, bodies, timestamps, title locks, folder assignments, pins, ordering, empty folders, and deleted-note metadata. They can be restored into local-only or workspace collections; restoring a workspace keeps its file and connection.
- Before replacement, Scratchpad saves and verifies a restorable safety backup in the app data directory's `collection-backups` folder and shows its path. Keep this file until you have checked the restored data; restore it through the same menu action to undo a replacement.
- Workspace replacement uses a SQLite transaction. Local replacement uses a durable checkpoint to recover the previous values after failed or interrupted writes, including on the next launch. If recovery cannot complete, local data stays read-only and **Retry reading** retries recovery.
- Editing, collection switching, MCP writes, and closing the app are blocked while the restore dialog is open. Close other Scratchpad instances using the same collection first: backup/restore does not lock other processes.
- Backups and safety copies are **unencrypted** and include trashed note content. They exclude preferences, themes, collapsed sections, workspace paths, MCP tokens/permissions, and previous recovery archives. Store them privately and copy important backups outside the app data directory; safety copies have no automatic expiry.

## Local data preservation and empty collections

- Unreadable or structurally invalid local notes/folders no longer silently become an empty collection. Local writes are blocked while the recovery warning is active, preserving the original stored values.
- Recovery controls let you retry reading, export preserved raw data for manual recovery, or explicitly replace unreadable notes/folders only after an independent native recovery copy has been saved and verified. Healthy collection data and trash are retained by that recovery action.
- Recovery exports contain raw damaged data and are distinct from collection backups; they cannot be imported through **Restore Collection…**. Replacement through the recovery controls is desktop-only.
- Empty and trash-only restored collections remain empty after reopening. With no note selected, title and editor fields are read-only, with a prompt to create or select a scratchpad. Creating or selecting a note enables editing; no placeholder note is inserted automatically.

## MCP reliability and maintenance

- Collection switching publishes and awaits the new MCP snapshot before reopening writes.
- List/search folder filters now distinguish an omitted `folderId` (all notes) from `null` (top-level notes).
- Transient listener accept failures retry with bounded exponential backoff; unusable-listener errors stop the listener.
- Update Marked to 18.0.14, Tauri to 2.11.6, the Tauri CLI to 2.11.5, rmcp to 3.4.1, dirs to 7.0.0, reqwest to 0.13.5, and uuid to 1.26.1.

## Compatibility and beta notice

- v0.8.0 retains the existing beta application identity and packaging. No manual collection migration is required from v0.7.3; this is not the 1.0 branding or release-discovery transition.
- Existing notes, folders, trash, themes, preferences, and workspace files continue to use their existing locations. Back up important data before upgrading, and do not delete app data while recovery is pending.
- Builds are not yet production-signed; macOS and Windows may display a security warning. Automated checks do not replace installed-package acceptance testing on macOS, Windows, and Linux.
