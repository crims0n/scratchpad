// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  detectPlatform,
  detectArchitecture,
  formatBytes,
  groupAssets,
  isValidManifest,
  selectPrimaryAsset
} from "../site/release-ui.js";

const assets = [
  { architecture: "Universal", platform: "macos", format: "DMG", primary: true },
  { architecture: "Universal", platform: "macos", format: "App archive", primary: false },
  { architecture: "x64", platform: "windows", format: "EXE installer", primary: true },
  { architecture: "x64", platform: "linux", format: "AppImage", primary: true }
];

test("platform detection recognizes desktop operating systems", () => {
  assert.equal(detectPlatform({ userAgentDataPlatform: "macOS" }), "macos");
  assert.equal(detectPlatform({ platform: "Win32" }), "windows");
  assert.equal(detectPlatform({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }), "linux");
  assert.equal(detectPlatform({ platform: "iPhone" }), "unknown");
  assert.equal(detectPlatform({ userAgent: "Unknown" }), "unknown");
  assert.equal(detectPlatform({ platform: "MacIntel", maxTouchPoints: 5 }), "unknown");
  assert.equal(detectPlatform({ userAgent: "X11; CrOS x86_64", platform: "Linux x86_64" }), "unknown");
  assert.equal(detectPlatform({ userAgentDataPlatform: "Chrome OS", platform: "Linux x86_64" }), "unknown");
  assert.equal(detectPlatform({ userAgentDataPlatform: "Windows", userAgent: "Macintosh" }), "windows");
  assert.equal(detectPlatform({ userAgentDataPlatform: "Linux", mobile: true }), "unknown");
});

test("architecture detection uses supported 64-bit Client Hints and never frozen UA strings", async () => {
  for (const platform of ["windows", "linux"]) {
    for (const [architecture, expected] of [["arm", "arm64"], ["x86", "x64"], ["riscv", "unknown"], ["", "unknown"]]) {
      const navigator = { userAgentData: { getHighEntropyValues: async hints => {
        assert.deepEqual(hints, ["architecture", "bitness"]);
        return { platform, architecture, bitness: "64" };
      } } };
      assert.equal(await detectArchitecture(navigator, platform), expected);
    }
  }
  for (const navigator of [{ userAgent: "Windows NT 10.0; Win64; x64", platform: "Win32" },
    { userAgent: "X11; Linux x86_64", platform: "Linux x86_64" },
    { userAgentData: { getHighEntropyValues: async () => ({ architecture: "x86", bitness: "32", platform: "Windows" }) } },
    { userAgentData: { getHighEntropyValues: async () => ({ architecture: "arm", platform: "Windows" }) } },
    { userAgentData: { getHighEntropyValues: async () => ({ architecture: "arm", bitness: "64", platform: "Android" }) } },
    { userAgentData: { getHighEntropyValues: async () => { throw new Error("denied"); } } }]) {
    assert.equal(await detectArchitecture(navigator, "windows"), "unknown");
  }
  assert.equal(await detectArchitecture({ userAgentData: { getHighEntropyValues: () => new Promise(() => {}) } }, "linux", { timeoutMs: 5 }), "unknown");
  const noHints = { userAgentData: { getHighEntropyValues: () => assert.fail("no architecture hint needed") } };
  assert.equal(await detectArchitecture(noHints, "macos"), "universal");
  assert.equal(await detectArchitecture(noHints, "unknown"), "unknown");
});

test("the recommended asset uses the primary package for the detected platform", () => {
  assert.equal(selectPrimaryAsset(assets, "macos").format, "DMG");
  assert.equal(selectPrimaryAsset(assets, "windows", "x64").format, "EXE installer");
  assert.equal(selectPrimaryAsset(assets, "unknown"), null);
  assert.equal(selectPrimaryAsset(assets, "windows"), null);
  assert.equal(selectPrimaryAsset(assets, "linux", "arm64"), null);
  const arm = [{ platform: "linux", architecture: "arm64", format: "Debian package", primary: false },
    { platform: "linux", architecture: "arm64", format: "AppImage", primary: false }];
  assert.equal(selectPrimaryAsset([...arm, ...assets], "linux", "arm64").format, "AppImage");
  assert.equal(selectPrimaryAsset([...arm, ...assets], "linux", "x64").architecture, "x64");
});

test("download helpers group platforms and format sizes", () => {
  assert.deepEqual(groupAssets(assets).map(({ platform }) => platform), ["macos", "windows", "linux"]);
  assert.equal(formatBytes(10_485_760), "10.0 MB");
  assert.equal(formatBytes(0), "Size unavailable");
});

test("manifest validation requires a usable release and assets", () => {
  assert.equal(isValidManifest({
    schemaVersion: 1,
    release: { version: "0.4.0", url: "https://example.com", assets }
  }), true);
  assert.equal(isValidManifest({ schemaVersion: 1, release: { assets: [] } }), false);
});
