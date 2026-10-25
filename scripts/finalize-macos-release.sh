#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Finalize and verify local macOS release assets, then replace the staged DMG
# with its notarized/stapled bytes. No GitHub token or draft access is used.
# Usage: finalize-macos-release.sh --assets-dir DIR
# Env: MACOS_SIGNING_IDENTITY, MACOS_SIGNING_TEAM_ID, MACOS_SIGNING_KEYCHAIN,
#      APPLE_API_KEY, APPLE_API_ISSUER, APPLE_API_KEY_PATH

set -euo pipefail

assets_dir=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --assets-dir) assets_dir=${2:?--assets-dir needs a directory}; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

: "${assets_dir:?--assets-dir must select local release assets}"
assets_dir=$(cd "$assets_dir" && pwd)

: "${MACOS_SIGNING_IDENTITY:?MACOS_SIGNING_IDENTITY must be set}" "${MACOS_SIGNING_TEAM_ID:?MACOS_SIGNING_TEAM_ID must be set}"
: "${APPLE_API_KEY:?APPLE_API_KEY must be set}" "${APPLE_API_ISSUER:?APPLE_API_ISSUER must be set}" "${APPLE_API_KEY_PATH:?APPLE_API_KEY_PATH must be set}"
scripts=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/macos-release.XXXXXX")
mkdir -p "$work/assets"
echo "Working in $work"

fail() {
  echo "::error::$*"
  exit 1
}

# 1. Copy only the staged platform packages into an isolated work directory.
cp "$assets_dir"/*_universal.dmg "$assets_dir"/*_universal.app.tar.gz "$work/assets/"

cd "$work/assets"
shopt -s nullglob
dmgs=(*_universal.dmg)
archives=(*_universal.app.tar.gz)
shopt -u nullglob
[[ ${#dmgs[@]} -eq 1 ]] || fail "Expected one universal DMG in the release, found ${#dmgs[@]}."
[[ ${#archives[@]} -eq 1 ]] || fail "Expected one universal app archive in the release, found ${#archives[@]}."
dmg=${dmgs[0]}
archive=${archives[0]}

# 2. Tauri signs the DMG when an identity is configured; sign it here if not.
requirement="anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = \"$MACOS_SIGNING_TEAM_ID\""
if ! codesign --verify --strict -R "=$requirement" "$dmg" 2>/dev/null; then
  : "${MACOS_SIGNING_KEYCHAIN:?MACOS_SIGNING_KEYCHAIN must be set to sign the DMG}"
  echo "Signing $dmg"
  codesign --force --timestamp --sign "$MACOS_SIGNING_IDENTITY" --keychain "$MACOS_SIGNING_KEYCHAIN" "$dmg"
fi

# 3. Notarize and staple the DMG so it opens offline without a security prompt.
echo "Notarizing $dmg"
submission=$(xcrun notarytool submit "$dmg" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" \
  --issuer "$APPLE_API_ISSUER" --wait --timeout 1h --output-format json) || true
submission_id=$(plutil -extract id raw -o - - <<< "$submission" 2>/dev/null || true)
status=$(plutil -extract status raw -o - - <<< "$submission" 2>/dev/null || true)
if [[ "$status" != "Accepted" ]]; then
  if [[ -n "$submission_id" ]]; then
    xcrun notarytool log "$submission_id" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" \
      --issuer "$APPLE_API_ISSUER" || true
  fi
  fail "Notarization of $dmg finished with status ${status:-unknown}: $submission"
fi
echo "Notarization accepted (submission $submission_id)"
xcrun stapler staple "$dmg"

# 4. Verify the stapled DMG and the app archive before anything is replaced.
"$scripts/verify-macos-release.sh" --team "$MACOS_SIGNING_TEAM_ID" "$dmg" "$archive"

# 5. Hand the exact verified bytes back to the staging directory. A separate
# upload job alone can modify the draft release.
for file in "$dmg" "$archive"; do
  cp "$file" "$assets_dir/$file"
  cmp -s "$file" "$assets_dir/$file" || fail "Staged copy does not match verified bytes: $file"
done
cd "$assets_dir"
if [[ -n "${VERIFICATION_EVIDENCE_PATH:-}" ]]; then
  node "$scripts/release-verification.mjs" macos "$dmg" "$archive"
fi
