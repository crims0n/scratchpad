#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Sign and verify local Linux assets, then place SHA256SUMS and its signature
# beside those packages. No GitHub token or draft access is used.
# Usage: sign-linux-release.sh <public-key.asc> --assets-dir DIR
# Env: SIGNING_KEY_FINGERPRINT (primary fingerprint of the imported key)

set -euo pipefail

public_key=${1:?usage: sign-linux-release.sh <public-key.asc> --assets-dir DIR}
shift
assets_dir=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --assets-dir) assets_dir=${2:?--assets-dir needs a directory}; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

: "${assets_dir:?--assets-dir must select local release assets}"
assets_dir=$(cd "$assets_dir" && pwd)

fingerprint=${SIGNING_KEY_FINGERPRINT:?SIGNING_KEY_FINGERPRINT must be set}
public_key=$(realpath "$public_key")
scripts=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/linux-release.XXXXXX")
mkdir -p "$work/assets" "$work/verify"
echo "Working in $work"

fail() {
  echo "::error::$*"
  exit 1
}

# 1. Copy only the staged platform packages into an isolated work directory.
cp "$assets_dir"/*_amd64.AppImage "$assets_dir"/*_amd64.deb "$work/assets/"

cd "$work/assets"
shopt -s nullglob
appimages=(*_amd64.AppImage)
debs=(*_amd64.deb)
shopt -u nullglob
[[ ${#appimages[@]} -eq 1 ]] || fail "Expected one AppImage in the release, found ${#appimages[@]}."
[[ ${#debs[@]} -eq 1 ]] || fail "Expected one .deb in the release, found ${#debs[@]}."
appimage=${appimages[0]}
deb=${debs[0]}

# A clean keyring holding only the published key: verification must not rely
# on anything else present on the runner.
gpg --batch --dearmor < "$public_key" > "$work/verify/release-signing.gpg"
key_fingerprints=$(gpg --batch --show-keys --with-colons "$public_key" | awk -F: '$1 == "fpr" { print $10 }')
grep -qx "$fingerprint" <<< "$key_fingerprints" || fail "Imported key $fingerprint is not the published key."

# 2. The AppImage must carry an embedded signature made by the published key.
objcopy --dump-section .sha256_sig="$work/verify/appimage.sig.raw" "$appimage" "$work/verify/appimage.discard" 2>/dev/null \
  || fail "$appimage has no .sha256_sig section."
tr -d '\000' < "$work/verify/appimage.sig.raw" > "$work/verify/appimage.sig.asc"
grep -q "BEGIN PGP SIGNATURE" "$work/verify/appimage.sig.asc" || fail "$appimage is not signed (empty .sha256_sig)."
issuer=$(gpg --batch --list-packets "$work/verify/appimage.sig.asc" 2>/dev/null \
  | sed -n 's/.*issuer fpr v4 \([0-9A-F]\{40\}\).*/\1/p' | head -n 1)
grep -qx "$issuer" <<< "$key_fingerprints" || fail "$appimage was signed by ${issuer:-an unknown key}, not the published key."
echo "AppImage embedded signature issued by $issuer"

# 3. Checksums are computed from the final, already-signed files.
sha256sum "$appimage" "$deb" > SHA256SUMS
rm -f SHA256SUMS.asc
gpg --batch --local-user "$fingerprint" --armor --detach-sign --output SHA256SUMS.asc SHA256SUMS

# 4. Verify the way users will, then prove tampering is detected.
gpgv --keyring "$work/verify/release-signing.gpg" SHA256SUMS.asc SHA256SUMS
sha256sum --check --strict SHA256SUMS

cp SHA256SUMS "$work/verify/SHA256SUMS.modified"
echo "0000000000000000000000000000000000000000000000000000000000000000  extra.bin" >> "$work/verify/SHA256SUMS.modified"
if gpgv --keyring "$work/verify/release-signing.gpg" SHA256SUMS.asc "$work/verify/SHA256SUMS.modified" 2>/dev/null; then
  fail "A modified SHA256SUMS still verified."
fi

mkdir "$work/verify/tampered"
for file in "$appimage" "$deb"; do
  cp "$file" "$work/verify/tampered/"
  size=$(stat -c %s "$file")
  printf '\x00' | dd of="$work/verify/tampered/$file" bs=1 seek=$((size / 2)) conv=notrunc status=none
  if cmp -s "$file" "$work/verify/tampered/$file"; then
    printf '\x01' | dd of="$work/verify/tampered/$file" bs=1 seek=$((size / 2)) conv=notrunc status=none
  fi
done
cp SHA256SUMS "$work/verify/tampered/"
if (cd "$work/verify/tampered" && sha256sum --check --strict --quiet SHA256SUMS 2>/dev/null); then
  fail "Modified release assets still matched SHA256SUMS."
fi
echo "Verified SHA256SUMS signature; modified checksums and assets were rejected."

# 5. Hand the exact verified bytes back to the staging directory. A separate
# upload job alone can modify the draft release.
for file in "$appimage" "$deb" SHA256SUMS SHA256SUMS.asc; do
  cp "$file" "$assets_dir/$file"
  cmp -s "$file" "$assets_dir/$file" || fail "Staged copy does not match verified bytes: $file"
done
cd "$assets_dir"
if [[ -n "${VERIFICATION_EVIDENCE_PATH:-}" ]]; then
  node "$scripts/release-verification.mjs" linux "$appimage" "$deb" SHA256SUMS SHA256SUMS.asc
fi
