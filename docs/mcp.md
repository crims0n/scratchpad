# Read-only MCP agent access

Scratchpad includes an MCP stdio mode in the desktop executable. There is
no separate server executable or runtime to install. Open **Scratchpad menu →
Agent access → Enable read-only access** while the app is running. Once enabled,
choose **MCP Configuration** to see and copy the connection values.

Access is off each time Scratchpad starts. Disabling it stops access and
disconnects active MCP sessions. Enable it before starting or reconnecting the
client; clients do not all retry a server that was unavailable at startup.

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

## Tools

| Tool | Result |
| --- | --- |
| `list_folders` | Folder ids, names, and assigned-note counts |
| `list_notes` | Note metadata, folder names, and short previews |
| `search_notes` | Literal, case-insensitive title and Markdown search |
| `get_note` | One character-addressed chunk of a note's Markdown content |

List and search calls accept `limit` and `offset` and return `nextOffset` when
another page exists. `get_note` returns at most 20,000 characters by default;
follow its `nextOffset` until `truncated` is false. These offsets count Unicode
characters, not UTF-8 bytes. `list_notes` and `search_notes` also accept an
optional `folderId`.

Every exposed tool is marked read-only, non-destructive, idempotent, and
closed-world. There are no create, update, move, or delete tools in this first
version.

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
