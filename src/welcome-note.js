// SPDX-License-Identifier: GPL-3.0-or-later

export const WELCOME_NOTE_TITLE = "Welcome to Scratchpad!";

export const WELCOME_NOTE_CONTENT = `# Welcome to Scratchpad!

Scratchpad is a fast, local-first place for notes, snippets, and Markdown. Everything is saved automatically as you write.

## Start writing
- Create a scratchpad with \`Cmd/Ctrl+N\`, or by double-clicking the empty space below the sidebar list, and find your notes from the sidebar.
- Switch between **Edit**, **Split**, and **Preview** to work with rendered Markdown.
- Open a second note beside this one with \`Cmd/Ctrl+\\\`.
- With two notes open, choose **Compare** in the toolbar to highlight removed text on the left and added text on the right as you edit.
- Enter Focus Mode with \`Cmd/Ctrl+Shift+F\` when you want fewer distractions.

## Markdown that helps as you type
- Press \`Enter\` to continue bullets, numbered lists, task lists, and blockquotes. An empty item exits or outdents the block.
- Press \`Tab\` at the start of a list item to nest it, \`Shift+Tab\` to outdent it, or \`Alt+Up\` / \`Alt+Down\` to move the item with its children.
- Type a fenced code marker and press \`Enter\` to close the fence automatically. Add a language such as \`javascript\` to highlight its Preview.
- Parentheses, brackets, braces, quotes, and inline backticks pair automatically. Select text before typing \`*\`, \`_\`, \`~\`, or a backtick to wrap it.
- Finish a Markdown table header with \`Enter\`, then use \`Tab\` and \`Shift+Tab\` to move between cells. Enter in the final cell adds a row; Enter or Backspace on an empty row exits the table.
- Right-click in the editor and choose **Insert** for starter tables, task lists, code blocks, and links.
- Paste a URL over selected text to make a link, or paste a rectangular spreadsheet range to make a table. Tab-indented text stays literal.

## Find and organize
- Search scratchpad titles and content from the sidebar.
- Use the folder button in the sidebar to group related scratchpads. Folders collapse to keep the sidebar compact; notes without a folder remain at the top level.
- Drag a note onto a folder to move it, or right-click a folder for note and folder actions.
- Pin important scratchpads to keep them at the very top of the sidebar without placing them inside a folder. Unpinning returns a scratchpad to its folder.
- Use \`Cmd/Ctrl+F\` to find text or \`Cmd/Ctrl+H\` to find and replace. Find Results can search one scratchpad or all of them.

## Delete and recover
- Right-click a note and choose **Delete Note** to move it to trash.
- Click the **trash icon at the bottom right**, then **Restore**, to recover a note. It returns to its original folder or the top level if that folder was removed.
- Right-click the trash icon and choose **Empty Trash…** to permanently remove deleted notes after confirmation. Trash survives restarts, has no automatic expiry, and is separate for local notes and each workspace.

## Connect an agent (optional)
- Open **Scratchpad menu → Agent access** and turn it **On**. The **MCP listening** status shows when access is enabled.
- Open **MCP Configuration** to copy the command and argument into a client that supports local stdio MCP servers. Configuration is available even while access is off; keep Scratchpad open when connecting.
- All five read functions start enabled; all eight write functions start disabled. Choose individual **Read** and **Write** permissions or select all in a section. Choices reset when access restarts.
- With permission, agents can create notes and folders, append text, rename and move notes, rename folders, move notes to trash, and delete empty folders. Agents can list trash metadata; only you can restore notes or empty trash.
- Agents see the open collection, including unsaved edits, and may send returned content to their model provider. Turn access off when finished.

## Make it yours
- Choose a built-in theme from the bottom of the sidebar, or import your own.
- Open the Scratchpad menu to adjust sidebar previews, editor zoom, line spacing, syntax highlighting, and optional line numbers.
- The Scratchpad menu also imports and exports files, copies Markdown or rendered HTML, and opens portable workspace files.

## Check for updates (optional)
- Open **Scratchpad menu → About Scratchpad**, then **Check for Updates…**, to look for a newer version on your release channel.
- Choose **Read release notes** to see what changed before downloading. **Download Update** opens the release page in your browser; nothing is installed automatically.
- **Automatically check for updates** is off by default. When enabled, it checks shortly after launch and at most once every 24 hours. Checks contact GitHub Pages without sending notes or workspace data.
- **Later** closes the panel. **Skip This Version** hides background notices for that release; a manual check can still show it again.

## Need a reference?
Press \`Cmd/Ctrl+/\` (or \`F1\`) to open keyboard shortcuts, the Markdown cheatsheet, and the MCP function reference. Use \`Tab\` and \`Shift+Tab\` to switch between them.

Happy writing.
`;
