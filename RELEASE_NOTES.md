# Scratchpad Beta v0.5.5

## Highlights

- Turn on subtle source line numbers from **Scratchpad menu → Appearance → Line numbers**. They are off by default, remembered between launches, and available in both editor panes.
- Right-click either Markdown editor and choose **Insert** to add a starter table, task list, fenced code block, inline link, or reference-style link.
- Use the reorganized Scratchpad menu, now grouped into **Note**, **Appearance**, **Workspace**, and **Help**, with live theme and workspace values.
- Open **About Scratchpad** for the installed version plus direct repository and release-note links.

## Markdown editing refinements

- Inserted templates use one editor transaction and select their first useful placeholder, so they remain easy to replace and undo.
- Table navigation now recognizes every contiguous data row, including rows beyond the first one after the separator.
- Enter in the final cell of a populated table row creates another correctly shaped row.
- Enter or Backspace on an empty generated table row exits to an explicit normal line instead of creating another separator or trapping the caret.
- The task-list template starts with one task. Enter continues with an unchecked item; Enter on the empty item removes its marker and exits to a normal line.
- Empty list, table, and blockquote exits retain an explicit blank source line for stable caret placement.

## Interface polish and fixes

- The Scratchpad menu uses consistent sentence-case labels, aligned controls, logical sections, and no trailing ellipses.
- The menu shows the active color theme and either **Local notes** or the current workspace filename.
- Closing Dual-Note Split View immediately clears its temporary “enabled” notification.
- Task-list previews now show the checkbox without a redundant bullet marker.

## Compatibility

- Existing notes and workspace files require no migration.
- Line numbers are opt-in and do not alter note content, selection, native editing, or undo history.
- Existing appearance preferences remain intact.
- Scratchpad remains fully offline and does not load remote syntax-highlighting or image resources.

## Beta notice

Back up important workspace files before testing. These builds are not yet production-signed, so macOS and Windows may display a security warning.
