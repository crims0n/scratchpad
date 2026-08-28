// SPDX-License-Identifier: GPL-3.0-or-later

export const PLATFORM_NAMES = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux"
};

export function detectPlatform({ userAgentDataPlatform = "", platform = "", userAgent = "" } = {}) {
  const hint = `${userAgentDataPlatform} ${platform} ${userAgent}`.toLowerCase();
  if (/iphone|ipad|ipod|android/.test(hint)) return "unknown";
  if (/mac/.test(hint)) return "macos";
  if (/win/.test(hint)) return "windows";
  if (/linux|x11/.test(hint)) return "linux";
  return "unknown";
}

export function selectPrimaryAsset(assets, platform) {
  const platformAssets = assets.filter((asset) => asset.platform === platform);
  return platformAssets.find((asset) => asset.primary) || platformAssets[0] || null;
}

export function groupAssets(assets) {
  return ["macos", "windows", "linux"].map((platform) => ({
    platform,
    assets: assets.filter((asset) => asset.platform === platform)
  })).filter((group) => group.assets.length > 0);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "Size unavailable";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** unitIndex)).toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatPublishedDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(date);
}

export function isValidManifest(manifest) {
  return manifest?.schemaVersion === 1 &&
    typeof manifest.release?.version === "string" &&
    typeof manifest.release?.url === "string" &&
    Array.isArray(manifest.release?.assets) &&
    manifest.release.assets.length > 0;
}
