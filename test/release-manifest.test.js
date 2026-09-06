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

test("channels select semantic versions, not publication order, and construct release links", () => {
  const make = (version, prerelease, published_at = release.published_at) => ({ ...release, tag_name: `${prerelease ? "scratchpad-beta-v" : "v"}${version}`, prerelease, published_at, html_url: "https://untrusted.example/" });
  const manifest = buildReleaseManifest([
    make("0.9.0", true, "2026-09-01T00:00:00Z"),
    make("0.10.0", true), make("0.8.0", false),
    make("0.7.0", false, "2026-09-02T00:00:00Z"),
    make("nonsense", false), make("1.0.0-beta.2", true), make("1.0.0-beta.10", true)
  ]);
  assert.equal(manifest.channels.beta.version, "1.0.0-beta.10");
  assert.equal(manifest.channels.stable.version, "0.8.0");
  assert.equal(manifest.channels.stable.channel, "stable");
  assert.equal(manifest.channels.stable.url, "https://github.com/crims0n/scratchpad/releases/tag/v0.8.0");
  assert.equal(buildReleaseManifest([release]).channels.stable, null);
  assert.equal(buildReleaseManifest([[make("0.3.0", true)], [release]]).channels.beta.version, "0.4.0");
  assert.throws(() => buildReleaseManifest([make("v9.0.0", false), make(" 9.0.0 ", false)]), /No published/);
});
