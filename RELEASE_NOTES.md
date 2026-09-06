# Scratchpad Beta v0.7.1

## Highlights

- Fix MCP stdio authentication for beta builds by resolving the token from the merged beta application configuration.
- Connect a local MCP agent to the collection open in Scratchpad, with five read functions and eight individually enabled write functions.
- Choose exactly which functions agents can use in **MCP Configuration**. Access starts off; every time you enable it, reads start on and writes start off.
- Recover deleted notes from persistent trash. Click the bottom-right trash icon to restore a note, or right-click it to empty trash after confirmation.
- See **MCP listening** beside the save status whenever agent access is enabled.

## MCP agent access

Open **Scratchpad menu → Agent access** and turn access **On**. **MCP Configuration** provides the executable path, the `--mcp-stdio` argument, copy buttons, and a generic JSON example for clients that launch local stdio MCP servers. Scratchpad must remain open. No separate server or runtime is required.

| Read functions — enabled by default when access starts | Write functions — individually opt in |
| --- | --- |
| `list_folders` — folder IDs, names, revisions, and note counts | `create_note` — create a titled note, optionally in a folder |
| `list_notes` — note metadata and previews | `create_folder` — create a folder |
| `search_notes` — search titles and Markdown | `append_to_note` — append exact text to an existing note |
| `get_note` — read note content and its revision | `rename_note` — set and lock a note title |
| `list_trash` — deleted-note metadata | `move_note` — move to a folder or the top level |
| | `rename_folder` — rename without changing note assignments |
| | `delete_note` — move a note to recoverable trash |
| | `delete_folder` — remove an empty folder |

- Select individual permissions or all functions within the **Read** or **Write** section. Changes apply immediately to connected clients. Permissions reset when access is restarted.
- Agents read the current collection, including unsaved edits. Opening or disconnecting a workspace changes the collection they see.
- Writes require the current collection ID and a request ID. Existing-item changes also check a revision, preventing a stale request from overwriting intervening edits.
- Retry the same request ID with identical arguments after a timeout or save failure. Accepted changes that fail to save remain visible with **Save failed**; a retry saves without applying them twice.
- `move_note` accepts an explicit JSON `null` destination for the top level. Omission and the string `"null"` are not substitutes.
- MCP folder deletion requires an empty folder, including any pinned notes assigned to it. There is no cascading deletion or whole-note replacement.
- Access uses an authenticated local channel. Scratchpad itself sends no notes to a service; the connected agent may send returned content to its model provider.

See the [MCP reference](https://github.com/crims0n/scratchpad/blob/scratchpad-beta-v0.7.1/docs/mcp.md) for setup, parameters, pagination, limits, and recovery behavior. If you tested an earlier HTTP configuration, replace its URL and authorization header with the local stdio command and argument.

## Trash and recovery

- **Delete Note** is available in the note's right-click menu. Both it and the sidebar delete button use the same recovery path as MCP deletion.
- Trash retains full Markdown, titles, pin state, title-lock state, and original folder information. It is separate for local notes and each workspace, survives restarts, and has no automatic expiry.
- Click the trash icon and choose **Restore**. Notes return to their original folder, or the top level if that folder no longer exists. Restoration cannot overwrite an active note with the same ID.
- Right-click the icon, or focus it and press **Shift+F10**, then choose **Empty Trash…**. Confirmation defaults to Cancel. Notes deleted after the confirmation opens are retained.
- Agents can list trash metadata, but cannot read trashed note bodies, restore notes, or empty trash. Permanent removal is available only through the user interface.
- Deleting the last active note leaves a new blank note. Deleting a folder from the sidebar continues to return its notes to the top level.

## Interface and reliability

- **Workspace** is now the first section in the Scratchpad menu. The Agent access On/Off toggle matches the appearance controls and keeps the menu open when changed.
- **MCP Configuration** remains available while access is off. Function permissions appear above the generic configuration example, which wraps without an internal scrollbar.
- Menu labels, spacing, and alignment are consistent. The listening dot uses the interface accent color alongside the existing save or workspace-file status.
- SQLite structural changes commit notes, folders, and trash together, with folder-reference validation. Save queues coordinate agent changes, typing, workspace switching, and window close.
- Local deletion writes recovery data before removing active notes. Interrupted local saves may retain duplicate recovery copies rather than lose a note. Confirmed Empty Trash can free local storage after a quota failure.
- The README, welcome note, About text, and Help reference now cover agent access and note recovery.

## Compatibility and beta notice

- Existing local notes, folders, preferences, and workspace files continue to work. SQLite workspaces gain an additive trash table automatically; no manual migration is required.
- Local notes and workspace notes remain separate. An empty workspace is seeded with active notes and folders; local trash stays local. A workspace containing only trash opens its own collection.
- Agent access is off on launch. Reconnect your client after restarting Scratchpad or re-enabling access. Old collection IDs and retry receipts do not survive a collection session change.
- Trash protects deletions made with this version; it cannot recover notes permanently deleted by earlier versions. Keep backups of important workspace files.
- v0.7.1 retains the existing beta application identity and packaging. Builds are not yet production-signed; macOS and Windows may display a security warning.
