# Windows release signing (maintainers)

The Beta Release workflow Authenticode-signs Windows builds with [Azure Artifact Signing](https://learn.microsoft.com/azure/artifact-signing/). The certificate is issued to the maintainer's verified identity. The private keys stay in Microsoft's HSMs, and no signing secret is stored in GitHub.

1. `scripts/setup-windows-signing.ps1` downloads the pinned Artifact Signing dlib from nuget.org and checks its SHA-256 and Microsoft signature. It then finds an x64 SignTool and writes the dlib metadata. The metadata allows only the workload identity credential.
2. `src-tauri/tauri.windows-signing.conf.json` sets Tauri's `signCommand` to `scripts/sign-windows.ps1`. Tauri calls it for the application executable, the NSIS plugins and uninstaller, the NSIS setup `.exe`, and the `.msi`. Each call signs with SHA-256 and a timestamp from `http://timestamp.acs.microsoft.com`. Any failure fails the build.
3. `scripts/verify-windows-release.ps1` checks both installers. It extracts the MSI and silently installs the NSIS package, then checks every installed `.exe` and `.dll` too. Each file needs a valid signature from the publisher named in the workflow (`WINDOWS_SIGNING_PUBLISHER`), issued by Microsoft ID Verified CS. It also needs a SHA-256 digest and a timestamp. Any failure fails the job.

Website checksums come from GitHub's asset digests, which GitHub calculates after upload, so they describe the signed files.

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
4. Create an app registration without secrets. Add the federated credential above, then grant its service principal the signer role on the certificate profile:

   ```powershell
   $sp = (az ad sp show --id <app-id> --query id -o tsv)
   $acct = "/subscriptions/<sub>/resourceGroups/codesign/providers/Microsoft.CodeSigning/codeSigningAccounts/<account>"
   az role assignment create --assignee-object-id $sp --assignee-principal-type ServicePrincipal --role "Artifact Signing Certificate Profile Signer" --scope "$acct/certificateProfiles/<profile>"
   ```

5. Set the environment variables with `gh variable set <NAME> --env release-signing --body <value>`.
6. Put the certificate's common name in `WINDOWS_SIGNING_PUBLISHER` in `.github/workflows/beta-release.yml`. Read it with `az rest --method get --url "https://management.azure.com$acct/certificateProfiles/<profile>?api-version=2024-09-30-preview" --query "properties.certificates[0].subjectName"`.

## Renewal and costs

- Certificates last about three days and renew automatically. Timestamps keep older signatures valid after each certificate expires.
- The identity validation expires, and Microsoft sends reminders starting 60 days before. Renew it in the Azure portal, or certificate renewal and signing stop. If the publisher name changes, update `WINDOWS_SIGNING_PUBLISHER`.
- The Basic SKU is billed monthly at full price; there is no proration. It includes 5,000 signatures a month, and a beta release uses about ten. Deleting the Artifact Signing account stops billing and does not invalidate files already signed.
- Updating the dlib: change `$dlibVersion` and `$dlibSha256` together in `setup-windows-signing.ps1`. Use a version that has been on nuget.org for at least two weeks, and take the SHA-256 of the `.nupkg` you inspected.

## Revocation and incident response

If a token, the app registration, or the workflow may have been misused:

1. Delete the `github-release-signing` federated credential, or remove the role assignment. Either one stops all signing immediately.
2. Check the Artifact Signing account's signing history. You can also subscribe to signing events, see [sign history](https://learn.microsoft.com/azure/artifact-signing/how-to-sign-history).
3. Report misuse to Microsoft through Azure Support, and ask for certificates covering the affected period to be revoked. Revocation also invalidates legitimate files signed in that period, so rebuild and re-sign those releases and say so in their release notes.
4. Fix the cause, recreate the credential, and run a new beta release.

Deleting a certificate profile does not revoke certificates it already issued.

## SmartScreen

A valid signature names the publisher in UAC and in file properties. It does not guarantee that SmartScreen stays silent. Artifact Signing issues no EV certificates, and SmartScreen reputation builds with download history. Record SmartScreen and UAC behavior for browser-downloaded installers when testing on a clean Windows system, and do not promise users that no warning appears.

## Testing changes to the scripts

The scripts run on `windows-latest` under PowerShell 7 and are written to also work in Windows PowerShell 5.1. Given an already signed setup `.exe` and `.msi`, plus `SIGNTOOL_PATH`, `WINDOWS_SIGNING_PUBLISHER`, and `RUNNER_TEMP`, `verify-windows-release.ps1` runs locally. Signing needs the GitHub OIDC environment, so test it with a beta release run; the release stays a draft until you publish it.
