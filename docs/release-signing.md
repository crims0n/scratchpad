# Linux release signing (maintainers)

The Beta Release workflow signs Linux artifacts with a project GPG key:

1. `scripts/import-release-signing-key.sh` imports the signing subkey, checks it belongs to the published key in `site/release-signing-key.asc`, and confirms it can sign without a prompt.
2. The Tauri bundler embeds a signature in the AppImage (`SIGN`, `SIGN_KEY`, `APPIMAGETOOL_SIGN_PASSPHRASE`). A signing failure fails the build.
3. `scripts/sign-linux-release.sh` downloads the AppImage and `.deb` from the draft release, checks that the AppImage's embedded signature comes from the published key, writes and signs `SHA256SUMS`, and verifies it with only the published key. It also confirms that modified checksums and modified packages fail. It then uploads `SHA256SUMS` and `SHA256SUMS.asc` to the draft.

Website checksums come from GitHub's asset digests, which GitHub calculates after upload. They therefore always describe the final, signed files.

User-facing instructions are in [verify-linux-downloads.md](verify-linux-downloads.md).

## Key layout

- **Primary key**: Ed25519, certify-only, kept offline. Its fingerprint is the one published. It never goes to CI.
- **Signing subkey**: Ed25519, sign-only, with an expiry date. Only this subkey (with a stub for the primary) is stored in CI.

Rotating the subkey therefore keeps the published fingerprint, and a CI compromise cannot certify new keys.

## Initial setup

Do this on a trusted machine, ideally offline, with GnuPG 2.2 or later.

```bash
gpg --quick-gen-key "Scratchpad Release Signing (github.com/crims0n/scratchpad)" ed25519 cert 5y
FPR=<primary fingerprint printed above>
gpg --quick-add-key "$FPR" ed25519 sign 1y
SUBFPR=$(gpg --with-colons --list-keys "$FPR" | awk -F: '$1=="fpr"{print $10}' | sed -n 2p)

# Public key for the website and CI verification
gpg --armor --export "$FPR" > site/release-signing-key.asc

# Secret for CI: the signing subkey only
gpg --armor --export-secret-subkeys "$SUBFPR!" > signing-subkey.asc

# Revocation certificate for the primary key (store offline; see Revocation)
gpg --output scratchpad-release-revoke.asc --gen-revoke "$FPR"
```

Then:

1. Replace `FINGERPRINT-PENDING` in `site/index.html` and `docs/verify-linux-downloads.md` with the primary fingerprint, in groups of four (`gpg --fingerprint "$FPR"`, single spaces). `test/release-signing-key.test.js` checks that both match `site/release-signing-key.asc`.
2. In **Settings → Environments**, create `release-signing` with required reviewers and deployment branches limited to `main`. The Beta Release build job runs in this environment.
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

Both scripts run on Ubuntu 22.04 (the release runner). `sign-linux-release.sh <key> --assets-dir DIR --no-upload` signs and verifies a local AppImage and `.deb` without contacting GitHub.
