#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Builds, signs and verifies the Mac App Store package, then validates it with
# App Store Connect and, when UPLOAD=true, uploads it. Separate from the website
# release: it uses its own certificates, bundle ID and GitHub environment, and
# reads none of the release-signing configuration. See docs/appstore-release.md.
#
# Usage: appstore-package.sh
# Env:   APPSTORE_DISTRIBUTION_P12           base64 .p12 with the Apple Distribution identity
#        APPSTORE_DISTRIBUTION_P12_PASSWORD  its export password
#        APPSTORE_INSTALLER_P12              base64 .p12 with the Mac Installer Distribution identity
#        APPSTORE_INSTALLER_P12_PASSWORD     its export password
#        APPSTORE_PROVISION_PROFILE          base64 Mac App Store Connect provisioning profile
#        APPSTORE_API_KEY                    base64 App Store Connect .p8 key
#        APPSTORE_API_KEY_ID                 its key ID
#        APPSTORE_API_ISSUER_ID              its issuer ID
#        BUILD_NUMBER                        CFBundleVersion; must increase on every upload
#        UPLOAD                              "true" to upload after validation
#        RUNNER_TEMP                         where credentials and output are written
# Output: package=<path to the .pkg> on $GITHUB_OUTPUT when set.

set -euo pipefail

# The team that owns the App Store record. Changing it is a reviewed code change.
readonly TEAM_ID=B62UYUQ6C3
readonly UPDATE_ENDPOINT=crims0n.github.io/scratchpad/release.json

fail() {
  echo "::error::$*"
  exit 1
}

for name in APPSTORE_DISTRIBUTION_P12 APPSTORE_DISTRIBUTION_P12_PASSWORD APPSTORE_INSTALLER_P12 \
  APPSTORE_INSTALLER_P12_PASSWORD APPSTORE_PROVISION_PROFILE APPSTORE_API_KEY APPSTORE_API_KEY_ID \
  APPSTORE_API_ISSUER_ID BUILD_NUMBER RUNNER_TEMP; do
  [[ -n "${!name:-}" ]] || fail "$name must be set. See docs/appstore-release.md."
done
[[ "$BUILD_NUMBER" =~ ^[1-9][0-9]*$ ]] || fail "BUILD_NUMBER must be a positive integer."

root=$(cd "$(dirname "$0")/.." && pwd)
release_config="$root/src-tauri/tauri.appstore-release.conf.json"
bundle_id=$(plutil -extract identifier raw -o - "$release_config")
product=$(plutil -extract productName raw -o - "$release_config")
binary=$(plutil -extract mainBinaryName raw -o - "$release_config")
version=$(plutil -extract version raw -o - "$root/src-tauri/tauri.conf.json")

# Fixed paths, so the workflow's cleanup step can remove them even if this
# script stops part-way.
work="$RUNNER_TEMP/appstore"
keychain="$RUNNER_TEMP/scratchpad-appstore.keychain-db"
rm -rf "$work"
mkdir -p "$work/private_keys"
chmod 700 "$work" "$work/private_keys"

decode() {
  (umask 077; printf '%s' "$2" | base64 --decode > "$1") || fail "$3 is not valid base64."
}

# Signing identities, in a temporary keychain placed first in the search list.
keychain_password=$(openssl rand -hex 24)
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
for kind in DISTRIBUTION INSTALLER; do
  certificate="$work/$kind.p12"
  p12_var="APPSTORE_${kind}_P12"
  password_var="APPSTORE_${kind}_P12_PASSWORD"
  decode "$certificate" "${!p12_var}" "$p12_var"
  security import "$certificate" -k "$keychain" -f pkcs12 -P "${!password_var}" \
    -T /usr/bin/codesign -T /usr/bin/productbuild -T /usr/bin/security > /dev/null \
    || fail "Could not import $p12_var. Check $password_var."
  rm -f "$certificate"
