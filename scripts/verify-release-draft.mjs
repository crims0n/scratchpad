// SPDX-License-Identifier: GPL-3.0-or-later

import { appendFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stableRelease } from "./check-stable-release.mjs";
import { buildReleaseManifest, getSha256 } from "./generate-release-manifest.mjs";
import { expectedAssets, hashFile, verifyEvidence, draftAssets } from "./release-verification.mjs";

export { expectedAssets, downloadDraftAssets } from "./release-verification.mjs";
import { verifyLinuxAssets } from "./release-signature.mjs";
export { verifyLinuxSignature } from "./release-signature.mjs";

export async function verifyDraft({ release, releaseId, version, commit, assetsDir, evidence, runId,
  publicKey = fileURLToPath(new URL("../site/release-signing-key.asc", import.meta.url)) }) {
  const assets = draftAssets({ release, releaseId, version, commit });
  const { tag } = stableRelease(version);
  const expected = expectedAssets(version).sort();
  if (JSON.stringify((await readdir(assetsDir)).sort()) !== JSON.stringify(expected)) throw new Error("Downloaded asset set does not match the draft");

  const verified = [];
  for (const asset of assets) {
    const file = join(assetsDir, asset.name);
    const { size, sha256 } = await hashFile(file);
    if (size !== asset.size) throw new Error(`Downloaded size mismatch: ${asset.name}`);
    if (getSha256(asset.digest) !== sha256) throw new Error(`Downloaded SHA-256 mismatch: ${asset.name}`);
    verified.push({ name: asset.name, sha256, size: asset.size });
  }

  verifyEvidence({ evidence, verified, releaseId, version, commit, runId });
  await verifyLinuxAssets({ assetsDir, verified, publicKey });

  // Preview recognition through the real publisher without advertising the
  // draft or writing to the public manifest. Platform jobs verify signatures.
  const preview = buildReleaseManifest([{ ...release, draft: false, published_at: new Date().toISOString() }]);
  if (preview.release.tag !== tag || preview.release.assets.length !== 6
    || preview.release.assets.some(asset => !asset.sha256)
    || new Set(preview.release.assets.map(asset => asset.platform)).size !== 3) {
    throw new Error("Published-manifest preview does not recognize all six installers and hashes");
  }
  return { releaseId, tag, commit, assets: verified };
}

async function main() {
  if (process.argv.includes("--download")) throw new Error("Use the upload job's downloaded snapshot for verification");
  const argument = name => process.argv[process.argv.indexOf(name) + 1];
  for (const name of ["--release", "--assets-dir", "--version", "--commit", "--release-id", "--evidence-dir"]) {
    if (!process.argv.includes(name) || !argument(name)) throw new Error(`Missing ${name}`);
  }
  const release = JSON.parse(await readFile(argument("--release"), "utf8"));
  const evidenceDir = argument("--evidence-dir");
  const evidenceFiles = await readdir(evidenceDir);
  if (evidenceFiles.length !== 3 || evidenceFiles.some(file => !file.endsWith(".json"))) throw new Error("Expected exactly three platform verification records");
  const evidence = await Promise.all(evidenceFiles.map(async file => JSON.parse(await readFile(join(evidenceDir, file), "utf8"))));
  const input = { release, releaseId: Number(argument("--release-id")), assetsDir: argument("--assets-dir"),
    version: argument("--version"), commit: argument("--commit"), evidence, runId: process.env.GITHUB_RUN_ID };
  const result = await verifyDraft(input);
  const summary = `## Verified stable draft ${result.tag}\n\nRelease ID: ${result.releaseId}. Source: \`${result.commit}\`. All eight downloaded assets match the files recorded after this run's platform signing checks. The downloaded Linux checksum signature verifies with the release public key. The release remains a draft for installed-package acceptance. Six installer assets are recognized by the website manifest.\n\n| Asset | SHA-256 |\n| --- | --- |\n${result.assets.map(asset => `| ${asset.name} | \`${asset.sha256}\` |`).join("\n")}\n`;
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
