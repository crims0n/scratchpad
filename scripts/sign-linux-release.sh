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
architecture=x64
packages_only=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --assets-dir) assets_dir=${2:?--assets-dir needs a directory}; shift 2 ;;
    --architecture) architecture=${2:?--architecture needs x64, arm64 or all}; shift 2 ;;
    --packages-only) packages_only=true; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$architecture" in
  x64) architectures=(x64) ;;
  arm64) architectures=(arm64) ;;
  all) architectures=(x64 arm64) ;;
  *) echo 'Architecture must be x64, arm64 or all' >&2; exit 2 ;;
esac

: "${assets_dir:?--assets-dir must select local release assets}"
assets_dir=$(cd "$assets_dir" && pwd)

fingerprint=${SIGNING_KEY_FINGERPRINT:?SIGNING_KEY_FINGERPRINT must be set}
public_key=$(realpath "$public_key")
scripts=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/linux-release.XXXXXX")
mkdir -p "$work/assets" "$work/verify"
echo "Working in $work"
trap 'rm -rf "$work"' EXIT

fail() {
  echo "::error::$*"
  exit 1
}

# 1. Select exactly one package pair per requested architecture.
shopt -s nullglob
packages=()
appimages=()
for arch in "${architectures[@]}"; do
  if [[ "$arch" == x64 ]]; then appimage_arch=amd64; deb_arch=amd64
  else appimage_arch=aarch64; deb_arch=arm64; fi
  images=("$assets_dir"/*_"$appimage_arch".AppImage)
  debs=("$assets_dir"/*_"$deb_arch".deb)
  [[ ${#images[@]} -eq 1 && ${#debs[@]} -eq 1 ]] || fail "Expected exactly one AppImage and DEB for $arch."
  appimages+=("$(basename "${images[0]}")")
  packages+=("$(basename "${images[0]}")" "$(basename "${debs[0]}")")
  cp "${images[0]}" "${debs[0]}" "$work/assets/"
done
shopt -u nullglob
cd "$work/assets"

# A clean keyring holding only the published key: verification must not rely
# on anything else present on the runner.
gpg --batch --dearmor < "$public_key" > "$work/verify/release-signing.gpg"
key_fingerprints=$(gpg --batch --show-keys --with-colons "$public_key" | awk -F: '$1 == "fpr" { print $10 }')
grep -qx "$fingerprint" <<< "$key_fingerprints" || fail "Imported key $fingerprint is not the published key."

# 2. Require an embedded signature packet identifying the published key.
# The authenticated checksum manifest below binds the complete final bytes.
for appimage in "${appimages[@]}"; do
  "${OBJCOPY:-objcopy}" --dump-section .sha256_sig="$work/verify/appimage.sig.raw" "$appimage" "$work/verify/appimage.discard" 2>/dev/null \
    || fail "$appimage has no .sha256_sig section."
  tr -d '\000' < "$work/verify/appimage.sig.raw" > "$work/verify/appimage.sig.asc"
  grep -q "BEGIN PGP SIGNATURE" "$work/verify/appimage.sig.asc" || fail "$appimage is not signed (empty .sha256_sig)."
  issuer=$(gpg --batch --list-packets "$work/verify/appimage.sig.asc" 2>/dev/null \
    | sed -n 's/.*issuer fpr v4 \([0-9A-F]\{40\}\).*/\1/p' | head -n 1)
  grep -qx "$issuer" <<< "$key_fingerprints" || fail "$appimage was signed by ${issuer:-an unknown key}, not the published key."
  echo "AppImage embedded signature issued by $issuer"

done

# Build jobs inspect native package payloads before recording these hashes.
# They leave checksum creation to the single aggregation job.
if [[ "$packages_only" == true ]]; then
  [[ "$architecture" != all ]] || fail 'Package-only verification requires one architecture.'
  for file in "${packages[@]}"; do
    cmp -s "$file" "$assets_dir/$file" || fail "Package changed during verification: $file"
  done
  cd "$assets_dir"
  node "$scripts/release-verification.mjs" linux "${packages[@]}"
  exit 0
fi

# 3. Checksums are computed from the final, already-signed files.
sha256sum "${packages[@]}" > SHA256SUMS
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
for file in "${packages[@]}"; do
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
for file in "${packages[@]}" SHA256SUMS SHA256SUMS.asc; do
  cp "$file" "$assets_dir/$file"
  cmp -s "$file" "$assets_dir/$file" || fail "Staged copy does not match verified bytes: $file"
done
cd "$assets_dir"
if [[ -n "${VERIFICATION_EVIDENCE_PATH:-}" ]]; then
  [[ "$architecture" == all ]] || fail 'Stable checksum evidence requires both architectures.'
  node "$scripts/release-verification.mjs" linux SHA256SUMS SHA256SUMS.asc
fi
if [[ -n "${SIGNING_VALIDATION_EVIDENCE_PATH:-}" ]]; then
  [[ "$architecture" != all ]] || fail 'Probe evidence requires one architecture.'
  node "$scripts/record-linux-signing-validation.mjs" "$architecture" "$fingerprint" "${packages[@]}" SHA256SUMS SHA256SUMS.asc
fi
