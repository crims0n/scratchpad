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

All changes to `main`, including small fixes and documentation updates, must go through a pull request. A linked issue is not required when the change is small and its purpose is clear from the pull request.

By submitting a contribution, you agree that it may be distributed under the project's GPL-3.0-or-later license.
