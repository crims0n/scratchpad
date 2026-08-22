# Scratchpad

Scratchpad is a fast, local-first desktop editor for notes, snippets, and Markdown. It is built with Tauri v2 and a vanilla HTML, CSS, and JavaScript frontend, with no account or cloud service required.

## Features

### Writing and editing

- Multiple automatically saved scratchpads
- Automatic titles derived from the first line until a title is edited manually
- Edit, synchronized edit/preview, and full Markdown preview layouts
- Two-note side-by-side editing via the toolbar, context menu, shortcut, or drag-to-split
- Word and character counts for the document and current selection
- Focus mode for distraction-free writing
- Copy as Markdown or rendered HTML

### Finding and organizing

- Sidebar search across note titles and contents
- Note reordering by drag and drop, context menu, or keyboard
- Case-insensitive find and replace with live match highlighting
- Regular-expression search and replacement, including capture groups
- Native import for Markdown, source code, configuration, and other UTF-8 text files
- Native Markdown export with a generated filename

### Storage and workspaces

- Local-first persistence with debounced saves
- Optional portable workspace files that preserve notes and sidebar order
- Explicit flows for opening an existing workspace or creating a new one
- Native last-workspace preference shared across development and packaged launch modes
- Automatic migration of workspace files created by earlier versions
- Local mirroring while a workspace is connected

Workspace files use SQLite internally and accept `.db` or `.sqlite` extensions. Connecting an empty workspace seeds it with the notes currently available in Scratchpad.

### Themes and help

- Built-in dark and light themes
- Developer-oriented presets: Dracula, Catppuccin Mocha, Nord, Tokyo Night, Monokai Pro, One Dark Pro, Solarized Dark, Solarized Light, Amber CRT, Green CRT, Pastel Daydream, Macintosh System 6, Mac OS 9 Platinum, Windows Classic, and GitHub Dark
- Import custom JSON or TOML/key-value color themes
- Export the active theme as JSON
- Built-in keyboard shortcut reference and Markdown cheatsheet
- Keyboard navigation between help topics with `Tab` and `Shift+Tab`

Markdown is parsed locally with a bundled copy of marked. Preview output is sanitized before rendering, and the desktop window uses a restrictive content security policy.

## Keyboard shortcuts

Use `Cmd` on macOS and `Ctrl` on Windows or Linux.

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl + N` | Create a scratchpad |
| `Cmd/Ctrl + B` | Toggle the sidebar |
| `Cmd/Ctrl + \` | Toggle two-note side-by-side editing |
| `Alt + ↑` / `Alt + ↓` | Move the active note in the sidebar |
| `Cmd/Ctrl + F` | Open or close Find |
| `Cmd/Ctrl + H` | Open Find and Replace |
| `Alt + R` | Toggle regular-expression mode while Find is open |
| `Enter` / `Shift + Enter` | Select the next or previous match |
| `Cmd/Ctrl + Shift + F` | Toggle Focus Mode |
| `Cmd/Ctrl + /` or `F1` | Open or close Help and Reference |
| `Tab` / `Shift + Tab` | Switch topics while Help is open |
| `Escape` | Close the active modal or Find bar, or leave Focus Mode |

## Custom themes

A JSON theme requires `background` and `foreground`. The remaining colors are optional and receive safe defaults when omitted.

```json
{
  "name": "Amber CRT",
  "background": "#120f08",
  "foreground": "#f6c453",
  "sidebar": "#1b160b",
  "accent": "#ffb000",
  "border": "#4a3814",
  "selection": "#5c4315"
}
```

Scratchpad also accepts simple TOML/key-value themes using the same property names. Imported color values are validated before the theme is stored or rendered.

## Development

### Prerequisites

- Node.js 18 or newer
- A current stable Rust toolchain with Cargo
- The platform dependencies listed in the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/)

### Run locally

```bash
git clone https://github.com/crims0n/scratchpad.git
cd scratchpad
npm install
npm run tauri -- dev
```

The frontend is served directly from `src/`; there is no framework-specific build step or development server.

### Validate changes

```bash
node --check src/main.js
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

### Build a release

```bash
npm run tauri -- build
```

Application bundles and installers are written beneath `src-tauri/target/release/bundle/`.

## Architecture

| Area | Implementation |
| --- | --- |
| Desktop runtime | Tauri v2 and Rust |
| Frontend | Vanilla HTML, CSS, and JavaScript |
| Markdown | Bundled marked parser with an allowlist sanitizer |
| Local persistence | Webview local storage |
| Workspace persistence | Bundled SQLite through `rusqlite` |
| Native preferences | JSON in the platform app configuration directory |
| Native integration | Rust commands and native file/message dialogs |
| Themes | CSS custom properties with JSON and TOML/key-value import |

The main project files are:

- `src/index.html` — application structure and built-in help content
- `src/styles.css` — layout modes, components, and theme tokens
- `src/main.js` — editor state, persistence coordination, commands, and interactions
- `src-tauri/src/lib.rs` — native dialogs, file operations, and workspace persistence
- `src-tauri/tauri.conf.json` — desktop window, bundle, and security configuration
