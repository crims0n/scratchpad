# Scratchpad

A minimalist, cross-platform, and high-efficiency desktop text editor designed to be the ultimate developer scratchpad. Built with **Tauri v2** and vanilla HTML/CSS/JS, it has a near-zero memory footprint and starts instantly.
---

## ✨ Features

- 💾 **Instant Auto-Save**: Never lose a thought. Every keystroke is saved automatically to local storage, debounced to maintain maximum system efficiency.
- 📝 **Live Markdown Preview**: Toggle between full editor view, split pane (sync-scrolled edit and preview), and full preview.
- 📁 **Sidebar Scratch Manager**: Create, delete, and search across multiple drafts/notes on the fly.
- ⚡ **Auto-Renaming**: Scratchpads auto-rename themselves based on the first line of text you write, unless you manually lock the title.
- 🧘 **Focus Mode**: Press `Cmd+Shift+F` to clear all sidebars, status bars, and menus for a pure, distraction-free writing environment.
- 🎨 **Adaptive Design System**: System-adaptive dark and light modes (respecting system theme transitions, with manual override pinning).
- 📤 **Fast Export**: Easily copy raw Markdown, copy rendered HTML, or export your scratchpad as a `.md` document.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd + N` or `Ctrl + N` | Create a new scratchpad |
| `Cmd + B` or `Ctrl + B` | Toggle sidebar visibility |
| `Cmd + Shift + F` or `Ctrl + Shift + F` | Toggle distraction-free Focus Mode |
| `Escape` | Exit Focus Mode |

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
- **Frontend**: Vanilla HTML5, CSS Variables, and JavaScript (ES Modules) for lightweight performance.
- **Markdown Compiler**: [marked.js](https://marked.js.org/) (bundled locally for offline access).
- **Styling**: Vanilla CSS utilizing custom scrollbars, animations, and fluid container sizing.
