// SPDX-License-Identifier: GPL-3.0-or-later

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { stableRelease } from "./check-stable-release.mjs";
import { buildReleaseManifest } from "./generate-release-manifest.mjs";

export function expectedAssets(version) {
  return ["universal.dmg", "universal.app.tar.gz", "x64-setup.exe", "x64_en-US.msi", "amd64.AppImage", "amd64.deb"]
    .map(suffix => `Scratchpad_${version}_${suffix}`).concat("SHA256SUMS", "SHA256SUMS.asc");
}

export async function verifyDraft({ release, version, commit, assetsDir }) {
  const { tag } = stableRelease(version);
  if (!/^[a-f0-9]{40}$/.test(commit || "") || release.target_commitish !== commit) throw new Error("Draft must target the reviewed source commit");
  if (release.tag_name !== tag || release.name !== `Scratchpad v${version}` || release.draft !== true || release.prerelease !== false) {
    throw new Error("Expected an unpublished stable Scratchpad draft with the candidate version");
  }
  const expected = expectedAssets(version).sort();
  const assets = release.assets;
  if (!Array.isArray(assets) || JSON.stringify(assets.map(asset => asset.name).sort()) !== JSON.stringify(expected)) {
    throw new Error("Draft must contain exactly the six stable installers and two Linux checksum/signature files");
  }
  if (JSON.stringify((await readdir(assetsDir)).sort()) !== JSON.stringify(expected)) throw new Error("Downloaded asset set does not match the draft");

  const verified = [];
  for (const asset of assets) {
    if (asset.state !== "uploaded" || !Number.isSafeInteger(asset.size) || asset.size <= 0 || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest || "")) {
      throw new Error(`Missing final upload metadata/digest: ${asset.name}`);
    }
    const file = join(assetsDir, asset.name);
    if ((await stat(file)).size !== asset.size) throw new Error(`Downloaded size mismatch: ${asset.name}`);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    const sha256 = hash.digest("hex");
    if (asset.digest.toLowerCase() !== `sha256:${sha256}`) throw new Error(`Downloaded SHA-256 mismatch: ${asset.name}`);
    verified.push({ name: asset.name, sha256, size: asset.size });
  }

  const checksums = (await readFile(join(assetsDir, "SHA256SUMS"), "utf8")).trim().split(/\r?\n/);
  const linux = verified.filter(asset => /_amd64\.(AppImage|deb)$/.test(asset.name));
  if (checksums.length !== 2 || linux.some(asset => !checksums.includes(`${asset.sha256}  ${asset.name}`))) {
    throw new Error("Signed Linux manifest must cover the final AppImage and Debian package exactly");
  }

  // Preview recognition through the real publisher without advertising the
  // draft or writing to the public manifest. Platform jobs verify signatures.
  const preview = buildReleaseManifest([{ ...release, draft: false, published_at: new Date().toISOString() }]);
  if (preview.release.tag !== tag || preview.release.assets.length !== 6
    || preview.release.assets.some(asset => !asset.sha256)
    || new Set(preview.release.assets.map(asset => asset.platform)).size !== 3) {
    throw new Error("Published-manifest preview does not recognize all six installers and hashes");
  }
  return { tag, commit, assets: verified };
}

async function main() {
  const argument = name => process.argv[process.argv.indexOf(name) + 1];
  for (const name of ["--release", "--assets-dir", "--version", "--commit"]) {
    if (!process.argv.includes(name) || !argument(name)) throw new Error(`Missing ${name}`);
  }
  const release = JSON.parse(await readFile(argument("--release"), "utf8"));
  const result = await verifyDraft({ release, assetsDir: argument("--assets-dir"), version: argument("--version"), commit: argument("--commit") });
  const summary = `## Verified stable draft ${result.tag}\n\nSource: \`${result.commit}\`. All platform signing jobs passed; the release remains a draft for installed-package acceptance. Six installer assets are recognized by the website manifest.\n\n| Asset | SHA-256 |\n| --- | --- |\n${result.assets.map(asset => `| ${asset.name} | \`${asset.sha256}\` |`).join("\n")}\n`;
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
