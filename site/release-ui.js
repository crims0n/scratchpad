// SPDX-License-Identifier: GPL-3.0-or-later

export const PLATFORM_NAMES = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux"
};

export const ARCHITECTURE_NAMES = {
  x64: "x64 (Intel / AMD)",
  arm64: "ARM64",
  universal: "Universal"
};

export function defaultArchitecture(platform) {
  return platform === "macos" ? "universal" : "unknown";
}

export function normalizeArchitecture(value) {
  const architecture = typeof value === "string" ? value.toLowerCase() : "";
  return Object.hasOwn(ARCHITECTURE_NAMES, architecture) ? architecture : "unknown";
}

export function detectPlatform({ userAgentDataPlatform = "", platform = "", userAgent = "", mobile = false, maxTouchPoints = 0 } = {}) {
  const hint = `${userAgentDataPlatform} ${platform} ${userAgent}`.toLowerCase();
  if (mobile || /\b(iphone|ipad|ipod|android|cros)\b/.test(hint)) return "unknown";
  // An explicit unsupported Client Hints platform must not be overridden by
  // its compatibility UA tokens (e.g. ChromeOS reporting Linux x86_64).
  if (userAgentDataPlatform) return ({ macos: "macos", windows: "windows", linux: "linux" })[userAgentDataPlatform.toLowerCase()] || "unknown";
  // iPadOS can use a desktop Mac identity, but a touchscreen Windows browser
  // mentioning a Mac must not override an explicit Client Hints platform.
  if (platform === "MacIntel" && maxTouchPoints > 1) return "unknown";
  if (/mac/.test(hint)) return "macos";
  if (/win/.test(hint)) return "windows";
  if (/linux|x11/.test(hint)) return "linux";
  return "unknown";
}

export async function detectArchitecture(navigator, platform, { timeoutMs = 1000 } = {}) {
  const architecture = defaultArchitecture(platform);
  if (architecture !== "unknown") return architecture;
  if (!["windows", "linux"].includes(platform) || typeof navigator.userAgentData?.getHighEntropyValues !== "function") return "unknown";
  let timer;
  try {
    const hints = await Promise.race([
      navigator.userAgentData.getHighEntropyValues(["architecture", "bitness"]),
      new Promise(resolve => { timer = setTimeout(() => resolve({}), timeoutMs); })
    ]);
    const hintedPlatform = detectPlatform({ userAgentDataPlatform: hints?.platform, mobile: hints?.mobile });
    if (hintedPlatform !== platform || hints?.bitness !== "64") return "unknown";
    if (hints.architecture === "arm") return "arm64";
    if (hints.architecture === "x86") return "x64";
  } catch { /* Unsupported, denied or unavailable hints require a choice. */ }
  finally { clearTimeout(timer); }
  // Never infer CPU architecture from frozen userAgent/platform strings.
  return "unknown";
}

export function selectPrimaryAsset(assets, platform, architecture = "unknown") {
  const defaultChoice = defaultArchitecture(platform);
  const selected = defaultChoice === "unknown" ? normalizeArchitecture(architecture) : defaultChoice;
  if (selected === "unknown") return null;
  const matching = assets.filter(asset => asset.platform === platform && normalizeArchitecture(asset.architecture) === selected);
  const preferredFormat = { macos: "DMG", windows: "EXE installer", linux: "AppImage" }[platform];
  return matching.find(asset => asset.primary) || matching.find(asset => asset.format === preferredFormat) || matching[0] || null;
}

export function groupAssets(assets) {
  const platforms = new Map(Object.keys(PLATFORM_NAMES).map(platform => [platform, new Map()]));
  for (const asset of assets) {
    const groups = platforms.get(asset.platform);
    if (!groups) continue;
    const architecture = normalizeArchitecture(asset.architecture);
    if (!groups.has(architecture)) groups.set(architecture, []);
    groups.get(architecture).push(asset);
  }
  return [...platforms].flatMap(([platform, groups]) => groups.size ? [{ platform,
    architectures: ["universal", "x64", "arm64", "unknown"].flatMap(architecture =>
      groups.has(architecture) ? [{ architecture, assets: groups.get(architecture) }] : [])
  }] : []);
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
