# Contributing to Scratchpad

Thanks for helping improve Scratchpad. Bug fixes, accessibility improvements, documentation, tests, and focused feature proposals are welcome.

## Before you start

- Search existing issues before opening a new one.
- Open an issue when a change needs discussion, acceptance criteria, coordination, or multiple pull requests. Issues are optional for small, self-contained changes.
- Keep pull requests focused and avoid unrelated formatting changes.
- Do not include private notes, workspace databases, credentials, or signing material.

## Development workflow

Keep `main` deployable and do not commit or push to it directly. Every change should be developed on a short-lived branch and merged through a pull request.

1. Update your local `main` and create a descriptive branch such as `feat/add-search`, `fix/login-timeout`, or `chore/update-deps`.
2. Make and validate one focused change.
3. Push the branch and open a pull request. If it completes an issue, include `Closes #<issue-number>` in the pull request description.
4. Review the diff, resolve feedback, and ensure required checks pass.
5. Squash merge unless a maintainer requests another merge strategy, then delete the merged branch.

## Development setup

You need Node.js 20 or newer (CI uses Node.js 24), Rust 1.98.0 as pinned in `rust-toolchain.toml`, and the platform dependencies from the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/). Install GnuPG (`gpg` and `gpgv`) for the release-verification tests. The isolated key-import regression additionally needs `gpgconf` and `gpg-preset-passphrase`, and generates/removes its own disposable key, agents, and socket directories. That regression skips locally if its import tools are unavailable and fails CI if they are missing; the other release-verification tests still require GnuPG. The POSIX combined-signing regression also needs `sha256sum` (GNU coreutils on macOS), uses a disposable key and synthetic AppImage containers, and skips locally if its tools are unavailable while requiring them in CI. It checks embedded signatures without LLVM/binutils. No production signing credentials are used by tests.

```bash
git clone https://github.com/crims0n/scratchpad.git
cd scratchpad
npm ci
npm run tauri -- dev
```

## Validate a change

The app serves its frontend directly from `src/`; there is no frontend development server to start. Both local development and plain local builds use **Scratchpad Development**, a separate application/storage identity from released Scratchpad. Use disposable notes and copied workspace files: the separate profile does not prevent two processes from opening the same workspace. MCP uses one loopback port, so only one app can have agent access enabled at a time.

Start with the [architecture guide](docs/architecture.md) for module ownership, persistence, native IPC, and MCP data flow. The [documentation index](docs/README.md) links the user and maintainer guides.

Run the same core checks used in CI:

```bash
npm run check
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

Frontend integration tests in `test/` boot the real app with JSDOM and a stubbed Tauri bridge; they do not prove native installer/webview behavior. Rust tests include loopback MCP sockets. CI also checks the Windows installer transition and workspace path handling, plus macOS quit protection. Use the [release checklist](docs/release-checklist.md) for signed packages and installed-platform acceptance.

For changes to packaging or Tauri configuration, also build the application locally:

```bash
npm run tauri -- build
```

## Pull requests

Explain the user-visible behavior, describe how you tested it, and include screenshots for visual changes. New behavior should include tests when it can be exercised outside the desktop shell.

When behavior or labels change, review the matching README sections, [welcome note](src/welcome-note.js), [in-app Help](src/index.html), [MCP reference](docs/mcp.md), [product page](site/index.html), and [release notes](RELEASE_NOTES.md). Update architecture diagrams when ownership or data flow changes. Keep published-download claims tied to real releases and record package-specific verification separately from source tests.

All changes to `main`, including small fixes and documentation updates, must go through a pull request. A linked issue is not required when the change is small and its purpose is clear from the pull request.

## Licensing of contributions

By submitting a contribution, you certify that you have the right to submit it and agree that it may be distributed under the project's GPL-3.0-or-later license together with the additional permission in [APP_STORE_EXCEPTION.md](APP_STORE_EXCEPTION.md), which allows distribution through app stores such as the Mac App Store. You keep the copyright in your contribution.

Do not submit code copied from other projects unless its license allows distribution under these terms; mention its origin and license in the pull request.
