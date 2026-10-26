# macOS release signing (maintainers)

The Stable Release workflow signs the universal macOS app and DMG with a Developer ID Application certificate and notarizes both with Apple. The workflow checks Gatekeeper acceptance; opening a browser-downloaded final package without a bypass must also be verified on real Macs before publication.

1. `scripts/setup-macos-signing.sh` imports the certificate into a temporary keychain and writes the App Store Connect API key to the runner's temp directory. It fails unless the certificate holds a valid identity matching `src-tauri/tauri.macos-signing.conf.json` and the notary service accepts the API key, so bad credentials stop the job before the build.
2. `src-tauri/tauri.macos-signing.conf.json` sets the signing identity and the hardened runtime. It comes after `tauri.release.conf.json` on the command line. Stable packaging never applies a beta or ad-hoc signing override. Tauri signs the executable and bundle with a secure timestamp, notarizes and staples the `.app`, and signs the DMG.
3. `scripts/stage-release-assets.mjs` collects the local DMG and app archive under the expected release filenames. `scripts/finalize-macos-release.sh --assets-dir DIR` notarizes and staples the staged DMG, runs `scripts/verify-macos-release.sh` on both files, and copies the exact verified bytes back to that directory. It has no GitHub token or draft access.
4. The keychain, certificate and API key file are deleted at the end of the job, even if it fails.

`verify-macos-release.sh` fails the job unless the DMG, and the app inside both the DMG and the archive, meet all of these:

- signed by a Developer ID Application certificate for the expected team, with a secure timestamp;
- notarized, with a stapled ticket, and accepted by Gatekeeper as `Notarized Developer ID`;
- every executable uses the hardened runtime, the app has no entitlements, and the executable contains both `arm64` and `x86_64`;
- the signed binary runs in `--mcp-stdio` mode on both architectures (x86_64 through Rosetta). It must print its usage error for a malformed call and report a missing agent-access token.

Gatekeeper assessments must be enabled; a disabled or unreadable status fails verification. CI also fails if Rosetta is unavailable. Local verification may skip the Intel launch check when Rosetta is not installed.

After verification, the job saves the final files and a separate record of their sizes and SHA-256 hashes as workflow artifacts. A dedicated upload job with repository write permission checks both files against the record, uploads them to the prepared draft, and checks the upload digests. It downloads the final assets by ID and saves a snapshot for the read-only snapshot check. Both checks require the files to match the signing record for the same release ID, source commit and workflow run. A final dependency-free job reads the live draft after snapshot verification and confirms its identity, unpublished state, asset IDs, sizes and digests still match. Website checksums come from GitHub's final upload digests.

## Why the app has no entitlements

The hardened runtime blocks JIT, unsigned executable memory, DYLD environment variables and unsigned libraries unless an entitlement allows them. Scratchpad needs none of these. WKWebView runs JavaScript in Apple's own WebContent process, and the app is not sandboxed, so file dialogs, the workspace file, the update check and the loopback MCP server all work without entitlements. Adding one requires changing `test/macos-signing-config.test.js` and the check in `verify-macos-release.sh`, so it gets reviewed.

## Credentials

| Item | Value |
| --- | --- |
| Apple Developer team | `B62UYUQ6C3` (individual, Patrick Jon McDowell) |
| Signing identity | `Developer ID Application: PATRICK JON MCDOWELL (B62UYUQ6C3)`, in `src-tauri/tauri.macos-signing.conf.json` |
| Notarization | App Store Connect team API key `B8584WFWTY`, Developer role |

The `release-signing` environment holds:

| Name | Kind | Contents |
| --- | --- | --- |
| `APPLE_CERTIFICATE` | secret | Base64 `.p12` with the certificate and its private key |
| `APPLE_CERTIFICATE_PASSWORD` | secret | The `.p12` export password |
| `KEYCHAIN_PASSWORD` | secret | Random password for the job's temporary keychain |
| `APPLE_API_PRIVATE_KEY` | secret | Contents of `AuthKey_<key-id>.p8` |
| `APPLE_API_KEY` | variable | The API key ID |
| `APPLE_API_ISSUER` | variable | The App Store Connect issuer ID |

The identity is committed rather than stored as a variable, so changing it is a reviewed code change. The environment requires a reviewer and allows deployments from `main` only. Pull request workflows never run in it.

