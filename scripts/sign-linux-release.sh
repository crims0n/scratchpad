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

# Reject invalid evidence/mode combinations before reading keys or touching
# package/checksum files. Probe signing intentionally supports one pair.
if [[ "$packages_only" == true ]]; then
  [[ "$architecture" != all && -n "${VERIFICATION_EVIDENCE_PATH:-}" && -z "${SIGNING_VALIDATION_EVIDENCE_PATH:-}" ]] \
    || { echo 'Package-only mode requires one stable architecture record' >&2; exit 2; }
elif [[ -n "${VERIFICATION_EVIDENCE_PATH:-}" && "$architecture" != all ]]; then
  echo 'Stable checksum evidence requires both architectures' >&2; exit 2
fi
if [[ -n "${SIGNING_VALIDATION_EVIDENCE_PATH:-}" && "$architecture" == all ]]; then
  echo 'Probe evidence requires one architecture' >&2; exit 2
fi

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

# 2. Authenticate each embedded signature over appimagetool's normalized
# digest, using only the published public key. Never execute the AppImage.
for appimage in "${appimages[@]}"; do
  node "$scripts/appimage-signature.mjs" "$appimage" "$public_key"
done

# Build jobs inspect native package payloads before recording these hashes.
# They leave checksum creation to the single aggregation job.
if [[ "$packages_only" == true ]]; then
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
gpgv --homedir "$work/verify" --keyring "$work/verify/release-signing.gpg" SHA256SUMS.asc SHA256SUMS
sha256sum --check --strict SHA256SUMS

cp SHA256SUMS "$work/verify/SHA256SUMS.modified"
echo "0000000000000000000000000000000000000000000000000000000000000000  extra.bin" >> "$work/verify/SHA256SUMS.modified"
if gpgv --homedir "$work/verify" --keyring "$work/verify/release-signing.gpg" SHA256SUMS.asc "$work/verify/SHA256SUMS.modified" 2>/dev/null; then
  fail "A modified SHA256SUMS still verified."
fi

mkdir "$work/verify/tampered"
for file in "${packages[@]}"; do
  cp "$file" "$work/verify/tampered/"
  node --input-type=module - "$work/verify/tampered/$file" <<'NODE'
import { openSync, fstatSync, readSync, writeSync, closeSync } from "node:fs";
const file = openSync(process.argv[2], "r+");
try {
  const position = Math.floor(fstatSync(file).size / 2);
  const byte = Buffer.alloc(1);
  if (readSync(file, byte, 0, 1, position) !== 1) throw new Error("Empty tamper fixture");
  byte[0] ^= 1;
  writeSync(file, byte, 0, 1, position);
} finally { closeSync(file); }
NODE
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
  node "$scripts/release-verification.mjs" linux SHA256SUMS SHA256SUMS.asc
fi
if [[ -n "${SIGNING_VALIDATION_EVIDENCE_PATH:-}" ]]; then
  node "$scripts/record-linux-signing-validation.mjs" "$architecture" "$fingerprint" "${packages[@]}" SHA256SUMS SHA256SUMS.asc
fi
