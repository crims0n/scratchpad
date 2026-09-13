# MCP agent access

Scratchpad includes an MCP stdio mode in the desktop executable. There is
no separate server executable or runtime to install. Open **Scratchpad menu →
Agent access → On** while the app is running. Choose **MCP Configuration** to
copy connection values and select function permissions. Configuration is also
available while access is off; copying it does not start the server.

Access is off each time Scratchpad starts. Disabling it stops access and
disconnects active MCP sessions. Enable it before starting or reconnecting the
client; clients do not all retry a server that was unavailable at startup.
The accent-colored **MCP listening** indicator appears beside the save status
while access is enabled. It indicates that the server is listening, even when no
client is connected. Hover it to see the enabled read and write counts.

## Client compatibility

Use a client that supports launching a local MCP server over stdio. Enter the
values shown in the configuration dialog as follows:

| Client field | Value |
| --- | --- |
| Transport | stdio (sometimes called local or command) |
| Command | The displayed absolute path to the Scratchpad executable |
| Arguments | `--mcp-stdio`, as a single argument |
| Environment variables | None required |
| URL, headers, bearer token | None required |

The dialog provides copy buttons and a generic JSON example using the actual
executable path. A typical configuration has this shape; substitute the command
shown by your installation and adapt the surrounding keys to your client:

```json
{
  "mcpServers": {
    "scratchpad": {
      "command": "/Applications/Scratchpad.app/Contents/MacOS/scratchpad",
      "args": ["--mcp-stdio"]
    }
  }
}
```

The command is an executable path, without shell quoting or arguments appended
to it. On macOS, point to the executable inside the installed `.app`, not the
`.app` directory or `open`. On Windows, use the installed `.exe`; JSON requires
backslashes to be escaped (the copied example handles this). On Linux, use the
installed executable. For AppImage installations, the dialog uses the outer
`.AppImage` path when available, avoiding the temporary mounted executable.
Moving or reinstalling Scratchpad at a different location requires updating
the command.

The client launches a background instance of the same binary. This instance
does not open a window, load note storage, or automatically enable access. It
relays MCP messages to the open editor, which owns the current collection.
Multiple clients can connect independently. Diagnostics go to stderr; stdout
contains only MCP messages. Closing the client's input or disabling access
ends the background instance. Reconnect the client after restarting Scratchpad
or re-enabling access.

This replaces the earlier Streamable HTTP configuration: remove the old URL
and authorization header and configure a local stdio server instead. Clients
that accept only remote URLs cannot use this mode. A cloud-hosted connector
cannot launch a local executable. Packaged `.mcpb` distribution is a separate
packaging task; this implementation does not generate a bundle.

## Read tools

| Tool | Result |
| --- | --- |
| `list_folders` | Folder ids, names, revisions, and assigned-note counts |
| `list_notes` | Note metadata, folder names, and short previews |
| `search_notes` | Literal, case-insensitive title and Markdown search |
| `get_note` | One character-addressed chunk of a note's Markdown content |
| `list_trash` | Deleted-note IDs, titles, original folder metadata, and deletion times |

List and search calls accept `limit` and `offset` and return `nextOffset` when
another page exists. `get_note` returns at most 20,000 characters by default;
follow its `nextOffset` until `truncated` is false. These offsets count Unicode
characters, not UTF-8 bytes. `list_notes` and `search_notes` also accept an
optional `folderId`. Omit `folderId` to include every folder, pass a folder ID
to filter to that folder, or pass `null` to include only top-level notes.

### Function permissions

The Agent access section of the actions menu contains only the global
**Agent access On/Off** toggle and **MCP Configuration**. Configuration
is always available: while access is off, you can copy connection details without
starting the server. Permission controls become available when access is enabled.
Open Configuration to choose individual functions in the **Read** and **Write**
sections. Each section has a **Select all** checkbox; a partially selected
section shows a mixed state.

