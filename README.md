# Scratchpad

An opinionated, cross-platform, high-efficiency desktop text editor designed to be the ultimate developer scratchpad. Built with **Tauri v2** and vanilla HTML/CSS/JS, it has a near-zero memory footprint and starts instantly.
---

## ✨ Features

- 💾 **Instant Auto-Save**: Never lose a thought. Every keystroke is saved automatically to local storage, debounced to maintain maximum system efficiency.
- 🗄️ **SQLite DB Workspace Mode**: Connect to a local SQLite database file (`.db` or `.sqlite`) to save, sync, and persist your notes list natively. Automatically seeds new database files with your current LocalStorage drafts.
- ◫ **Dual-Note Split View**: View and edit two distinct scratchpads simultaneously side by side with independent title editing, auto-save, and note selection.
- 🔍 **Find & Replace with Regex**: Powerful document search with real-time match highlighting, single/bulk replace, and regular expression mode (`.*`) supporting full capture groups.
- 📝 **Live Markdown Preview**: Toggle between full editor view, split pane (sync-scrolled edit and preview), and full preview.
- 📊 **Contextual Highlighting Stats**: Displays overall word and character counts. Highlighting text displays selection stats (e.g. `5 words • 30 characters selected`) on the right next to the Save indicator.
- 📥 **Native File Import**: Pick and import Markdown, source code, text files, and extensionless documents with automatic validation and alerts.
- 📤 **Custom Directory File Export**: Export your notes to any directory on your filesystem using native OS directory save dialogs.
- 📁 **Sidebar Scratch Manager**: Create, delete, and search across multiple drafts/notes on the fly.
- ⚡ **Auto-Renaming**: Scratchpads auto-rename themselves based on the first line of text you write, unless you manually lock the title.
- 🧘 **Focus Mode**: Press `Cmd+Shift+F` to clear all sidebars, status bars, and menus for a pure, distraction-free writing environment.
- 🎨 **Adaptive Design System**: System-adaptive dark and light modes (respecting system theme transitions, with manual override pinning).

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd + N` or `Ctrl + N` | Create a new scratchpad |
| `Cmd + B` or `Ctrl + B` | Toggle sidebar visibility |
| `Cmd + \` or `Ctrl + \` | Toggle Dual-Note Split View (Side-by-Side) |
| `Cmd + F` or `Ctrl + F` | Toggle Find bar |
| `Cmd + H` or `Ctrl + H` | Toggle Find & Replace |
| `Alt + R` | Toggle Regular Expression mode in Find |
| `Enter` / `Shift + Enter` | Jump to next / previous search match |
| `Cmd + Shift + F` or `Ctrl + Shift + F` | Toggle distraction-free Focus Mode |
| `Escape` | Close Find / Exit Focus Mode |

---

## 🚀 Getting Started (Development)

### Prerequisites

Ensure you have the following installed on your machine:
- **Node.js** (v18+)
- **Rust & Cargo** (v1.85+)
- Operating system dependencies for Tauri (e.g. Xcode Command Line Tools on macOS, C++ Build Tools on Windows). Refer to the [Tauri Setup Guide](https://tauri.app/start/prerequisites/) for details.

### Setup and Running

1. **Clone the repository**:
   ```bash
   git clone https://github.com/crims0n/scratchpad.git
   cd scratchpad
   ```

2. **Install frontend dependencies**:
   ```bash
   npm install
   ```

3. **Start the application in Development Mode**:
   ```bash
   npm run tauri dev
   ```
   *This will download Rust dependencies, compile the native application wrapper, and open the desktop window.*

---

## 🏗️ Production Build

To build a standalone, optimized release executable package (e.g., `.app`/`.dmg` on macOS, `.exe` on Windows):

```bash
npm run tauri build
```

The resulting installers will be placed inside the `src-tauri/target/release/bundle/` directory.

---

## 🛠️ Tech Stack & Architecture

- **Wrapper & System Bridge**: [Tauri v2](https://tauri.app/) (Rust-based runtime)
- **Database Engine**: [SQLite](https://www.sqlite.org/) (integrated natively via `rusqlite` compiled bundle)
- **Frontend**: Vanilla HTML5, CSS Variables, and JavaScript (ES Modules) for lightweight performance.
- **Markdown Compiler**: [marked.js](https://marked.js.org/) (bundled locally for offline access).
- **Styling**: Vanilla CSS utilizing custom scrollbars, animations, and fluid container sizing.
