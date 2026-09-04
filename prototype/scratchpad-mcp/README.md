# scratchpad-mcp (feasibility prototype)

Throwaway prototype backing the feasibility review on
[#19](https://github.com/crims0n/scratchpad/issues/19). It exists so the
measurements and edge-case results in that thread are reproducible. **It is not
an implementation proposal** — no error taxonomy, no `list_folders`, no
`get_note` pagination, no tests in the repo's own style.

## Run it

```sh
cargo build --release
python3 checks.py
```

`checks.py` builds throwaway SQLite workspaces in a temp directory, drives the
server over STDIO with raw JSON-RPC, and prints one line per check. It needs
only Python 3 and the release binary.

## Point a client at it

```sh
./target/release/scratchpad-mcp --workspace /absolute/path/to/notes.sqlite
```

## What it establishes

| | |
| --- | --- |
| SDK | `rmcp` 3.2.0, `default-features = false`, features `server, macros, transport-io, schemars` |
| Dependencies | 6 direct; 65 crates compiled on macOS, 93 in the lockfile across all targets; no HTTP/TLS/network stack |
| Release binary | 5.1 MB with bundled SQLite |
| MSRV | rmcp needs 1.88; the repo pins 1.98.0 |

## Findings worth carrying into the implementation

- **Schema tolerance, not migration.** `ensure_workspace_schema` in the app
  `ALTER TABLE`s on open. A read-only connection cannot. This prototype probes
  `pragma_table_info` and substitutes literals for absent columns instead.
- **Immutability is journal-mode dependent.** A rollback-journal workspace is
  left byte-identical with no sidecar files. Reading a **WAL** workspace creates
  `-wal` and `-shm`, and fails outright in a read-only directory. Enabling WAL
  in the write phase would silently downgrade the read-only safety property.
- **Validate lazily.** This prototype opens and probes the database at startup,
  which is wrong: an `EXCLUSIVE` lock held past the busy timeout kills the
  process before the handshake, so the client reports a dead server for the
  whole session rather than one failed call. Complete `initialize` first, then
  probe on the first tool call.
- **Search needs Unicode case folding.** SQLite `LIKE` is ASCII-only, so `über`
  matches nothing while the app's `toLocaleLowerCase().includes(...)` matches.
  A `lower_u` scalar function (rusqlite `functions` feature) closes the gap in
  about eight lines, at the cost of lowercasing every note body per query.
- **LIKE metacharacters must be escaped.** Without an `ESCAPE` clause a query of
  `100%` matches by wildcard.
- **Set `server_info` explicitly.** `Implementation::from_build_env()` expands
  inside the rmcp crate, so the default reports the server as `rmcp` 3.2.0.
