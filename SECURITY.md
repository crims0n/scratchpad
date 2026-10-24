# Security Policy

## Supported versions

Security fixes target the latest published stable release and the `main` branch.
Older stable versions and pre-1.0 betas do not receive separate backports; upgrade
to the latest stable release when one is available. Before the first stable
release is published, fixes target the latest published beta and `main`.
Development builds are not supported release packages. There is no separate
ongoing beta release channel or long-term support branch.

## Agent access and recovery data

MCP agent access is optional and off on launch. When enabled, it exposes the open
collection, including unsaved edits, to authenticated local clients. All read
functions start enabled; write functions require individual opt-in. Permissions
apply to all connected clients and reset when access restarts. An agent may send
returned content to its model provider.

Notes deleted in v0.7.0 or later remain in persistent trash until the user empties
it. MCP can list trash metadata but cannot read trashed note bodies, restore
notes, or permanently empty trash. Local storage and workspace databases,
including their trash, are not encrypted by Scratchpad. Protect them and their
backups with the same care as active notes.

See the [MCP reference](docs/mcp.md#live-data-and-privacy-boundary) for the local
authentication boundary, message limits, and client configuration.

## Verifying downloads

Linux release packages are covered by a signed `SHA256SUMS` file. See
[Verifying Linux downloads](docs/verify-linux-downloads.md) for the key
fingerprint and procedure.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's [private vulnerability reporting form](https://github.com/crims0n/scratchpad/security/advisories/new) and include:

- the affected version and platform;
- steps to reproduce the issue;
- the potential impact; and
- any suggested mitigation, if known.

You should receive an acknowledgement within seven days. Please allow time for a fix and coordinated release before disclosing the issue publicly.
