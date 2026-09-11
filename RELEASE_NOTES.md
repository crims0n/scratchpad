# Scratchpad Beta v0.7.3

## Highlights

- Create a scratchpad by double-clicking empty space below the sidebar list. New blank scratchpads open ready to edit, even when Preview was selected.
- Keep imported themes readable with sidebar and active-note tones derived from the theme's own colors.
- Use RGB, HSL, named colors, and `color(srgb …)` in custom themes without light themes being mistaken for dark ones.
- On macOS, **About Scratchpad** in the native application menu now opens the same in-app About and update panel as the Scratchpad menu.

## Faster note creation

- Double-click the empty sidebar area to create and select a new scratchpad. Double-clicks on notes, folders, buttons, and other controls keep their existing behavior.
- A newly created blank scratchpad switches from Preview to Edit automatically so there is always somewhere to type. Split view remains in place because it already includes an editor, and notes created with content retain the selected layout.
- The in-app Help and welcome guide describe the new sidebar gesture.

## Theme readability

- Secondary and muted sidebar text is now derived from each theme's foreground, background, sidebar, hover, and active-row surfaces instead of inheriting tones measured for the built-in palette.
- Across all 17 built-in themes, secondary and muted text meets the 4.5:1 contrast target on idle and hover surfaces, as does every text tone on active rows. GitHub Dark's active-row background is adjusted so both its title and dimmer preview remain readable.
- Imported opaque RGB, HSL, named, and `color(srgb …)` colors are resolved by the browser and measured like equivalent hex colors. This fixes light non-hex themes receiving dark fallback tones.
- Switching themes clears previously derived tones before applying the new set, preventing colors from the prior theme leaking into partially measurable themes.
- Translucent colors are preserved rather than flattened for contrast calculations. Colors that the browser retains in another color space, such as `oklch()` or Display P3, also remain unchanged and use the documented dark fallback when light/dark classification cannot be measured safely.

## Menu and agent-access polish

- The native macOS About command focuses the main window and opens Scratchpad's existing About panel, including release notes and update controls. Reopening it does not disturb the element that receives focus when the panel closes.
- Enabling MCP access now says that reads are available immediately while writes remain disabled until explicitly allowed in **MCP Configuration**. Connection metadata no longer describes the whole session as read-only after write permissions are enabled.
- The MCP permission summary now has its own status identity, keeping its live read/write count distinct and reliable for assistive technology.

## Compatibility and beta notice

- Existing local notes, folders, trash, themes, preferences, and workspace files continue to work; no manual migration is required from v0.7.2.
- Existing welcome notes are left untouched. The updated guide is used for newly created welcome notes.
- v0.7.3 retains the existing beta application identity and packaging. Builds are not yet production-signed; macOS and Windows may display a security warning.