## Initial setup

1. Enroll in the Apple Developer Program. Only the Account Holder can create Developer ID certificates.
2. In Keychain Access, choose **Certificate Assistant → Request a Certificate From a Certificate Authority** and save the request to disk. At [Certificates, IDs & Profiles](https://developer.apple.com/account/resources/certificates/list), create a **Developer ID Application** certificate (G2 Sub-CA) from it. Download and open the `.cer`, then check `security find-identity -v -p codesigning`.
3. In Keychain Access, export the identity from **My Certificates** as a `.p12` with a strong password.
4. In [App Store Connect](https://appstoreconnect.apple.com/access/integrations/api) under **Users and Access → Integrations → Team Keys**, create a key with the Developer role. Download the `.p8` (Apple offers it only once) and note the key ID and issuer ID.
5. Store the `.p12`, its password and the `.p8` in a password manager, then load the environment from a trusted terminal:

   ```sh
   R=crims0n/scratchpad
   E=release-signing
   base64 -i developer.p12 | gh secret set APPLE_CERTIFICATE --repo $R --env $E
   gh secret set APPLE_CERTIFICATE_PASSWORD --repo $R --env $E     # prompts
   gh secret set APPLE_API_PRIVATE_KEY --repo $R --env $E < AuthKey_YOUR_KEY_ID.p8
   openssl rand -base64 32 | gh secret set KEYCHAIN_PASSWORD --repo $R --env $E
   gh variable set APPLE_API_KEY --repo $R --env $E --body 'YOUR_KEY_ID'
   gh variable set APPLE_API_ISSUER --repo $R --env $E --body 'YOUR_ISSUER_ID'
   ```

6. Delete the `.p12` and `.p8` from the working machine.

## Renewal

- **Developer Program membership** renews yearly. Existing Developer ID-signed apps continue to work after membership expires; membership is required to obtain a new Developer ID certificate. Keep membership and notarization credentials current for releases. See Apple's [Developer ID certificate guidance](https://developer.apple.com/help/account/certificates/create-developer-id-certificates).
- **Developer ID certificate** expires five years after issue. Apps signed before expiry stay valid because of their secure timestamps. Before it expires, create a new certificate (steps 2–3), replace `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD`, and update the identity in `tauri.macos-signing.conf.json` if its name changed. Apple allows a limited number of Developer ID certificates per team, so revoke old ones only when needed.
- **API key** does not expire. Rotate it by creating a new key, replacing `APPLE_API_PRIVATE_KEY` and `APPLE_API_KEY`, then revoking the old key.

## Revocation

If the `.p12`, its password or the API key may be exposed:

1. Delete the affected environment secrets immediately.
2. **API key:** revoke it in App Store Connect, then create and load a new one.
3. **Certificate:** ask Apple Developer Support to revoke it, and give the date of the possible exposure so software signed before then keeps working. Create and load a new certificate, and update the identity in `tauri.macos-signing.conf.json`.
4. Identify releases signed after the possible exposure, rebuild them, and say so in the release notes and on the website.

## Manual release checks

CI cannot test a real download or the editor UI. Before publishing a release, on both an Apple Silicon Mac and an Intel Mac:

1. Download the DMG with a browser, so it gets the quarantine attribute, then open it and drag the app to Applications.
2. Launch it. Record the actual Gatekeeper prompt and publisher/team. Require launch without an unidentified-developer warning or a bypass such as **Open Anyway** or right-click → Open; do not infer this result from the signing job alone.
3. Edit, save and reopen a note. Then enable agent access and connect an MCP client using the installed app's `--mcp-stdio` command.
4. Optionally, run `scripts/verify-macos-release.sh --team B62UYUQ6C3 ./Scratchpad_1.0.0_universal.dmg`, substituting the actual downloaded filename.

## Testing changes to the scripts

- `verify-macos-release.sh --team <TEAMID> <file.dmg|file.app.tar.gz|file.app>...` runs locally on any Mac.
- `finalize-macos-release.sh --assets-dir DIR` notarizes and verifies local assets, then replaces the local DMG with its stapled bytes. It never contacts GitHub. It needs the `MACOS_SIGNING_*` and `APPLE_API_*` variables it documents.
- `setup-macos-signing.sh` changes the user keychain search list, so run it only on CI runners.
