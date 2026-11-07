# Mac App Store release (maintainers)

The App Store workflow (`.github/workflows/appstore.yml`) builds Scratchpad for the Mac App Store from `main`. It runs only when started by hand, and is separate from the website release. It uses its own certificates, bundle ID `io.github.crims0n.scratchpad` and the `appstore-signing` environment, and it reads none of the website signing configuration. The store listing is named Scratchpad Notes; the app itself is named Scratchpad.

## Running it

1. In GitHub, open **Actions → App Store → Run workflow** on `main`.
2. Leave **Upload** unticked to build, verify and validate the package with App Store Connect without sending it. Tick it to upload after validation.
3. Approve the `appstore-signing` deployment when GitHub asks.

The build number (`CFBundleVersion`) is the workflow run number, so it increases on every run as App Store Connect requires. The version comes from `src-tauri/tauri.conf.json`. Each run keeps the signed `.pkg` as an artifact for 14 days.

## What the script checks

`scripts/appstore-package.sh` stops before building if any credential is missing or wrong. That covers each `.p12` holding a valid identity for team `B62UYUQ6C3`, and the provisioning profile being for `B62UYUQ6C3.io.github.crims0n.scratchpad` and unexpired. It builds a universal app with the `appstore` feature and `tauri.appstore.conf.json`, then `tauri.appstore-release.conf.json`. Before packaging, it fails unless the app:

- has a valid signature and is sandboxed, with the App Store application identifier and the embedded profile;
- has the expected bundle ID, version, build number, category, export compliance key and workspace sidecar document types;
- contains both `arm64` and `x86_64`;
- does not contain the website update check.

It then signs the installer package, checks that signature, and validates it with App Store Connect. The temporary keychain and API key are deleted at the end of the job, even if it fails.

`ITSAppUsesNonExemptEncryption` is `false` because the App Store build makes no encrypted network connections of its own. Answer App Store Connect's export compliance question the same way, and update the key if that changes.

## Local test builds

`tauri.appstore.conf.json` alone builds the sandboxed flavor under the development bundle ID, which keeps test data out of the real App Store container. Sign it ad hoc with `src-tauri/Entitlements.appstore.plist` to try it locally. Don't launch builds made with `tauri.appstore-release.conf.json` locally.

## Credentials

These secrets are stored in the `appstore-signing` environment. That environment requires a maintainer's approval and only allows `main`.

| Secret | Contents |
| --- | --- |
| `APPSTORE_DISTRIBUTION_P12` | base64 `.p12` with the Apple Distribution certificate and key |
| `APPSTORE_DISTRIBUTION_P12_PASSWORD` | its export password |
| `APPSTORE_INSTALLER_P12` | base64 `.p12` with the Mac Installer Distribution certificate and key |
| `APPSTORE_INSTALLER_P12_PASSWORD` | its export password |
| `APPSTORE_PROVISION_PROFILE` | base64 Mac App Store Connect provisioning profile for the bundle ID |
| `APPSTORE_API_KEY` | base64 App Store Connect API `.p8` key with the App Manager role |
| `APPSTORE_API_KEY_ID` | its key ID |
| `APPSTORE_API_ISSUER_ID` | its issuer ID |

Certificates and profiles expire. When the script reports an expired or invalid one, create a replacement in the Apple Developer portal and update the secret. Never commit signing material.
