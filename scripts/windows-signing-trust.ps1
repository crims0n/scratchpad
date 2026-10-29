# SPDX-License-Identifier: GPL-3.0-or-later

function Assert-MicrosoftAuthenticode([string]$Path) {
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate) {
    throw "File is not validly Authenticode-signed: $Path ($($signature.Status))"
  }
  # Decode RDN boundaries instead of accepting a substring such as
  # O=Microsoft Corporation Evil, or an O= string inside another attribute.
  $subject = $signature.SignerCertificate.SubjectName.Decode([Security.Cryptography.X509Certificates.X500DistinguishedNameFlags]::UseNewLines)
  $organizations = @($subject -split '\r?\n' | Where-Object { $_ -cmatch '^O=' })
  if ($organizations.Count -ne 1 -or $organizations[0] -cne 'O=Microsoft Corporation') {
    throw "File signer must have the exact Microsoft Corporation organization: $Path"
  }
  return $signature
}
