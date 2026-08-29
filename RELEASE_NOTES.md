# Scratchpad Beta v0.5.2

## Highlights

- See language-aware syntax colors in Preview for fenced code blocks labeled with a supported language such as `javascript`, `python`, `rust`, or `bash`.
- Use lightweight Markdown coloring directly in both editor panes without changing the native textarea's caret, selection, undo, or autocomplete behavior.
- Toggle both highlighting layers from **Actions → Editor → Syntax highlighting**. The setting is enabled by default and remembered between launches.
- Keep working fully offline: Highlight.js and its common language definitions are bundled with Scratchpad rather than loaded from a CDN.
- Start with an expanded welcome guide and updated Help & Reference content covering lists, tables, smart pairs, paste behavior, and highlighting controls.

## Highlighting details

- Preview highlighting runs only after Markdown has passed through Scratchpad's allowlist sanitizer; highlight markup written in a note is not trusted.
- Unknown or unlabeled code fences remain plain code instead of using language autodetection.
- Editor highlighting is color-only, so line wrapping and cursor geometry stay aligned with the editable text layer.
- Find-result highlighting composes with Markdown colors in the editor and rendered Preview.

## Compatibility

- Existing notes and workspaces require no migration.
- Existing Markdown autocomplete and smart editing behavior is unchanged.
- Highlighting is available in both editor panes and can be disabled at any time.
- Highlight.js is distributed under the BSD 3-Clause License; its license and disclaimer are included in the app's third-party notices.

## Beta notice

Back up important workspace files before testing. These builds are not yet production-signed, so macOS and Windows may display a security warning.
