// SPDX-License-Identifier: GPL-3.0-or-later

import { execFileSync } from "node:child_process";
import { mkdir, open, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { assertMainBranch } from "./check-stable-release.mjs";
import { assertDraftUnchanged, assertReleaseRepository, draftAssets, downloadDraftAssets, expectedAssets, hashFile, verifyEvidence } from "./release-verification.mjs";
import { releasePublicKey, verifyLinuxAssets } from "./release-signature.mjs";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForDigest({ asset, name, github, sleep }) {
  const id = asset.id;
  for (let attempt = 0; !asset.digest && attempt < 6; attempt += 1) {
    await sleep(5000);
    asset = await github.asset(id);
    if (asset?.id !== id || asset.name !== name) {
      throw new Error(`Upload does not match signature-checked bytes: ${name} (missing or changed asset)`);
    }
  }
  if (!asset.digest) throw new Error(`Upload does not match signature-checked bytes: ${name} (digest unavailable; retry later)`);
  return asset;
}

function contentType(name) {
  if (name.endsWith(".dmg")) return "application/x-apple-diskimage";
  if (name === "SHA256SUMS" || name === "SHA256SUMS.asc") return "text/plain";
  return "application/octet-stream";
}

export async function uploadVerifiedDraft({ repository, releaseId, version, commit, runId, assetsDir, evidence,
  snapshotDir, github, key = releasePublicKey, sleep = delay }) {
  assertReleaseRepository(repository);
  const names = expectedAssets(version).sort();
  if (JSON.stringify((await readdir(assetsDir)).sort()) !== JSON.stringify(names)) {
    throw new Error("Workflow artifacts must contain exactly the eight release files");
  }
  const verified = await Promise.all(names.map(name => hashFile(join(assetsDir, name))));
  verifyEvidence({ evidence, verified, releaseId, version, commit, runId });
  await verifyLinuxAssets({ assetsDir, verified, publicKey: key });

  const identity = { releaseId, version, commit };
  const release = await github.release();
  const existing = draftAssets({ ...identity, release, complete: false });
  // Reject a stale destination before making any GitHub changes.
  await mkdir(snapshotDir);
  for (const file of verified) {
    let old = existing.find(asset => asset.name === file.name);
    if (old?.state === "uploaded" && old.size === file.size && !old.digest) {
      // An interrupted upload may already have the right bytes. Wait for
      // GitHub's digest, and leave the file in place if it is still unknown.
      old = await waitForDigest({ asset: old, name: file.name, github, sleep });
    }
    if (old?.state === "uploaded" && old.size === file.size && old.digest?.toLowerCase() === `sha256:${file.sha256}`) continue;
    // Recheck the candidate before a replacement, including on a retry after
    // partial uploads. Never clobber a published or retargeted release.
    draftAssets({ ...identity, release: await github.release(), complete: false });
    if (old) await github.deleteAsset(old.id);
    let uploaded = await github.uploadAsset(join(assetsDir, file.name), file.name, contentType(file.name));
    if (!Number.isSafeInteger(uploaded?.id) || uploaded.id <= 0 || uploaded.name !== file.name) {
      throw new Error(`Invalid upload response: ${file.name}`);
    }
    uploaded = await waitForDigest({ asset: uploaded, name: file.name, github, sleep });
    if (uploaded.state !== "uploaded" || uploaded.name !== file.name || uploaded.size !== file.size
      || uploaded.digest?.toLowerCase() !== `sha256:${file.sha256}`) {
      throw new Error(`Upload does not match signature-checked bytes: ${file.name}`);
    }
  }

  const finalRelease = await github.release();
  const assets = draftAssets({ ...identity, release: finalRelease });
  for (const file of verified) {
    const asset = assets.find(asset => asset.name === file.name);
    if (asset.size !== file.size || asset.digest.toLowerCase() !== `sha256:${file.sha256}`) {
      throw new Error(`Final draft metadata changed: ${file.name}`);
    }
  }
  const downloadedDir = join(snapshotDir, "assets");
  await downloadDraftAssets({ ...identity, release: finalRelease, assetsDir: downloadedDir,
    download: (id, destination) => github.downloadAsset(id, destination) });
  const downloaded = await Promise.all(names.map(name => hashFile(join(downloadedDir, name))));
  verifyEvidence({ evidence, verified: downloaded, releaseId, version, commit, runId });
  await verifyLinuxAssets({ assetsDir: downloadedDir, verified: downloaded, publicKey: key });
  // Do not report success if the candidate was published or changed while
  // its bytes were being downloaded and verified.
  const snapshotRelease = await github.release();
  assertDraftUnchanged({ ...identity, release: snapshotRelease, verifiedRelease: finalRelease });
  await writeFile(join(snapshotDir, "release.json"), `${JSON.stringify(snapshotRelease, null, 2)}\n`, { flag: "wx" });
  return { releaseId, assets: downloaded };
}

async function main() {
  assertMainBranch(process.env.GITHUB_REF);
  const repository = process.env.GITHUB_REPOSITORY;
  const releaseId = Number(process.env.RELEASE_ID);
  const api = args => {
    const output = execFileSync("gh", ["api", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
    return output.trim() ? JSON.parse(output) : undefined;
  };
  const evidenceDir = process.env.VERIFICATION_EVIDENCE_DIR;
  const records = await readdir(evidenceDir);
  if (records.length !== 3 || records.some(name => !name.endsWith(".json"))) throw new Error("Expected three platform verification records");
  const evidence = await Promise.all(records.map(async name => JSON.parse(await readFile(join(evidenceDir, name), "utf8"))));
  const result = await uploadVerifiedDraft({ repository, releaseId, version: process.env.RELEASE_VERSION,
    commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, evidence, assetsDir: process.env.RELEASE_ASSETS_DIR,
    snapshotDir: process.env.RELEASE_SNAPSHOT_DIR, github: {
      release: () => api([`repos/${repository}/releases/${releaseId}`]),
      asset: id => api([`repos/${repository}/releases/assets/${id}`]),
      deleteAsset: id => api(["--method", "DELETE", `repos/${repository}/releases/assets/${id}`]),
      uploadAsset: (file, name, type) => api(["--method", "POST", "-H", `Content-Type: ${type}`,
        `https://uploads.github.com/repos/${repository}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`, "--input", file]),
      downloadAsset: async (id, destination) => {
        const file = await open(destination, "wx");
        try {
          execFileSync("gh", ["api", "-H", "Accept: application/octet-stream", `repos/${repository}/releases/assets/${id}`],
            { stdio: ["ignore", file.fd, "inherit"] });
        } finally { await file.close(); }
      }
    } });
  console.log(`Uploaded and downloaded ${result.assets.length} verified assets to draft ${result.releaseId}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
