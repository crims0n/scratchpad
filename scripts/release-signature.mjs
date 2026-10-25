// SPDX-License-Identifier: GPL-3.0-or-later

import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const releasePublicKey = fileURLToPath(new URL("../site/release-signing-key.asc", import.meta.url));

export async function verifyLinuxAssets({ assetsDir, verified, publicKey }) {
  const checksums = (await readFile(join(assetsDir, "SHA256SUMS"), "utf8")).trim().split(/\r?\n/);
  const linux = verified.filter(asset => /_amd64\.(AppImage|deb)$/.test(asset.name));
  if (linux.length !== 2 || checksums.length !== 2
    || linux.some(asset => !checksums.includes(`${asset.sha256}  ${asset.name}`))) {
    throw new Error("Signed Linux manifest must cover the final AppImage and Debian package exactly");
  }
  await verifyLinuxSignature({ assetsDir, publicKey });
}

export async function verifyLinuxSignature({ assetsDir, publicKey }) {
  // Use only the checked-in public key, with an empty home so an ambient
  // trusted keyring or user configuration cannot authorize another signer.
  const home = await mkdtemp(join(tmpdir(), "scratchpad-release-gpg-"));
  try {
    const keyring = join(home, "release-signing.gpg");
    execFileSync("gpg", ["--batch", "--no-options", "--homedir", home, "--dearmor", "--output", keyring, publicKey], { stdio: "pipe" });
    execFileSync("gpgv", ["--homedir", home, "--keyring", keyring,
      join(assetsDir, "SHA256SUMS.asc"), join(assetsDir, "SHA256SUMS")], { stdio: "pipe" });
  } catch (error) {
    throw new Error("Downloaded Linux checksum signature did not verify with the release public key", { cause: error });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

