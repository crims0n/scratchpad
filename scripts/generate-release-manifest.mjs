// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const REPOSITORY = "crims0n/scratchpad";
const DOWNLOAD_PREFIX = `/${REPOSITORY}/releases/download/`;

const ASSET_RULES = [
  { pattern: /_universal\.dmg$/i, platform: "macos", format: "DMG", architecture: "Universal", primary: true, order: 0 },
  { pattern: /_universal\.app\.tar\.gz$/i, platform: "macos", format: "App archive", architecture: "Universal", primary: false, order: 1 },
  { pattern: /_x64-setup\.exe$/i, platform: "windows", format: "EXE installer", architecture: "x64", primary: true, order: 0 },
  { pattern: /_x64_en-US\.msi$/i, platform: "windows", format: "MSI installer", architecture: "x64", primary: false, order: 1 },
  { pattern: /_amd64\.AppImage$/i, platform: "linux", format: "AppImage", architecture: "x64", primary: true, order: 0 },
  { pattern: /_amd64\.deb$/i, platform: "linux", format: "Debian package", architecture: "x64", primary: false, order: 1 }
];

const PLATFORM_ORDER = { macos: 0, windows: 1, linux: 2 };

function getAssetRule(name) {
  return ASSET_RULES.find(({ pattern }) => pattern.test(name));
}

function getTrustedDownloadUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.hostname !== "github.com") return null;
    if (!url.pathname.startsWith(DOWNLOAD_PREFIX)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function getSha256(digest) {
  const match = /^sha256:([a-f0-9]{64})$/i.exec(digest || "");
  return match ? match[1].toLowerCase() : null;
}

export function buildReleaseManifest(releases, { generatedAt = new Date().toISOString() } = {}) {
  const candidates = (Array.isArray(releases) ? releases : [releases])
    .filter((release) => release && !release.draft && release.published_at)
    .sort((left, right) => new Date(right.published_at) - new Date(left.published_at));

  for (const release of candidates) {
    const assets = (release.assets || []).flatMap((asset) => {
      const rule = getAssetRule(asset.name || "");
      const url = getTrustedDownloadUrl(asset.browser_download_url);
      if (!rule || !url) return [];

      return [{
        name: asset.name,
        url,
        size: Number.isFinite(asset.size) ? asset.size : 0,
        sha256: getSha256(asset.digest),
        platform: rule.platform,
        format: rule.format,
        architecture: rule.architecture,
        primary: rule.primary,
        order: rule.order
      }];
    }).sort((left, right) =>
      PLATFORM_ORDER[left.platform] - PLATFORM_ORDER[right.platform] || left.order - right.order
    );

    if (assets.length === 0) continue;

    const tag = String(release.tag_name || "");
    const version = tag.replace(/^scratchpad-beta-v/i, "").replace(/^v/i, "");
    return {
      schemaVersion: 1,
      generatedAt,
      repository: REPOSITORY,
      release: {
        tag,
        name: release.name || tag,
        version,
        prerelease: Boolean(release.prerelease),
        publishedAt: release.published_at,
        url: release.html_url || `https://github.com/${REPOSITORY}/releases/tag/${encodeURIComponent(tag)}`,
        notes: String(release.body || "").trim(),
        assets
      }
    };
  }

  throw new Error("No published Scratchpad release with recognized installer assets was found");
}

function getArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const inputPath = getArgument("--input");
  const outputPath = getArgument("--output");
  if (!inputPath || !outputPath) {
    throw new Error("Usage: node scripts/generate-release-manifest.mjs --input releases.json --output release.json");
  }

  const releases = JSON.parse(await readFile(inputPath, "utf8"));
  const manifest = buildReleaseManifest(releases);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
