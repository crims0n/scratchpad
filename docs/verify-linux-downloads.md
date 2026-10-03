# Verifying Linux downloads

Every Linux release on [GitHub Releases](https://github.com/crims0n/scratchpad/releases) includes:

- `Scratchpad…_amd64.AppImage` with an embedded GPG signature;
- `Scratchpad…_amd64.deb`;
- `SHA256SUMS`, the SHA-256 checksums of both packages; and
- `SHA256SUMS.asc`, a detached GPG signature of `SHA256SUMS`.

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

The AppImage also carries its own signature, which you can display with:

```bash
./Scratchpad*_amd64.AppImage --appimage-signature
```

Launching an AppImage does **not** validate this signature, and most desktop integrations ignore it. Use the `SHA256SUMS` procedure above to verify a download.

## The .deb package

`apt` and `dpkg` do not verify a `.deb` that you downloaded directly. Scratchpad does not host an APT repository, so verifying with `SHA256SUMS` before running `sudo apt install ./Scratchpad…_amd64.deb` is the only check.

## Key changes

If the key is rotated or revoked, this page, the website, and the release notes will say so. A revoked key's signatures must not be trusted, even if `gpgv` reports them as good with an older copy of the key. Always download the current key from the website.