Each time agent access starts, all five read functions are enabled and all eight
write functions are disabled. Select specific write functions or **Select all
write functions** to allow them. Read functions can also be disabled individually.
Changes apply immediately to connected clients without reconnecting. Disabled
tools remain discoverable but reject calls. Failed permission updates restore
the previous choices and show an error in Configuration.

Choices last until agent access is disabled or the app closes; closing and
reopening Configuration preserves them. New sessions always start with reads
on and writes off. Content replacement and permanent deletion are not exposed.

## Creating notes and folders

Both tools require `collectionId` from a current read result and a unique
`requestId` (1–128 characters). Reuse the **same request ID and arguments** when
retrying after a timeout or lost response. Successful retries return the original
result without creating another item. Reusing a key with different arguments
is rejected.

| Tool | Other arguments | Result |
| --- | --- | --- |
| `create_note` | Required `title`; optional `content` (empty by default), `folderId` (top level by default) | Saved `note`, including generated ID |
| `create_folder` | Required `name` | Saved `folder`, including generated ID |

Titles and folder names must contain 1–200 characters after trimming; content
is limited to 100,000 UTF-8 bytes, within the overall 256 KiB request limit.
Folder names follow the sidebar's whitespace, duplicate-name, and reserved-name
rules. Unknown folder IDs are rejected. Explicit note titles are locked against
automatic title generation; created notes start unpinned. New items appear in
the sidebar without changing the selected note or editor focus.

Example (replace the collection ID with one from `list_folders`):

```json
{
  "name": "create_note",
  "arguments": {
    "collectionId": "<current collection ID>",
    "requestId": "research-note-001",
    "title": "Research findings",
    "content": "# Findings\n\nFirst observation."
  }
}
```

### Persistence and concurrency

Creation runs through the editor's save queue, alongside SQLite saves. Queued
editor saves take their snapshot when they execute, so they retain preceding
MCP creations. SQLite creations save the complete notes/folders collection in
one transaction, with folder-reference validation. Local note creation saves active notes alongside recovery data; folder creation
saves the folders key, also saving recovery data if a deletion is pending. New items are published to the live collection
after persistence succeeds; failures publish nothing. Edits made while a write
is in flight are preserved and saved through the normal editor path.

Workspace switches and app close wait for in-flight writes and reject new
ones while transitioning. Disabling a permission rejects its queued writes and lets
already-started saves finish. A response timeout does not cancel a save: its
outcome is unknown, so retry with the same ID and arguments.

Retry receipts are held for the current collection session, across client
reconnects and access toggles. Switching/opening a workspace (including a
cancelled switch attempt) or restarting the app changes `collectionId`; old
requests are rejected. Up to 1,000 distinct write requests are retained per
collection session. At that limit, new requests are rejected without evicting
old retry keys; reopen the collection to begin a new session. After a session
change, inspect existing notes before resubmitting an old write with an unknown outcome.

Write tools are marked idempotent and closed-world. Deletion tools have
`destructiveHint: true`; the other write tools have it set to false. All writes have
`readOnlyHint: false`. Each permission toggle applies to all authenticated local clients.

## Appending to existing notes

Select **MCP Configuration → Write → Append to note**. This permission is
independent of **Create note** and **Create folder** and starts off each time
agent access starts.

1. Call `get_note` and retain its `collectionId`, note `id`, and `revision`.
2. Call `append_to_note` with those values as `collectionId`, `noteId`, and
   `expectedRevision`, plus a unique `requestId` and the `content` to append.
3. Include your own separating newlines; the tool appends the supplied text
   exactly. Each append accepts 1–100,000 UTF-8 bytes.

```json
{
  "name": "append_to_note",
  "arguments": {
    "collectionId": "<from get_note>",
    "requestId": "meeting-followup-001",
    "noteId": "<note id>",
    "expectedRevision": "<from get_note>",
    "content": "\n\n## Follow-up\nNew observation."
  }
}
```

