# Contributing to Scratchpad

Thanks for helping improve Scratchpad. Bug fixes, accessibility improvements, documentation, tests, and focused feature proposals are welcome.

## Before you start

- Search existing issues before opening a new one.
- Open an issue before beginning a large change so its scope can be discussed.
- Keep pull requests focused and avoid unrelated formatting changes.
- Do not include private notes, workspace databases, credentials, or signing material.

## Development setup

You need Node.js 20 or newer, Rust 1.98.0, and the platform dependencies from the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/).

```bash
git clone https://github.com/crims0n/scratchpad.git
cd scratchpad
npm install
npm run tauri -- dev
```

## Validate a change

Run the same core checks used in CI:

```bash
npm run check
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

For changes to packaging or Tauri configuration, also build the application locally:

```bash
npm run tauri -- build
```

## Pull requests

Explain the user-visible behavior, describe how you tested it, and include screenshots for visual changes. New behavior should include tests when it can be exercised outside the desktop shell.

By submitting a contribution, you agree that it may be distributed under the project's GPL-3.0-or-later license.
