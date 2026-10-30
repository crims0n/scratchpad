# Verifying Linux downloads

Signed Linux releases from v0.8.2 onward on [GitHub Releases](https://github.com/crims0n/scratchpad/releases) include:

- `Scratchpad…_amd64.AppImage` with an embedded GPG signature;
- `Scratchpad…_amd64.deb`;
- `SHA256SUMS`, the SHA-256 checksums of all Linux packages in that release; and
- `SHA256SUMS.asc`, a detached GPG signature of `SHA256SUMS`.

Releases that add native ARM64 also include `_aarch64.AppImage` and `_arm64.deb` in the same signed checksum manifest. Use the package matching your CPU and the files from that exact release; published v1.0.0 has only x64 Linux packages.

Linux does not require these signatures to run Scratchpad. They let you confirm that a download was built by the Scratchpad release workflow and has not been modified.

## Release-signing key

- Public key: <https://crims0n.github.io/scratchpad/release-signing-key.asc>
- Fingerprint: `1AD2 0240 0B0C 14AD 86F4 3E14 4F6B 122C D9DC CB40`

Check the fingerprint against this page and the [Scratchpad website](https://crims0n.github.io/scratchpad/#verify-linux) before trusting the key. Both are served over HTTPS from the project's repository.

## Verify the AppImage or .deb

Download the package, `SHA256SUMS`, and `SHA256SUMS.asc` from the same release into one directory, then run:

```bash
curl -fsSLO https://crims0n.github.io/scratchpad/release-signing-key.asc
gpg --show-keys --fingerprint release-signing-key.asc   # compare with the fingerprint above
gpg --dearmor < release-signing-key.asc > scratchpad-release.gpg

gpgv --keyring ./scratchpad-release.gpg SHA256SUMS.asc SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
```

Both commands must succeed: `gpgv` must report a good signature, and `sha256sum` must print `OK` for each package you downloaded. Do not install the package if either command fails. `gpgv` checks only against the key you downloaded, so nothing in your personal keyring affects the result.

## The AppImage's embedded signature

After verifying the signed checksums, you can display the AppImage's embedded signature with:

```bash
./Scratchpad*_amd64.AppImage --appimage-signature
```

Launching an AppImage does **not** validate this signature, and most desktop integrations ignore it. Use the `SHA256SUMS` procedure above to verify a download.

## The .deb package

`apt` and `dpkg` do not authenticate a `.deb` that you downloaded directly against the project's signing key. Scratchpad does not host an APT repository, so verify with `SHA256SUMS` before running `sudo apt install ./Scratchpad_1.0.0_amd64.deb` (substitute your actual downloaded filename).

## Key changes

If the key is rotated or revoked, this page, the website, and the release notes will say so. GnuPG documents that [`gpgv` trusts the supplied keyring and does not check key expiry or revocation](https://www.gnupg.org/documentation/manuals/gnupg/gpgv.html). A good-signature message alone does not establish that the key is still trusted. Download the current public key, compare its fingerprint, and follow any expiry/revocation notice before installing; do not trust a revoked key's signatures.
