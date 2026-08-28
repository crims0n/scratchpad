# Scratchpad Beta v0.5.1

## Highlights

- Write lists faster with Markdown-aware continuation for bullets, numbered items, task lists, and nested lists. Ordered siblings renumber automatically when a new item is inserted.
- Use `Tab` and `Shift+Tab` to nest or outdent list items and their children. Use `Alt+Up` and `Alt+Down` to move complete list branches.
- Continue blockquotes and fenced code blocks naturally, including automatic closing fences and preserved code indentation.
- Get lightweight pair editing for brackets, braces, quotes, and backticks, plus paired deletion and selection wrapping for Markdown emphasis and code.
- Build Markdown tables from a header row, navigate cells with `Tab`, add rows with `Enter`, or paste a spreadsheet range as a table.
- Paste a URL over selected text to create a Markdown link automatically.
- See clean task lists in preview with checkboxes instead of a checkbox plus a redundant bullet.

## Editing details

- Autocomplete preserves existing bullet characters, indentation, and spacing styles.
- Empty nested list items outdent one level; empty top-level items exit the list.
- Smart Markdown behavior stays inactive inside fenced or inline code unless the behavior is code-specific.
- Escaped Markdown characters remain literal, and custom edits use a single native undo transaction when supported by the system webview.

## Compatibility

- Existing notes and workspaces require no migration.
- The new editing behavior is available in both editor panes.

## Beta notice

Back up important workspace files before testing. These builds are not yet production-signed, so macOS and Windows may display a security warning.
