# Windows release signing (maintainers)

The Stable Release workflow Authenticode-signs Windows builds with [Azure Artifact Signing](https://learn.microsoft.com/azure/artifact-signing/). The certificate is issued to the maintainer's verified identity. The private keys stay in Microsoft's HSMs, and no signing secret is stored in GitHub.

1. `scripts/setup-windows-signing.ps1` downloads the pinned Artifact Signing dlib from nuget.org and checks its SHA-256 and Microsoft signature. It then finds an x64 SignTool and writes the dlib metadata. The metadata allows only the workload identity credential.
2. `src-tauri/tauri.windows-signing.conf.json` sets Tauri's `signCommand` to `scripts/sign-windows.ps1`. Tauri calls it for the application executable, the NSIS plugins and uninstaller, the NSIS setup `.exe`, and the `.msi`. Each call signs with SHA-256 and a timestamp from `http://timestamp.acs.microsoft.com`. Any failure fails the build.
3. `scripts/verify-windows-release.ps1` checks both installers. It extracts the MSI and silently installs the NSIS package, then checks every installed `.exe` and `.dll` too. Each file needs a valid signature from the publisher named in the workflow (`WINDOWS_SIGNING_PUBLISHER`), issued by Microsoft ID Verified CS. It also needs a SHA-256 digest and a timestamp. Any failure fails the job.

The verifier's architecture rules apply to **Stable Release as well as ARM64 signing validation**. With the default `-Architecture x64` and `-BinaryName scratchpad.exe`, each installer must contain exactly one `scratchpad.exe`, and every installed executable/DLL must be x64. Only the NSIS `uninstall.exe` may be an x86 wrapper. The ARM64 probe explicitly selects `-Architecture arm64 -BinaryName scratchpad-dev.exe` with the same exception. ARM64EC, malformed headers, and other unexpected machine types fail verification; all remaining files are still checked and failures are reported together. When adding native helpers or changing bundled dependencies, inspect their PE architecture in the PR and run packaging checks before scheduling a signed release. An x86 helper requires a separately reviewed policy change; it is not silently accepted.

After verification, the job saves those same local installers and a separate record of their sizes and SHA-256 hashes as workflow artifacts. It has read-only repository permission. A dedicated upload job with repository write permission checks the files against the record, uploads them to the prepared draft, checks upload digests, and downloads the final assets by ID. A read-only verification job verifies the resulting snapshot. Both checks require the files to match the signing record for the same release ID, source commit and workflow run. A changed upload cannot pass by changing GitHub's digest alone. A final dependency-free job reads the live draft after snapshot verification and confirms its identity, unpublished state, asset IDs, sizes and digests still match. Website checksums come from GitHub's final upload digests.

## Why each file gets a fresh token

The job authenticates to Azure with GitHub Actions OIDC. A federated credential trusts only jobs in the `release-signing` environment. GitHub's ID tokens expire after about five minutes, and the Rust build takes longer than that before Tauri signs the first file. So `sign-windows.ps1` requests a new ID token for every file. The dlib then exchanges it through `AZURE_FEDERATED_TOKEN_FILE`. The job needs `id-token: write` for this.

## Azure resources

| Resource | Value |
| --- | --- |
| Subscription | `8cdd9217-c2ee-47c0-95b4-99a718b67173` (pay-as-you-go) |
| Artifact Signing account | `codesign-patrickmcdowell` (Basic SKU, East US, resource group `codesign`) |
| Certificate profile | `default` (Public Trust, individual identity validation) |
| App registration | `TrustedSigningReleaseSigner` (`dc61667e-c3bb-46bc-af09-f8635e907350`), no client secrets |
| Federated credential | `github-release-signing`: issuer `https://token.actions.githubusercontent.com`, subject `repo:crims0n@2044096/scratchpad@1342840971:environment:release-signing`, audience `api://AzureADTokenExchange` |
| Role | *Artifact Signing Certificate Profile Signer* on the `default` certificate profile only |

The subject uses GitHub's immutable owner and repository IDs, because the repository's OIDC subject template has `use_immutable_subject` enabled. Check it with `gh api repos/crims0n/scratchpad/actions/oidc/customization/sub`. If signing fails with `AADSTS700213`, the error message names the subject GitHub actually sent.

The `release-signing` environment holds these non-secret variables: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_SUBSCRIPTION_ID`, `ARTIFACT_SIGNING_ENDPOINT` (`https://eus.codesigning.azure.net`), `ARTIFACT_SIGNING_ACCOUNT`, and `ARTIFACT_SIGNING_PROFILE`. The environment requires a reviewer and allows deployments from `main` only. Pull request workflows never run in it, so they cannot obtain a token the federated credential accepts.

## Initial setup

1. Create a pay-as-you-go Azure subscription. The billing account must have account type *Individual*, and its legal name and sold-to address must match a government-issued ID. Individual Public Trust validation is available only in the United States and Canada.
2. Register the `Microsoft.CodeSigning` resource provider and create an Artifact Signing account. Assign yourself *Artifact Signing Identity Verifier*, then complete the individual identity validation in the Azure portal.
3. Create a Public Trust certificate profile from the completed validation.
4. Create an app registration without secrets. Substitute your actual resource values below, add the federated credential above, then grant its service principal the signer role on the chosen certificate profile:

   ```powershell
   $signingAppId = 'YOUR_APP_ID'
   $signingSubscriptionId = 'YOUR_SUBSCRIPTION_ID'
   $signingResourceGroup = 'codesign'
   $signingAccount = 'YOUR_ARTIFACT_SIGNING_ACCOUNT'
   $signingProfile = 'YOUR_CERTIFICATE_PROFILE'
   $signingServicePrincipal = (az ad sp show --id $signingAppId --query id -o tsv)
   $signingAccountResource = "/subscriptions/$signingSubscriptionId/resourceGroups/$signingResourceGroup/providers/Microsoft.CodeSigning/codeSigningAccounts/$signingAccount"
   az role assignment create --assignee-object-id $signingServicePrincipal --assignee-principal-type ServicePrincipal --role "Artifact Signing Certificate Profile Signer" --scope "$signingAccountResource/certificateProfiles/$signingProfile"
   ```

5. Using the values from step 4, set the environment variables. Use the same `$signingProfile` for the role scope, certificate lookup, and `ARTIFACT_SIGNING_PROFILE`. The endpoint below is for this project's East US account; use your account's endpoint if setting up another region.

   ```powershell
   $signingTenantId = 'YOUR_TENANT_ID'
   gh variable set AZURE_TENANT_ID --repo crims0n/scratchpad --env release-signing --body "$signingTenantId"
   gh variable set AZURE_CLIENT_ID --repo crims0n/scratchpad --env release-signing --body "$signingAppId"
   gh variable set AZURE_SUBSCRIPTION_ID --repo crims0n/scratchpad --env release-signing --body "$signingSubscriptionId"
   gh variable set ARTIFACT_SIGNING_ENDPOINT --repo crims0n/scratchpad --env release-signing --body 'https://eus.codesigning.azure.net'
   gh variable set ARTIFACT_SIGNING_ACCOUNT --repo crims0n/scratchpad --env release-signing --body "$signingAccount"
   gh variable set ARTIFACT_SIGNING_PROFILE --repo crims0n/scratchpad --env release-signing --body "$signingProfile"
   ```

6. Put the certificate's common name in `WINDOWS_SIGNING_PUBLISHER` in `.github/workflows/release.yml`. Read it using the same account and profile from step 4:

   ```powershell
   $signingProfileUri = "https://management.azure.com$signingAccountResource/certificateProfiles/${signingProfile}?api-version=2024-09-30-preview"
   az rest --method get --url "$signingProfileUri" --query 'properties.certificates[0].subjectName' --output tsv
   ```

## Renewal and costs

- [Certificates are valid for 72 hours and renew daily](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-certificate-management). Trusted timestamps preserve verification after certificate expiry; revocation remains a separate consideration.
- The identity validation expires, and Microsoft sends reminders starting 60 days before. Renew it in the Azure portal, or certificate renewal and signing stop. If the publisher name changes, update `WINDOWS_SIGNING_PUBLISHER`.
- Check the current [pricing and billing guidance](https://learn.microsoft.com/en-us/azure/artifact-signing/faq#cost-management-and-billing) when maintaining the Basic account. Its signing quota covers all profiles; do not budget by installer count alone, because bundled executables, DLLs, and NSIS components also require signatures. Deleting the account stops future signing and does not revoke already-issued certificates.
- Updating the dlib: change `$dlibVersion` and `$dlibSha256` together in `setup-windows-signing.ps1`. Use a version that has been on nuget.org for at least two weeks, and take the SHA-256 of the `.nupkg` you inspected.

## Revocation and incident response

If a token, the app registration, or the workflow may have been misused:

1. Delete the `github-release-signing` federated credential, or remove the role assignment. Either one stops all signing immediately.
2. Check the Artifact Signing account's signing history. You can also subscribe to signing events, see [sign history](https://learn.microsoft.com/azure/artifact-signing/how-to-sign-history).
3. Report misuse to Microsoft through Azure Support, and ask for certificates covering the affected period to be revoked. Revocation also invalidates legitimate files signed in that period, so rebuild and re-sign those releases and say so in their release notes.
4. Fix the cause, recreate the credential, and run a new stable release.

Deleting a certificate profile does not revoke certificates it already issued.

## SmartScreen

A valid signature names the publisher in UAC and in file properties. It does not guarantee that SmartScreen stays silent. Artifact Signing issues no EV certificates, and SmartScreen reputation builds with download history. Record SmartScreen and UAC behavior for browser-downloaded installers when testing on a clean Windows system, and do not promise users that no warning appears.

## Testing changes to the scripts

The scripts run on `windows-latest` under PowerShell 7 and are written to also work in Windows PowerShell 5.1. Given an already signed setup `.exe` and `.msi`, plus `SIGNTOOL_PATH`, `WINDOWS_SIGNING_PUBLISHER`, and `RUNNER_TEMP`, `verify-windows-release.ps1` runs locally. Signing needs the GitHub OIDC environment, so test it with a release run; the release stays a draft until you publish it.
