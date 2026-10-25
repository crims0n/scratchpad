// SPDX-License-Identifier: GPL-3.0-or-later

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { stableRelease } from "./check-stable-release.mjs";

export const platforms = ["macos", "windows", "linux"];

export function platformAssetNames(version, platform) {
  stableRelease(version);
  const suffixes = {
    macos: ["universal.dmg", "universal.app.tar.gz"],
    windows: ["x64-setup.exe", "x64_en-US.msi"],
    linux: ["amd64.AppImage", "amd64.deb"]
  };
  if (!platforms.includes(platform)) throw new Error("Unknown release platform");
  const names = suffixes[platform].map(suffix => `Scratchpad_${version}_${suffix}`);
  return platform === "linux" ? names.concat("SHA256SUMS", "SHA256SUMS.asc") : names;
}

export function expectedAssets(version) {
  return platforms.flatMap(platform => platformAssetNames(version, platform));
}

export function assertReleaseRepository(repository) {
  if (!/^[a-z0-9-]+\/[a-z0-9_.-]+$/i.test(repository || "")) throw new Error("Invalid release repository");
}

export function draftAssets({ release, releaseId, version, commit, complete = true }) {
  const { tag, name } = stableRelease(version);
  if (!Number.isSafeInteger(releaseId) || releaseId <= 0 || release?.id !== releaseId) throw new Error("Draft ID does not match the prepared release");
  if (!/^[a-f0-9]{40}$/.test(commit || "") || release.target_commitish !== commit) throw new Error("Draft must target the reviewed source commit");
  if (release.tag_name !== tag || release.name !== name || release.draft !== true || release.prerelease !== false) {
    throw new Error("Expected an unpublished stable Scratchpad draft with the candidate version");
  }
  const expected = expectedAssets(version).sort();
  const assets = release.assets;
  if (!Array.isArray(assets) || assets.some(asset => !expected.includes(asset?.name))
    || new Set(assets.map(asset => asset.name)).size !== assets.length
    || (complete && JSON.stringify(assets.map(asset => asset.name).sort()) !== JSON.stringify(expected))) {
    throw new Error("Draft must contain exactly the six stable installers and two Linux checksum/signature files");
  }
  const ids = new Set();
  for (const asset of assets) {
    if (!Number.isSafeInteger(asset.id) || asset.id <= 0 || ids.has(asset.id)) throw new Error("Invalid or duplicate draft asset ID");
    ids.add(asset.id);
    if (complete && (asset.state !== "uploaded" || !Number.isSafeInteger(asset.size) || asset.size <= 0 || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest || ""))) {
      throw new Error(`Missing final upload metadata/digest: ${asset.name}`);
    }
  }
  return assets;
}

export function assertDraftUnchanged({ release, verifiedRelease, releaseId, version, commit }) {
  const identity = { releaseId, version, commit };
  const verified = draftAssets({ ...identity, release: verifiedRelease });
  const current = draftAssets({ ...identity, release });
  for (const asset of verified) {
    const latest = current.find(file => file.name === asset.name);
    if (latest.id !== asset.id || latest.size !== asset.size || latest.digest.toLowerCase() !== asset.digest.toLowerCase()) {
      throw new Error(`Final draft metadata changed: ${asset.name}`);
    }
  }
  return current;
}

export async function downloadDraftAssets({ release, releaseId, version, commit, assetsDir, download }) {
  const assets = draftAssets({ release, releaseId, version, commit });
  // A fresh directory prevents files from another draft or rerun being mixed
  // in. Exact allowlisted names and positive IDs are checked before any I/O.
  await mkdir(assetsDir);
  for (const asset of assets) await download(asset.id, join(assetsDir, asset.name));
}

export async function hashFile(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.size <= 0) throw new Error(`Missing or empty release file: ${file}`);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { name: basename(file), size: info.size, sha256: hash.digest("hex") };
}

function assertIdentity({ releaseId, version, commit, runId }) {
  stableRelease(version);
  if (!Number.isSafeInteger(releaseId) || releaseId <= 0 || !/^[a-f0-9]{40}$/.test(commit || "")
    || typeof runId !== "string" || !/^[1-9]\d*$/.test(runId)) {
    throw new Error("Verification evidence requires the release ID, version, source commit and workflow run ID");
  }
}

function assertNames(assets, version, platform) {
  const expected = platformAssetNames(version, platform).sort();
  if (!Array.isArray(assets) || JSON.stringify(assets.map(asset => asset?.name).sort()) !== JSON.stringify(expected)) {
    throw new Error(`Verification evidence must cover exactly the ${platform} release files`);
  }
}

// Call only after the platform's signature checks succeed, with those same
// local files (after stapling on macOS). Never derive this record from GitHub
// upload metadata: it is the independent link to signature-checked bytes.
export async function recordVerification({ platform, files, releaseId, version, commit, runId }) {
  assertIdentity({ releaseId, version, commit, runId });
  assertNames(files.map(file => ({ name: basename(file) })), version, platform);
  const assets = await Promise.all(files.map(hashFile));
  return { schemaVersion: 1, platform, releaseId, version, commit, runId, assets };
}

export function verifyEvidence({ evidence, verified, releaseId, version, commit, runId }) {
  assertIdentity({ releaseId, version, commit, runId });
  if (!Array.isArray(evidence) || evidence.length !== platforms.length
    || new Set(evidence.map(record => record?.platform)).size !== platforms.length) {
    throw new Error("Exactly one verification record per platform is required");
  }
  for (const record of evidence) {
    if (record.schemaVersion !== 1 || record.releaseId !== releaseId || record.version !== version
      || record.commit !== commit || record.runId !== runId) {
      throw new Error("Verification evidence does not match this candidate and workflow run");
    }
    assertNames(record.assets, version, record.platform);
    for (const asset of record.assets) {
      const downloaded = verified.find(file => file.name === asset.name);
      if (!/^[a-f0-9]{64}$/.test(asset.sha256 || "") || !Number.isSafeInteger(asset.size) || asset.size <= 0
        || !downloaded || downloaded.sha256 !== asset.sha256 || downloaded.size !== asset.size) {
        throw new Error(`Draft asset does not match signature-checked bytes: ${asset.name}`);
      }
    }
  }
}

async function main() {
  const [platform, ...files] = process.argv.slice(2);
  const output = process.env.VERIFICATION_EVIDENCE_PATH;
  if (!output) throw new Error("VERIFICATION_EVIDENCE_PATH must be set");
  const record = await recordVerification({ platform, files, releaseId: Number(process.env.RELEASE_ID),
    version: process.env.RELEASE_VERSION, commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
