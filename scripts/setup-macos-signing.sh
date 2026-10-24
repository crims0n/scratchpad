#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Imports the Developer ID Application certificate into a temporary keychain so
# the Tauri bundler and finalize-macos-release.sh can sign without a prompt, and
# writes the App Store Connect API key used for notarization. Fails unless the
# imported identity is the one in the signing config and the API key is
# accepted by the notary service, so bad credentials stop the job before the
# build.
#
# Usage: setup-macos-signing.sh <tauri.macos-signing.conf.json>
# Env:   APPLE_CERTIFICATE           base64 .p12 holding the certificate and private key
#        APPLE_CERTIFICATE_PASSWORD  the .p12 export password
#        KEYCHAIN_PASSWORD           password for the temporary keychain
#        APPLE_API_PRIVATE_KEY       contents of the App Store Connect .p8 key
#        APPLE_API_KEY               its key ID
#        APPLE_API_ISSUER            its issuer ID
#        RUNNER_TEMP                 where the keychain and key are written
# Output: identity, team_id, keychain and api_key_path on $GITHUB_OUTPUT when set.

set -euo pipefail

config=${1:?usage: setup-macos-signing.sh <tauri.macos-signing.conf.json>}

fail() {
  echo "::error::$*"
  exit 1
}

for name in APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD KEYCHAIN_PASSWORD APPLE_API_PRIVATE_KEY APPLE_API_KEY APPLE_API_ISSUER RUNNER_TEMP; do
  [[ -n "${!name:-}" ]] || fail "$name must be set in the release-signing environment. See docs/macos-release-signing.md."
done

identity=$(plutil -extract bundle.macOS.signingIdentity raw -o - "$config" 2>/dev/null) \
  || fail "$config has no bundle.macOS.signingIdentity."
[[ "$identity" =~ ^Developer\ ID\ Application:\ .+\ \(([A-Z0-9]{10})\)$ ]] \
  || fail "Signing identity \"$identity\" is not a Developer ID Application identity."
team_id=${BASH_REMATCH[1]}

# Fixed paths, so the workflow's cleanup step can remove them even if this
# script stops part-way.
keychain="$RUNNER_TEMP/scratchpad-signing.keychain-db"
key_dir="$RUNNER_TEMP/private_keys"
certificate="$RUNNER_TEMP/developer-id.p12"
trap 'rm -f "$certificate"' EXIT

(umask 077; printf '%s' "$APPLE_CERTIFICATE" | base64 --decode > "$certificate") \
  || fail "APPLE_CERTIFICATE is not valid base64."

security create-keychain -p "$KEYCHAIN_PASSWORD" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$keychain"
security import "$certificate" -k "$keychain" -f pkcs12 -P "$APPLE_CERTIFICATE_PASSWORD" \
  -T /usr/bin/codesign -T /usr/bin/security > /dev/null \
  || fail "Could not import APPLE_CERTIFICATE. Check APPLE_CERTIFICATE_PASSWORD."
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$keychain" > /dev/null

# Put the keychain first in the search list (codesign has no --keychain option
# through Tauri), keeping the runner's existing keychains after it.
search_list=("$keychain")
while IFS= read -r entry; do
  entry=${entry#"${entry%%[![:space:]]*}"}
  entry=${entry#\"}
  entry=${entry%\"}
  [[ -n "$entry" && "$entry" != "$keychain" ]] && search_list+=("$entry")
done < <(security list-keychains -d user)
security list-keychains -d user -s "${search_list[@]}"

security find-identity -v -p codesigning "$keychain" | grep -qF "\"$identity\"" \
  || fail "APPLE_CERTIFICATE does not contain a valid \"$identity\" identity. It may be expired or revoked, or the signing config may need updating."
echo "Imported \"$identity\""

mkdir -p "$key_dir"
chmod 700 "$key_dir"
api_key_path="$key_dir/AuthKey_${APPLE_API_KEY}.p8"
(umask 077; printf '%s\n' "$APPLE_API_PRIVATE_KEY" > "$api_key_path")
grep -q "BEGIN PRIVATE KEY" "$api_key_path" || fail "APPLE_API_PRIVATE_KEY is not a .p8 private key."

xcrun notarytool history --key "$api_key_path" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" > /dev/null \
  || fail "The notary service rejected the App Store Connect API key. Check APPLE_API_KEY, APPLE_API_ISSUER and APPLE_API_PRIVATE_KEY."
echo "Notary service accepted API key $APPLE_API_KEY"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "identity=$identity"
    echo "team_id=$team_id"
    echo "keychain=$keychain"
    echo "api_key_path=$api_key_path"
  } >> "$GITHUB_OUTPUT"
fi