Revision tokens are opaque and cover the whole live note: content, title,
modification time, pin state, title-lock state, and folder assignment. They
include unsaved edits. Tokens stay stable while the note is unchanged and
expire across collection sessions. When reading a note in chunks, restart the
read if the revision changes between chunks.

The editor checks the expected revision when the queued append starts, before
applying any text. A conflict changes nothing: reread the note and decide
whether to submit a new append. The append preserves the title and other
metadata and advances the modification time. It preserves the active editor,
selection, and scroll position.

Once accepted, the append appears as an ordinary editor change while it saves.
Typing after that point operates on the appended text and is preserved. Success
is returned only after persistence; the response includes the saved `note` metadata and
its `revision`. Read content through paginated `get_note` calls. Later user edits can make that returned revision stale.

If persistence fails, **the appended text remains in the editor and the status
shows Save failed**. The tool explicitly reports that it was applied but not
saved. Retry the same `requestId` with identical arguments to save the current
note without appending again, including any subsequent user edits. Do not use a
new request ID for that retry. A note deleted by the user is never recreated by
retrying an append. Successful retries return the original saved result.

## Renaming and moving

Enable each tool separately in **MCP Configuration → Write**, or select all write
functions. These permissions start off alongside the other write permissions.
All three tools require the current `collectionId`, a unique `requestId`, and an
`expectedRevision` read before making the change.

| Tool | Revision source | Other required arguments | Behavior |
| --- | --- | --- | --- |
| `rename_note` | `get_note` | `noteId`, `title` | Sets and locks the title against automatic generation |
| `move_note` | `get_note` | `noteId`, `folderId` | Moves to an existing folder; explicitly pass `null` for top level |
| `rename_folder` | `list_folders` | `folderId`, `name` | Changes the folder name while preserving its ID and assigned notes |

Renames accept 1–200 characters after trimming. Folder names follow the sidebar's
whitespace normalization, case-insensitive duplicate, and reserved-name rules.
A folder currently being renamed in the sidebar rejects an MCP rename until the
user finishes. Moving to a missing folder is rejected; the destination must be
supplied explicitly. Note changes preserve content, pin state, and selection,
and advance the modification time. Folder renames preserve note revisions and
folder order. Folder revisions cover the name, remain stable when membership
changes, and expire when the collection changes.

```json
{
  "name": "move_note",
  "arguments": {
    "collectionId": "<from get_note>",
    "requestId": "organize-note-001",
    "noteId": "<note id>",
    "expectedRevision": "<from get_note>",
    "folderId": null
  }
}
```

This example moves to the top level using JSON `null`, without quotes. To move
into a folder, replace `null` with a quoted destination ID from `list_folders`.
The schema requires `folderId` and accepts a string or null; omitting it is an
error, and the string `"null"` is not a top-level destination.

Revisions, permissions, target existence, destination existence, and folder-name
availability are checked when the queued operation starts. Conflicts change
nothing; reread the target before deciding on a new request. Accepted changes
appear in the editor immediately, and success is returned after saving. SQLite
uses the existing complete-workspace transaction with folder-reference validation;
local note saves also preserve trash recovery data; folder-only saves update the
folders key unless recovery data is pending.

Responses include saved `note` metadata or `folder` data plus the new `revision`.
If a save fails, the change remains visible with **Save failed**. Retry identical
arguments with the same request ID to save the current state without reapplying
the change or overwriting subsequent user edits. Deleted targets are never
recreated by retries. Successful retries return the original saved result;
later edits may have made its revision stale. The same session and retry limits
as the other write tools apply.

## Deleting and recovering notes

`delete_note` moves a note to persistent trash. It requires `collectionId`, a
unique `requestId`, `noteId`, and the current `expectedRevision` from `get_note`.
`delete_folder` requires `collectionId`, `requestId`, `folderId`, and the current
`expectedRevision` from `list_folders`. Each has a separate permission that starts
off. Revisions and permissions are rechecked when the queued deletion executes.

