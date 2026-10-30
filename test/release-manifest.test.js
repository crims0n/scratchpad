// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildReleaseManifest } from "../scripts/generate-release-manifest.mjs";
import { selectPrimaryAsset } from "../site/release-ui.js";
import { expectedAssets } from "../scripts/release-verification.mjs";

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

test("the catalog recognizes all ten stable installers with explicit architectures and unchanged legacy aliases", () => {
  const assets = expectedAssets("1.1.0").map(name => ({ name, size: 123, digest: `sha256:${"a".repeat(64)}`,
    browser_download_url: `https://github.com/crims0n/scratchpad/releases/download/v1.1.0/${name}` }));
  const manifest = buildReleaseManifest([{ ...release, tag_name: "v1.1.0", prerelease: false, assets }]);
  assert.equal(manifest.release.assets.length, 10);
  for (const platform of ["linux", "windows"]) for (const architecture of ["x64", "arm64"]) {
    const pair = manifest.release.assets.filter(asset => asset.platform === platform && asset.architecture === architecture);
    assert.equal(pair.length, 2);
    assert.equal(pair.filter(asset => asset.primary).length, architecture === "x64" ? 1 : 0);
  }
  for (const platform of ["linux", "windows"]) {
    assert.equal(manifest.release.assets.filter(asset => asset.platform === platform && asset.primary).length, 1);
    assert.equal(selectPrimaryAsset([...manifest.release.assets].reverse(), platform).architecture, "x64");
  }
  assert.equal(manifest.channels.stable.version, "1.1.0");
  assert.equal(manifest.channels.beta.version, "1.1.0");
  assert.equal(manifest.channels.beta.prerelease, true);
  assert.ok(manifest.release.assets.every(asset => asset.sha256 === "a".repeat(64)));
});

test("fork and renamed repository catalogs use the supplied identity and reject upstream package URLs", () => {
  const repository = "someone/notepad";
  const fork = structuredClone(release);
  fork.assets = fork.assets.map(asset => ({
    ...asset, browser_download_url: asset.browser_download_url.replace("crims0n/scratchpad", repository)
  }));
  const manifest = buildReleaseManifest([fork], { repository });
  assert.equal(manifest.repository, repository);
  assert.equal(manifest.release.url, `https://github.com/${repository}/releases/tag/${release.tag_name}`);
  assert.equal(manifest.release.assets.length, 3);
  assert.ok(manifest.release.assets.every(asset => asset.url.startsWith(`https://github.com/${repository}/releases/download/`)));
  assert.throws(() => buildReleaseManifest([release], { repository }), /No published Scratchpad release/);
  assert.throws(() => buildReleaseManifest([fork], { repository: "invalid/owner/repo" }), /Invalid release repository/);
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

test("stable wins over higher betas and legacy clients are directed to the same release", () => {
  const make = (version, prerelease, published_at = release.published_at) => ({ ...release, tag_name: `${prerelease ? "scratchpad-beta-v" : "v"}${version}`, prerelease, published_at, html_url: "https://untrusted.example/" });
  const manifest = buildReleaseManifest([
    make("0.9.0", true, "2026-09-01T00:00:00Z"),
    make("0.10.0", true), make("0.8.0", false),
    make("0.7.0", false, "2026-09-02T00:00:00Z"),
    make("nonsense", false), make("1.0.0-beta.2", true), make("1.0.0-beta.10", true)
  ]);
  assert.equal(manifest.release.version, "0.8.0");
  assert.equal(manifest.release.prerelease, false);
  assert.deepEqual(manifest.channels.beta, { ...manifest.channels.stable, channel: "beta", prerelease: true });
  assert.equal(manifest.channels.stable.version, "0.8.0");
  assert.equal(manifest.channels.stable.channel, "stable");
  assert.equal(manifest.channels.stable.url, "https://github.com/crims0n/scratchpad/releases/tag/v0.8.0");
  assert.equal(buildReleaseManifest([release]).channels.stable, null);
  assert.equal(buildReleaseManifest([[make("0.3.0", true)], [release]]).channels.beta.version, "0.4.0");
  assert.throws(() => buildReleaseManifest([make("v9.0.0", false), make(" 9.0.0 ", false)]), /No published/);
});

test("the transition fixture is generated by the real publisher and consumed by both Rust parsers", async () => {
  const fixture = JSON.parse(await readFile(new URL("fixtures/release-transition.json", import.meta.url), "utf8"));
  assert.deepEqual(buildReleaseManifest(fixture.releases, { generatedAt: fixture.manifest.generatedAt }), fixture.manifest);
  assert.equal(fixture.manifest.release.tag, "v1.0.0");
  assert.equal(fixture.manifest.release.assets.length, 6);
  assert.ok(fixture.manifest.release.assets.every(asset => /^[a-f0-9]{64}$/.test(asset.sha256)));
});

test("a draft stable release cannot redirect existing clients before publication", () => {
  const draft = { ...release, tag_name: "v1.0.0", prerelease: false, draft: true };
  const manifest = buildReleaseManifest([release, draft]);
  assert.equal(manifest.release.tag, release.tag_name);
  assert.equal(manifest.channels.stable, null);
  assert.equal(manifest.channels.beta.tag, release.tag_name);
});

test("before the first stable release, semantic prerelease order still selects the beta", () => {
  const beta = version => ({ ...release, tag_name: `scratchpad-beta-v${version}` });
  const manifest = buildReleaseManifest([beta("1.0.0-beta.2"), beta("1.0.0-beta.10")]);
  assert.equal(manifest.release.version, "1.0.0-beta.10");
  assert.equal(manifest.channels.beta.version, "1.0.0-beta.10");
  assert.equal(manifest.channels.stable, null);
});
