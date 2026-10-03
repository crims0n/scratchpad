#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Signs the final Linux release assets. Downloads the AppImage and .deb exactly
# as uploaded to the draft release, checks the AppImage's embedded signature,
# writes and signs SHA256SUMS, verifies everything against the published public
# key alone (including tampered copies that must fail), then uploads
# SHA256SUMS and SHA256SUMS.asc to the draft.
#
# Usage: sign-linux-release.sh <public-key.asc> [--assets-dir DIR] [--no-upload]
#   --assets-dir  use already-downloaded assets in DIR instead of the release
#   --no-upload   leave the signed files in the work directory
# Env:   SIGNING_KEY_FINGERPRINT  primary fingerprint of the imported key
#        RELEASE_ID, GITHUB_REPOSITORY, GH_TOKEN  (unless --assets-dir/--no-upload)

set -euo pipefail

public_key=${1:?usage: sign-linux-release.sh <public-key.asc> [--assets-dir DIR] [--no-upload]}
shift
assets_dir=""
upload=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --assets-dir) assets_dir=${2:?--assets-dir needs a directory}; shift 2 ;;
    --no-upload) upload=0; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

fingerprint=${SIGNING_KEY_FINGERPRINT:?SIGNING_KEY_FINGERPRINT must be set}
public_key=$(realpath "$public_key")
work=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/linux-release.XXXXXX")
mkdir -p "$work/assets" "$work/verify"
echo "Working in $work"

fail() {
  echo "::error::$*"
  exit 1
}

# 1. Fetch the final assets (exactly what users will download).
if [[ -n "$assets_dir" ]]; then
  cp "$assets_dir"/*_amd64.AppImage "$assets_dir"/*_amd64.deb "$work/assets/"
else
  : "${RELEASE_ID:?RELEASE_ID must be set}" "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
  gh api "repos/$GITHUB_REPOSITORY/releases/$RELEASE_ID" \
    --jq '.assets[] | select(.name | test("_amd64\\.(AppImage|deb)$")) | "\(.id)\t\(.name)"' \
    | while IFS=$'\t' read -r id name; do
        gh api -H "Accept: application/octet-stream" "repos/$GITHUB_REPOSITORY/releases/assets/$id" > "$work/assets/$name"
      done
fi

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

# 5. Attach the signed manifest to the draft release.
if [[ "$upload" -eq 1 ]]; then
  : "${RELEASE_ID:?RELEASE_ID must be set}" "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
  for name in SHA256SUMS SHA256SUMS.asc; do
    existing=$(gh api "repos/$GITHUB_REPOSITORY/releases/$RELEASE_ID" --jq ".assets[] | select(.name == \"$name\") | .id")
    if [[ -n "$existing" ]]; then
      gh api --method DELETE "repos/$GITHUB_REPOSITORY/releases/assets/$existing"
    fi
    gh api --method POST -H "Content-Type: text/plain" \
      "https://uploads.github.com/repos/$GITHUB_REPOSITORY/releases/$RELEASE_ID/assets?name=$name" \
      --input "$name" > /dev/null
    echo "Uploaded $name"
  done
fi

cat SHA256SUMS