Folder deletion through MCP is **empty-only**. Pinned notes still count as
members of their underlying folder. Move all assigned notes elsewhere first;
there is no cascading deletion. Empty folders are removed directly and can be
recreated. The existing sidebar folder-delete action continues to move its notes
to the top level.

A deleted note's trash entry retains its full Markdown, ID, title, pin and title
lock state, original folder ID/name, and deletion time. If the last active note
is deleted, Scratchpad creates a blank note at the top level. Sidebar and
right-click note deletion use the same recovery path as MCP.

Accepted deletions update the editor immediately. SQLite commits active notes,
folders, and trash in one transaction. Local storage saves the recovery copy
before removing the active note. An interrupted local save may leave a recovery
copy alongside an active note; it cannot lose both copies. An unreadable trash
collection is preserved, and recovery-changing writes fail rather than overwrite
it. Failed deletions remain visibly unsaved; retry the **same request ID and
identical arguments**, including the original revision, to persist the current
state without deleting again. A retry never deletes a note that the user has
subsequently restored. The usual collection-session retry limits apply.

`delete_note` returns the deleted note's trash metadata under `trash`, including
the trash entry `id` and original `noteId`. `delete_folder` returns `folderId`.
`list_trash` returns `collectionId`, `collectionName`, a `trash` metadata array,
and `nextOffset`. It accepts `limit` (1–200, default 50) and `offset`, and lists
newest entries first. This read permission starts enabled along with the other
read functions. Trashed note bodies are not exposed through `list_trash`,
`get_note`, or search.

The **trash icon at the right of the status bar** opens a list with Restore
buttons. Restoration preserves content, title, pin and title-lock state and
returns the note to its original folder, or to the top level if that folder no
longer exists. It advances the modification time to invalidate old revisions.
It refuses to overwrite an active note with the same ID.

Right-click the trash icon (or use Shift+F10 while it is focused) and choose
**Empty Trash…** for a confirmation. Cancel is focused by default. Only the
entries present when confirmation opened are selected; notes deleted while it
is open are retained. Emptying trash is permanent. For local storage, confirmed emptying removes the
selected recovery copies first so it can free space after a quota failure; an
interruption may leave an older active copy on disk. Trash is scoped to the local
collection or current workspace database and survives restarts. There is no
automatic expiry.

**MCP exposes no restore, empty, purge, or permanent-delete function.** Agents
can list trash metadata and move active notes into it; only the user can restore
notes or empty trash through the UI.

## Live data and privacy boundary

The editor's in-memory collection is authoritative for MCP. A connected agent
can therefore read local notes or an open portable workspace, and it sees
keystrokes shortly after they are entered even if Scratchpad's persistence
debounce has not saved them yet. Switching collections updates what the
server exposes.

The background instance connects to an internal TCP channel on
`127.0.0.1:39393`. This is not an HTTP endpoint. Each connection must authenticate
before MCP messages are accepted. Scratchpad manages the secret in its app
configuration directory; clients do not need it in their configuration. On
Unix it is created with owner-only permissions. Authentication is bounded by a
timeout, and the app limits simultaneous connections and incoming messages
(256 KiB per message). The channel cannot be reached directly from another
computer, but processes running as your user can
still obtain local app data. The menu toggle grants access to local agents as
a group; there are no separate permissions per client.

Scratchpad itself does not send notes anywhere. The agent or MCP client you
connect can send tool results—including note contents—to its model provider.
Enable access only when needed and under a client's privacy terms you accept.

The optional update checker is separate from MCP and is controlled in
**Scratchpad menu → About Scratchpad**. Automatic checks are off by default;
manual or enabled automatic checks contact GitHub Pages for public release
information without sending notes or workspace data. MCP does not expose
update-check or installation tools. See [Storage and privacy](../README.md#storage-and-privacy)
for the update preference and network behavior.
