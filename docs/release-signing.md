# Linux release signing (maintainers)

The Stable Release workflow signs Linux artifacts with a project GPG key:

1. Each native Linux build imports the signing subkey into an explicit temporary `GNUPGHOME`, checks it belongs to `site/release-signing-key.asc`, and confirms noninteractive signing. Import preserves existing configuration and adds required options only once.
2. The Tauri bundler embeds a signature in its AppImage (`SIGN`, `SIGN_KEY`, `APPIMAGETOOL_SIGN_PASSPHRASE`). A signing failure fails the build. Native x64 and ARM64 jobs extract the DEB/AppImage applications, require the intended ELF architecture and DEB metadata, check the embedded signature's issuer, and record the exact package hashes separately as `linux-x64.json` and `linux-arm64.json`.
3. A protected **Sign one combined Linux checksum manifest** job downloads all four packages and both records from the same run. Before importing a key, `verify-linux-handoff.mjs` requires the exact four canonical names, candidate ID/version/commit/run, and recorded hashes. `sign-linux-release.sh <key> --assets-dir DIR --architecture all` rechecks both embedded signature issuers using LLVM's multi-architecture `llvm-objcopy`, writes one four-line `SHA256SUMS`, signs it, verifies against only the published key, and rejects modified checksums and packages. A separate `linux-checksums.json` records just the final checksum/signature pair.
4. Both signing workflows kill the temporary agent, remove its runtime socket directory, and remove the selected temporary keyring in an always-run cleanup step. They never delete a contributor's default keyring.

The five build jobs and checksum job have read-only repository access. Only the dedicated upload job writes draft assets. It requires all six architecture-specific/checksum records and all twelve final release files, uploads them to the prepared draft ID, checks upload digests, and downloads by asset ID. Read-only snapshot verification independently rechecks those bytes, records, and the downloaded checksum signature with only the published key. Final confirmation requires the current draft's identity, unpublished state, asset IDs, sizes and digests to match that snapshot. See [ARM64 stable pipeline](arm64-stable-release.md).

User-facing instructions are in [verify-linux-downloads.md](verify-linux-downloads.md).

## Key layout

- **Primary key**: Ed25519, certify-only, kept offline. Its fingerprint is the one published. It never goes to CI.
- **Signing subkey**: Ed25519, sign-only, with an expiry date. Only this subkey (with a stub for the primary) is stored in CI.

Rotating the subkey therefore keeps the published fingerprint, and a CI compromise cannot certify new keys.

## Initial setup

The project already has a published key. These steps are for an initial setup or
an explicitly planned key replacement, not a routine release. Do this on a
trusted machine, ideally offline, with GnuPG 2.2 or later.

```bash
gpg --quick-gen-key "Scratchpad Release Signing (github.com/crims0n/scratchpad)" ed25519 cert 5y
FPR='YOUR_PRIMARY_FINGERPRINT'
gpg --quick-add-key "$FPR" ed25519 sign 1y
SUBFPR=$(gpg --with-colons --list-keys "$FPR" | awk -F: '$1=="fpr"{print $10}' | sed -n 2p)

# Public key for the website and CI verification
gpg --armor --export "$FPR" > site/release-signing-key.asc

# Secret for CI: the signing subkey only. Keep the "!" in single quotes:
# zsh treats !" inside double quotes as a history-expansion marker.
gpg --armor --export-secret-subkeys "$SUBFPR"'!' > signing-subkey.asc

# Revocation certificate for the primary key (store offline; see Revocation)
gpg --output scratchpad-release-revoke.asc --gen-revoke "$FPR"
```

Then:

1. For a new key, update the existing fingerprint in `site/index.html` and `docs/verify-linux-downloads.md` to the reviewed primary fingerprint, in groups of four (`gpg --fingerprint "$FPR"`, single spaces). `test/release-signing-key.test.js` checks that both match `site/release-signing-key.asc`. Announce a primary-key change as described below.
2. In **Settings → Environments**, create `release-signing` with required reviewers and deployment branches limited to `main`. The Stable Release build job runs in this environment.
3. Add the environment secrets `RELEASE_SIGNING_GPG_PRIVATE_KEY` (contents of `signing-subkey.asc`) and `RELEASE_SIGNING_GPG_PASSPHRASE`.
4. Securely delete `signing-subkey.asc` from the working machine.

## Backup

Keep two offline copies, such as encrypted USB drives in separate locations, of:

- the full secret key (`gpg --armor --export-secret-keys "$FPR"`);
- the revocation certificate; and
- the passphrase, stored separately from the key.

Losing the primary key means a new fingerprint must be published, and every user must re-verify it.

## Rotation

- **Before the subkey expires** (or yearly): add a new signing subkey, export it as above, replace both environment secrets, then re-export and commit `site/release-signing-key.asc`. The fingerprint does not change. Optionally let the old subkey expire. Old releases still verify while the old subkey remains in the published key.
- **Extending the primary key's expiry**: use `gpg --quick-set-expire "$FPR" 5y`, then re-export and commit the public key.

## Revocation

If the CI secret or the passphrase may be exposed:

1. Delete the environment secrets immediately.
2. Revoke the subkey (`gpg --edit-key "$FPR"`, then `key N`, `revkey`, `save`), add a new subkey, and update the secrets.
3. Re-export and commit `site/release-signing-key.asc`.
4. Identify releases signed after the possible exposure, rebuild them, and say so in the release notes and website.

If the primary key is compromised, import the revocation certificate, publish the revoked key, generate a new key, publish the new fingerprint everywhere above, and announce the change in a release and a pinned issue.

## Testing changes to the scripts

The scripts run on Ubuntu 22.04. `--architecture x64` or `arm64` validates a development probe pair; `--packages-only` records one native stable build without writing checksum files. Stable checksum signing requires `--architecture all` and all four staged packages. The aggregation runner installs LLVM and selects `OBJCOPY=llvm-objcopy` to inspect both ELF machine types. No signing script contacts GitHub. The Linux-only integration test uses a disposable key and synthetic ELF containers to exercise both machine types, handoff hashes, the combined checksum signature and unchanged package bytes; it is not native application acceptance.
