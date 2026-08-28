// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { buildReleaseManifest } from "../scripts/generate-release-manifest.mjs";

const release = {
  tag_name: "scratchpad-beta-v0.4.0",
  name: "Scratchpad Beta v0.4.0",
  draft: false,
  prerelease: true,
  published_at: "2026-08-23T22:03:45Z",
  html_url: "https://github.com/crims0n/scratchpad/releases/tag/scratchpad-beta-v0.4.0",
  body: "A useful beta release.",
  assets: [
    {
      name: "Scratchpad.Beta_0.4.0_universal.dmg",
      browser_download_url: "https://github.com/crims0n/scratchpad/releases/download/scratchpad-beta-v0.4.0/Scratchpad.Beta_0.4.0_universal.dmg",
      size: 10_000_000,
      digest: `sha256:${"a".repeat(64)}`
    },
    {
      name: "Scratchpad.Beta_0.4.0_x64-setup.exe",
      browser_download_url: "https://github.com/crims0n/scratchpad/releases/download/scratchpad-beta-v0.4.0/Scratchpad.Beta_0.4.0_x64-setup.exe",
      size: 3_000_000,
      digest: `sha256:${"b".repeat(64)}`
    },
    {
      name: "Scratchpad.Beta_0.4.0_amd64.AppImage",
      browser_download_url: "https://github.com/crims0n/scratchpad/releases/download/scratchpad-beta-v0.4.0/Scratchpad.Beta_0.4.0_amd64.AppImage",
      size: 80_000_000,
      digest: `sha256:${"c".repeat(64)}`
    },
    {
      name: "untrusted.exe",
      browser_download_url: "https://example.com/untrusted.exe",
      size: 1,
      digest: `sha256:${"d".repeat(64)}`
    }
  ]
};

test("release manifests include beta installers, metadata, and trusted checksums", () => {
  const manifest = buildReleaseManifest([release], {
    generatedAt: "2026-08-28T12:00:00Z"
  });

  assert.equal(manifest.release.version, "0.4.0");
  assert.equal(manifest.release.prerelease, true);
  assert.equal(manifest.release.assets.length, 3);
  assert.deepEqual(
    manifest.release.assets.map(({ platform, format, primary }) => ({ platform, format, primary })),
    [
      { platform: "macos", format: "DMG", primary: true },
      { platform: "windows", format: "EXE installer", primary: true },
      { platform: "linux", format: "AppImage", primary: true }
    ]
  );
  assert.equal(manifest.release.assets[0].sha256, "a".repeat(64));
  assert.equal(manifest.generatedAt, "2026-08-28T12:00:00Z");
});

test("manifest generation ignores drafts and chooses the newest published release", () => {
  const older = {
    ...release,
    tag_name: "scratchpad-beta-v0.3.1",
    published_at: "2026-08-22T12:00:00Z"
  };
  const draft = {
    ...release,
    tag_name: "scratchpad-beta-v0.5.0",
    draft: true,
    published_at: "2026-08-29T12:00:00Z"
  };

  const manifest = buildReleaseManifest([older, draft, release]);
  assert.equal(manifest.release.tag, "scratchpad-beta-v0.4.0");
});

test("manifest generation fails closed without recognized trusted assets", () => {
  assert.throws(
    () => buildReleaseManifest([{ ...release, assets: release.assets.slice(3) }]),
    /No published Scratchpad release/
  );
});
