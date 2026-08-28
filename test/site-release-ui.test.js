// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  detectPlatform,
  formatBytes,
  groupAssets,
  isValidManifest,
  selectPrimaryAsset
} from "../site/release-ui.js";

const assets = [
  { platform: "macos", format: "DMG", primary: true },
  { platform: "macos", format: "App archive", primary: false },
  { platform: "windows", format: "EXE installer", primary: true },
  { platform: "linux", format: "AppImage", primary: true }
];

test("platform detection recognizes desktop operating systems", () => {
  assert.equal(detectPlatform({ userAgentDataPlatform: "macOS" }), "macos");
  assert.equal(detectPlatform({ platform: "Win32" }), "windows");
  assert.equal(detectPlatform({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }), "linux");
  assert.equal(detectPlatform({ platform: "iPhone" }), "unknown");
  assert.equal(detectPlatform({ userAgent: "Unknown" }), "unknown");
});

test("the recommended asset uses the primary package for the detected platform", () => {
  assert.equal(selectPrimaryAsset(assets, "macos").format, "DMG");
  assert.equal(selectPrimaryAsset(assets, "windows").format, "EXE installer");
  assert.equal(selectPrimaryAsset(assets, "unknown"), null);
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
