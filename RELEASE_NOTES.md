# Scratchpad Beta v0.8.1

## Highlights

- Both note editors now use CodeMirror 6, with editor-managed undo, aligned gutters, and the existing Markdown helpers, Find/Replace, Compare, wrapping, and appearance settings.
- Detect TXT, Markdown, JSON, XML, YAML, and CSV notes automatically, with sidebar format badges and optional format-aware editor colors in both panes.
- Collapse Markdown, JSON, XML, and YAML sections using gutter arrows and hidden-line placeholders. Find reveals hidden matches, and Compare starts expanded.
- Export a note as a standalone HTML file with embedded styles for offline reading, or print the active note through the system print dialog with Cmd/Ctrl+P.
- Improve large-note responsiveness, preserve editor sessions during MCP appends, and protect existing files when native exports fail.
- Match the folding gutter to the editor background and reduce editor margins for a more compact writing area.

## Editing and format detection

- CodeMirror 6 powers both editor panes while preserving Markdown continuation, pair completion, selection wrapping, smart paste, tables, context-menu insertion, and line-number preferences.
- Sidebar badges update as notes change. Editor colors follow detected Markdown, JSON, XML, YAML, and CSV formats; TXT stays plain. CSV uses repeating column colors, including quoted multiline fields.
- Detection favors Markdown and ordinary prose over ambiguous YAML or CSV, while supporting structured YAML with leading comments. Non-Markdown snippets keep literal characters in previews.
- Fold Markdown headings and fenced code, JSON objects and arrays, XML elements, and YAML nested mappings, sequences, and scalar blocks. Click a hidden-line placeholder to expand it. CSV and TXT stay unfolded.
- Folding is available for notes up to 100,000 characters and 10,000 lines to keep typing responsive. Larger notes remain editable without folding. Collapsing only changes the editor view; saved, copied, exported, and printed content retains the full source.
- MCP appends preserve undo history, selection, scroll position, and valid collapsed sections in both panes showing the note.

## Export, printing, and collections

- **Export HTML file** saves the active note with preview formatting and embedded styles. In split view, it exports the active pane. Remote images remain blocked.
- **Print Note…** or **Cmd/Ctrl+P** opens a formatted, note-only print preview with a paper-friendly light palette and the system print dialog. In split view, it prints the active pane. Cancel leaves the note unchanged; use **Print…** to retry and **Close** when finished.
- Closing the main editor saves pending edits and exits the app, including any open print preview. A failed save cancels closing.
- Native HTML, Markdown, recovery, and collection-backup exports stage, sync, and verify a new file before replacing the destination, preserving an existing file if preparation fails.
- Menu labels, action descriptions, Help, and the welcome note clarify the active collection, workspace storage, and which collection each action affects.

## Compatibility and beta notice

- v0.8.1 retains the existing beta application identity and packaging. No manual collection migration is required from v0.8.0.
- Existing notes, folders, trash, themes, preferences, and workspace files continue to use their existing locations. Back up important data before upgrading, and do not delete app data while recovery is pending.
- Builds are not yet production-signed; macOS and Windows may display a security warning. Automated checks do not replace installed-package acceptance testing on macOS, Windows, and Linux.
