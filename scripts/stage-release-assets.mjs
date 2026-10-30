// SPDX-License-Identifier: GPL-3.0-or-later

import { appendFile, copyFile, lstat, mkdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hashFile, platformAssetNames } from "./release-verification.mjs";

// Tauri-action reports the .app directory before creating its .tar.gz archive.
// Normalize that archive's release name here, without a release-upload token.
export async function stageReleaseAssets({ platform, architecture, version, artifactPaths, outputDir }) {
  const names = platformAssetNames(version, platform, architecture).filter(name => !name.startsWith("SHA256SUMS"));
  if (!Array.isArray(artifactPaths) || artifactPaths.some(path => typeof path !== "string" || !path)) {
    throw new Error("Tauri must return an array of artifact paths");
  }
  const sources = new Map(names.map(name => [name, new Set()]));
  for (let source of artifactPaths) {
    let name = basename(source);
    if (platform === "macos" && (name === "Scratchpad.app" || name === "Scratchpad.app.tar.gz")) {
      if (name.endsWith(".app")) source += ".tar.gz";
      name = names.find(name => name.endsWith(".app.tar.gz"));
    }
    if (sources.has(name)) sources.get(name).add(resolve(source));
    else if (/\.(AppImage|deb|exe|msi|dmg|app\.tar\.gz)$/i.test(name)) throw new Error(`Unexpected built installer: ${name}`);
  }
  const selected = [];
  for (const name of names) {
    const candidates = [...sources.get(name)];
    if (candidates.length !== 1 || !(await lstat(candidates[0])).isFile()) {
      throw new Error(`Expected exactly one regular built artifact for ${name}`);
    }
    selected.push({ name, source: candidates[0], hash: await hashFile(candidates[0]) });
  }
  await mkdir(outputDir);
  const files = [];
  for (const { name, source, hash } of selected) {
    const destination = join(outputDir, name);
    await copyFile(source, destination);
    const copied = await hashFile(destination);
    if (copied.sha256 !== hash.sha256 || copied.size !== hash.size) throw new Error(`Staged file mismatch: ${name}`);
    files.push(destination);
  }
  return files;
}

async function main() {
  const files = await stageReleaseAssets({ platform: process.env.RELEASE_PLATFORM, version: process.env.RELEASE_VERSION,
    architecture: process.env.RELEASE_ARCHITECTURE,
    artifactPaths: JSON.parse(process.env.ARTIFACT_PATHS || "null"), outputDir: process.env.RELEASE_ASSETS_DIR });
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `asset_paths=${JSON.stringify(files)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
