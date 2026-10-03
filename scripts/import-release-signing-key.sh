#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Imports the Linux release-signing key into the runner's GnuPG home so the
# Tauri bundler (appimagetool) and sign-linux-release.sh can sign without a
# prompt. Fails unless the secret key matches the published public key.
#
# Usage: import-release-signing-key.sh <public-key.asc>
# Env:   RELEASE_SIGNING_GPG_PRIVATE_KEY  armored secret key (signing subkey)
#        RELEASE_SIGNING_GPG_PASSPHRASE   its passphrase
# Output: fingerprint=<primary fingerprint> on $GITHUB_OUTPUT when set.

set -euo pipefail

public_key=${1:?usage: import-release-signing-key.sh <public-key.asc>}

if [[ ! -s "$public_key" ]]; then
  echo "::error::Published release-signing public key $public_key is missing. See docs/release-signing.md."
  exit 1
fi
if [[ -z "${RELEASE_SIGNING_GPG_PRIVATE_KEY:-}" || -z "${RELEASE_SIGNING_GPG_PASSPHRASE:-}" ]]; then
  echo "::error::RELEASE_SIGNING_GPG_PRIVATE_KEY and RELEASE_SIGNING_GPG_PASSPHRASE must be set in the release-signing environment. See docs/release-signing.md."
  exit 1
fi

expected=$(gpg --batch --show-keys --with-colons "$public_key" | awk -F: '$1 == "fpr" { print $10; exit }')
if [[ ! "$expected" =~ ^[0-9A-F]{40}$ ]]; then
  echo "::error::Could not read a v4 fingerprint from $public_key."
  exit 1
fi

export GNUPGHOME=${GNUPGHOME:-$HOME/.gnupg}
mkdir -p "$GNUPGHOME"
chmod 700 "$GNUPGHOME"
# Loopback lets gpg accept a passphrase from callers; presetting below means
# appimagetool's own gpg invocation never needs to ask.
cat >> "$GNUPGHOME/gpg-agent.conf" <<'CONF'
allow-loopback-pinentry
allow-preset-passphrase
CONF
echo "pinentry-mode loopback" >> "$GNUPGHOME/gpg.conf"
gpgconf --kill gpg-agent

printf '%s\n' "$RELEASE_SIGNING_GPG_PRIVATE_KEY" | gpg --batch --import

imported=$(gpg --batch --list-secret-keys --with-colons "$expected" 2>/dev/null | awk -F: '$1 == "fpr" { print $10; exit }' || true)
if [[ "$imported" != "$expected" ]]; then
  echo "::error::The signing secret does not belong to the published key $expected."
  exit 1
fi

preset=$(gpgconf --list-dirs libexecdir)/gpg-preset-passphrase
gpg --batch --list-secret-keys --with-colons --with-keygrip "$expected" \
  | awk -F: '$1 == "grp" { print $10 }' \
  | while read -r keygrip; do
      printf '%s' "$RELEASE_SIGNING_GPG_PASSPHRASE" | "$preset" --preset "$keygrip"
    done

# Prove the key can sign non-interactively before spending time on a build.
echo "signing check" | gpg --batch --local-user "$expected" --detach-sign --armor > /dev/null

echo "Imported release-signing key $expected"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "fingerprint=$expected" >> "$GITHUB_OUTPUT"
fi
