// SPDX-License-Identifier: GPL-3.0-or-later

import { execFileSync } from "node:child_process";
import { mkdir, open, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertMainBranch } from "./check-stable-release.mjs";
import { draftAssets, downloadDraftAssets, expectedAssets, hashFile, verifyEvidence } from "./release-verification.mjs";
import { verifyLinuxAssets } from "./release-signature.mjs";

const publicKey = fileURLToPath(new URL("../site/release-signing-key.asc", import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function uploadVerifiedDraft({ repository, releaseId, version, commit, runId, assetsDir, evidence,
  snapshotDir, github, key = publicKey, sleep = delay }) {
  if (!/^[a-z0-9-]+\/[a-z0-9_.-]+$/i.test(repository || "")) throw new Error("Invalid release repository");
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
    const old = existing.find(asset => asset.name === file.name);
    if (old?.state === "uploaded" && old.size === file.size && old.digest?.toLowerCase() === `sha256:${file.sha256}`) continue;
    // Recheck the candidate before a replacement, including on a retry after
    // partial uploads. Never clobber a published or retargeted release.
    draftAssets({ ...identity, release: await github.release(), complete: false });
    if (old) await github.deleteAsset(old.id);
    let uploaded = await github.uploadAsset(join(assetsDir, file.name), file.name);
    if (!Number.isSafeInteger(uploaded?.id) || uploaded.id <= 0 || uploaded.name !== file.name) {
      throw new Error(`Invalid upload response: ${file.name}`);
    }
    for (let attempt = 0; !uploaded.digest && attempt < 6; attempt += 1) {
      await sleep(5000);
      uploaded = await github.asset(uploaded.id);
    }
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
  const current = draftAssets({ ...identity, release: snapshotRelease });
  for (const asset of assets) {
    const latest = current.find(file => file.name === asset.name);
    if (latest.id !== asset.id || latest.size !== asset.size || latest.digest.toLowerCase() !== asset.digest.toLowerCase()) {
      throw new Error(`Final draft metadata changed: ${asset.name}`);
    }
  }
  await writeFile(join(snapshotDir, "release.json"), `${JSON.stringify(snapshotRelease, null, 2)}\n`, { flag: "wx" });
  return { releaseId, assets: downloaded };
}

async function main() {
  assertMainBranch(process.env.GITHUB_REF);
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[a-z0-9-]+\/[a-z0-9_.-]+$/i.test(repository || "")) throw new Error("Invalid release repository");
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
      uploadAsset: (file, name) => api(["--method", "POST", "-H", "Content-Type: application/octet-stream",
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