done
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" > /dev/null
search_list=("$keychain")
while IFS= read -r entry; do
  entry=${entry#"${entry%%[![:space:]]*}"}
  entry=${entry#\"}
  entry=${entry%\"}
  [[ -n "$entry" && "$entry" != "$keychain" ]] && search_list+=("$entry")
done < <(security list-keychains -d user)
security list-keychains -d user -s "${search_list[@]}"

identity() {
  security find-identity -v ${2:+-p "$2"} "$keychain" \
    | sed -nE "s/^ *[0-9]+\) [0-9A-F]+ \"(($1): .+ \\($TEAM_ID\\))\"\$/\\1/p" | head -n 1
}
app_identity=$(identity 'Apple Distribution' codesigning)
[[ -n "$app_identity" ]] || fail "APPSTORE_DISTRIBUTION_P12 has no valid Apple Distribution identity for team $TEAM_ID."
installer_identity=$(identity '3rd Party Mac Developer Installer|Mac Installer Distribution')
[[ -n "$installer_identity" ]] || fail "APPSTORE_INSTALLER_P12 has no valid Mac Installer Distribution identity for team $TEAM_ID."
echo "Imported \"$app_identity\" and \"$installer_identity\""

# The provisioning profile must be for this app and team, and unexpired.
profile="$work/embedded.provisionprofile"
decode "$profile" "$APPSTORE_PROVISION_PROFILE" APPSTORE_PROVISION_PROFILE
security cms -D -i "$profile" > "$work/profile.plist" 2> /dev/null \
  || fail "APPSTORE_PROVISION_PROFILE is not a provisioning profile."
profile_value() { plutil -extract "$1" raw -o - "$work/profile.plist" 2> /dev/null || true; }
application_identifier="$TEAM_ID.$bundle_id"
[[ "$(profile_value Entitlements.com\\.apple\\.application-identifier)" == "$application_identifier" ]] \
  || fail "The provisioning profile is not for $application_identifier."
[[ "$(profile_value TeamIdentifier.0)" == "$TEAM_ID" ]] || fail "The provisioning profile is not for team $TEAM_ID."
expires=$(profile_value ExpirationDate)
[[ -n "$expires" && "$(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$expires" +%s)" -gt "$(date -u +%s)" ]] \
  || fail "The provisioning profile has expired. Create a new one and update APPSTORE_PROVISION_PROFILE."

# App Store API key, where altool looks for it.
decode "$work/private_keys/AuthKey_${APPSTORE_API_KEY_ID}.p8" "$APPSTORE_API_KEY" APPSTORE_API_KEY
grep -q "BEGIN PRIVATE KEY" "$work/private_keys/AuthKey_${APPSTORE_API_KEY_ID}.p8" \
  || fail "APPSTORE_API_KEY is not a .p8 private key."

# The sandbox entitlements plus the identifiers the App Store requires.
entitlements="$work/entitlements.plist"
cp "$root/src-tauri/Entitlements.appstore.plist" "$entitlements"
# plutil reads dots as a key path, so they are escaped.
plutil -insert 'com\.apple\.application-identifier' -string "$application_identifier" "$entitlements"
plutil -insert 'com\.apple\.developer\.team-identifier' -string "$TEAM_ID" "$entitlements"

cat > "$work/tauri.signing.conf.json" <<JSON
{
  "bundle": {
    "macOS": {
      "signingIdentity": "$app_identity",
      "entitlements": "$entitlements",
      "bundleVersion": "$BUILD_NUMBER",
      "files": { "embedded.provisionprofile": "$profile" }
    }
  }
}
JSON

cd "$root"
npm run tauri -- build --target universal-apple-darwin --bundles app --features appstore \
  --config src-tauri/tauri.appstore.conf.json \
  --config src-tauri/tauri.appstore-release.conf.json \
  --config "$work/tauri.signing.conf.json" \
  -- --locked

app="$root/src-tauri/target/universal-apple-darwin/release/bundle/macos/$product.app"
[[ -d "$app" ]] || fail "The build did not produce $app."
info() { plutil -extract "$1" raw -o - "$app/Contents/Info.plist" 2> /dev/null || true; }

# Check the bundle before anything leaves the runner.
codesign --verify --strict --deep "$app" || fail "The app signature does not verify."
codesign -d --entitlements :- "$app" 2> /dev/null > "$work/signed-entitlements.plist"
signed() { plutil -extract "$1" raw -o - "$work/signed-entitlements.plist" 2> /dev/null || true; }
[[ "$(signed com\\.apple\\.security\\.app-sandbox)" == true ]] || fail "The app is not sandboxed."
[[ "$(signed com\\.apple\\.application-identifier)" == "$application_identifier" ]] \
  || fail "The app is not signed with application identifier $application_identifier."
cmp -s "$profile" "$app/Contents/embedded.provisionprofile" || fail "The provisioning profile is not embedded."
[[ "$(info CFBundleIdentifier)" == "$bundle_id" ]] || fail "CFBundleIdentifier is not $bundle_id."
[[ "$(info CFBundleShortVersionString)" == "$version" ]] || fail "CFBundleShortVersionString is not $version."
[[ "$(info CFBundleVersion)" == "$BUILD_NUMBER" ]] || fail "CFBundleVersion is not $BUILD_NUMBER."
[[ "$(info LSApplicationCategoryType)" == public.app-category.productivity ]] || fail "The app has no category."
[[ "$(info ITSAppUsesNonExemptEncryption)" == false ]] || fail "The export compliance key is missing."
[[ "$(info CFBundleDocumentTypes.1.NSIsRelatedItemType)" == true ]] || fail "The workspace sidecar types are missing."
executable="$app/Contents/MacOS/$binary"
for arch in arm64 x86_64; do
  lipo -archs "$executable" | tr ' ' '\n' | grep -qx "$arch" || fail "The app has no $arch slice."
done
if LC_ALL=C grep -q -a -F "$UPDATE_ENDPOINT" "$executable"; then
  fail "The App Store build still contains the website update check."
fi
echo "Verified $bundle_id $version ($BUILD_NUMBER)"

package="$work/Scratchpad-$version-$BUILD_NUMBER.pkg"
productbuild --component "$app" /Applications --sign "$installer_identity" --keychain "$keychain" "$package"
pkgutil --check-signature "$package" | grep -qF "$installer_identity" \
  || fail "The package is not signed by \"$installer_identity\"."

# altool searches ./private_keys for AuthKey_<id>.p8.
cd "$work"
xcrun altool --validate-app -f "$package" -t macos \
  --apiKey "$APPSTORE_API_KEY_ID" --apiIssuer "$APPSTORE_API_ISSUER_ID" \
  || fail "App Store Connect rejected the package. The log above has Apple's reasons."
echo "App Store Connect validated $package"
if [[ "${UPLOAD:-}" == true ]]; then
  xcrun altool --upload-app -f "$package" -t macos \
    --apiKey "$APPSTORE_API_KEY_ID" --apiIssuer "$APPSTORE_API_ISSUER_ID" \
    || fail "The upload failed. The log above has Apple's reasons."
  echo "Uploaded build $BUILD_NUMBER. It appears in App Store Connect after processing."
else
  echo "Not uploaded. Run the workflow with upload enabled to send this build."
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "package=$package" >> "$GITHUB_OUTPUT"
fi
