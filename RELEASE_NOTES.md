# Scratchpad Beta v0.5.6

## Highlights

- Find and Replace now keeps correct match positions after Unicode characters whose lowercase form changes length, including `İ` in words such as `İstanbul`.
- Replace and Replace All now participate in the editor's native undo history. A Replace All operation is grouped into one edit and can be reversed with one undo.
- Editor backdrop rendering is coalesced to one update per animation frame during normal typing, reducing repeated full-document work on rapid input.
- Spreadsheet paste conversion is more conservative: ragged rows and tab-indented or mixed-indentation text remain unchanged instead of becoming malformed Markdown tables.

## Find and Replace reliability

- Case-insensitive literal searches now run against the original note, so highlights, line and column details, result snippets, and replacement ranges share the same offsets.
- Literal Find continues to treat regular-expression characters such as brackets as ordinary text unless Regex mode is enabled.
- Replace actions use the same editor transaction path as Markdown autocomplete, preserve focus in the Find controls, and flow through normal saving and preview updates.

## Editor performance and paste safety

- Rapid editor input schedules one syntax backdrop render with the newest text instead of rebuilding it for every input event.
- Hidden line-number gutters remain empty while line numbers are disabled, and stale gutter rows are removed when the setting is turned off.
- Preview Find highlighting avoids unnecessary document scans when no preview highlights have been rendered.
- Tab-separated paste converts only rectangular ranges with the same number of columns on every row. Code-like indentation is preserved, while a normal spreadsheet row may still contain an empty first cell.
- The bundled Marked parser is updated from 18.0.10 to 18.0.11.

## Compatibility

- Existing notes and workspace files require no migration.
- Existing preferences and Markdown editing settings remain intact.
- Find, Replace, and paste fixes apply in place without changing stored note formats.
- Scratchpad remains fully offline; the Marked maintenance update is bundled with the application.

## Beta notice

Back up important workspace files before testing. These builds are not yet production-signed, so macOS and Windows may display a security warning.
