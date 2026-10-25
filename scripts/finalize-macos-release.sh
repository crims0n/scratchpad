#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Finishes the macOS release. Tauri signs, notarizes and staples the app, but
# only signs the DMG. This script downloads the DMG and app archive exactly as
# uploaded to the draft release, makes sure the DMG carries the Developer ID
# signature, notarizes and staples it, verifies both artifacts with
# verify-macos-release.sh, then replaces the draft's DMG with the stapled one
# and checks GitHub's digest of the upload matches.
#
# Usage: finalize-macos-release.sh [--assets-dir DIR] [--no-upload]
#   --assets-dir  use already-downloaded assets in DIR instead of the release
#   --no-upload   leave the stapled DMG in the work directory
# Env:   MACOS_SIGNING_IDENTITY, MACOS_SIGNING_TEAM_ID, MACOS_SIGNING_KEYCHAIN
#        APPLE_API_KEY, APPLE_API_ISSUER, APPLE_API_KEY_PATH
#        RELEASE_ID, GITHUB_REPOSITORY, GH_TOKEN  (unless --assets-dir/--no-upload)

set -euo pipefail

assets_dir=""
upload=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --assets-dir) assets_dir=${2:?--assets-dir needs a directory}; shift 2 ;;
    --no-upload) upload=0; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

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

# 1. Fetch the final assets (exactly what users will download).
if [[ -n "$assets_dir" ]]; then
  cp "$assets_dir"/*_universal.dmg "$assets_dir"/*_universal.app.tar.gz "$work/assets/"
else
  : "${RELEASE_ID:?RELEASE_ID must be set}" "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
  gh api "repos/$GITHUB_REPOSITORY/releases/$RELEASE_ID" \
    --jq '.assets[] | select(.name | test("_universal\\.(dmg|app\\.tar\\.gz)$")) | "\(.id)\t\(.name)"' \
    | while IFS=$'\t' read -r id name; do
        gh api -H "Accept: application/octet-stream" "repos/$GITHUB_REPOSITORY/releases/assets/$id" > "$work/assets/$name"
      done
fi

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

# 5. Replace the draft's DMG. Published checksums come from GitHub's digest of
# this upload, so confirm it describes the stapled file.
if [[ "$upload" -eq 1 ]]; then
  : "${RELEASE_ID:?RELEASE_ID must be set}" "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
  existing=$(gh api "repos/$GITHUB_REPOSITORY/releases/$RELEASE_ID" --jq ".assets[] | select(.name == \"$dmg\") | .id")
  if [[ -n "$existing" ]]; then
    gh api --method DELETE "repos/$GITHUB_REPOSITORY/releases/assets/$existing"
  fi
  asset=$(gh api --method POST -H "Content-Type: application/x-apple-diskimage" \
    "https://uploads.github.com/repos/$GITHUB_REPOSITORY/releases/$RELEASE_ID/assets?name=$dmg" \
    --input "$dmg" --jq '.id')
  expected="sha256:$(shasum -a 256 "$dmg" | cut -d ' ' -f 1)"
  digest=""
  for _ in 1 2 3 4 5 6; do
    digest=$(gh api "repos/$GITHUB_REPOSITORY/releases/assets/$asset" --jq '.digest // empty')
    [[ -n "$digest" ]] && break
    sleep 5
  done
  [[ "$digest" == "$expected" ]] || fail "GitHub recorded digest ${digest:-none} for $dmg, expected $expected."
  echo "Uploaded stapled $dmg ($digest)"
else
  echo "Stapled DMG left at $work/assets/$dmg"
fi

# Hash the exact local files just verified, including the final stapled DMG.
if [[ -n "${VERIFICATION_EVIDENCE_PATH:-}" ]]; then
  node "$scripts/release-verification.mjs" macos "$dmg" "$archive"
fi
