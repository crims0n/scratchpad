# Scratchpad Beta v0.6.0

## Highlights

- Organize scratchpads into collapsible folders from the sidebar. Drag notes onto folders, reorder folders, or use each folder's context menu to add notes, rename, move, and delete it.
- Compare two notes live in Dual-Note Split View. Scratchpad highlights removed source on the left and added source on the right without changing either note.
- Pinned notes now stay at the very top of the sidebar as top-level notes. Notes without a folder remain below folders instead of appearing in a synthetic “Unfiled” section.
- Folder structure and note assignments persist in both local storage and portable SQLite workspaces.

## Folder organization

- Create folders with the new sidebar folder button, collapse them to reduce clutter, and drag them into the preferred order.
- Drag a note onto a folder or choose **Move to Folder** from its context menu. Deleting a folder safely returns its notes to the top level rather than deleting them.
- Sidebar search temporarily expands matching folders while preserving their collapsed state for later.
- Pinned notes retain their previous folder assignment so unpinning returns them to the right place. Creating or importing from a pinned note correctly creates at the top level.
- The secondary-note selector groups ordinary notes by folder while leaving pinned and folderless notes at the top level.

## Note comparison

- Choose **Compare** while two different notes are open side by side to enable line-level and contiguous substring highlighting.
- The comparison count reports changed lines, updates as either note is edited, and uses a change rail so blank-line and whitespace-only differences remain visible even when line numbers are off.
- Comparison composes with Markdown syntax coloring and Find highlights, and turns off automatically when split view closes or both panes show the same note.
- Split-view headers now align both notes side by side, with each title positioned consistently and the secondary-note selector beside its title.

## Interface and reliability

- Subtle dividers distinguish pinned notes, folders, and top-level notes without adding empty sidebar sections.
- The About dialog now gives a fuller description of Scratchpad's local-first, cross-platform design and privacy model.
- Closing Dual-Note Split View immediately clears its temporary enabled notification.
- Workspace structural updates save folders and notes in one SQLite transaction. Failed workspace loads or first-time seeds leave the local collection intact.
- jsdiff 9.0.0 is bundled with the application for offline note comparison under its BSD 3-Clause License.

## Compatibility

- Existing local notes, pinned state, sidebar order, preferences, and Markdown editing settings remain intact.
- Existing SQLite workspace files are upgraded automatically with optional folder assignments and a folders table; no manual migration is required.
- Local notes and workspace notes remain separate collections when connecting or disconnecting a workspace.
- Scratchpad remains fully offline; jsdiff is bundled locally and no note content is sent to an external service.

## Beta notice

Back up important workspace files before testing. These builds are not yet production-signed, so macOS and Windows may display a security warning.
