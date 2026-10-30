// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import { initializeDownloads } from "../site/app.js";
import { buildReleaseManifest } from "../scripts/generate-release-manifest.mjs";
import { expectedAssets } from "../scripts/release-verification.mjs";

const html = await readFile(new URL("../site/index.html", import.meta.url), "utf8");
const legacy = JSON.parse(await readFile(new URL("fixtures/release-transition.json", import.meta.url), "utf8")).manifest;
const complete = buildReleaseManifest([{ tag_name: "v1.1.0", name: "Scratchpad v1.1.0", draft: false, prerelease: false,
  published_at: "2026-10-30T00:00:00Z", body: "New packages.", assets: expectedAssets("1.1.0").map((name, index) => ({ name,
    browser_download_url: `https://github.com/crims0n/scratchpad/releases/download/v1.1.0/${name}`,
    size: 1000 + index, digest: `sha256:${String(index).repeat(64).slice(0, 64)}` })) }]);

function page(t, { manifest = complete, platform = "Windows", architecture = "arm", hints, fetchImpl } = {}) {
  const dom = new JSDOM(html, { url: "https://example.com/fork/" });
  t.after(() => dom.window.close());
  const document = dom.window.document;
  const navigator = { platform: platform === "macOS" ? "MacIntel" : "Win32", userAgent: "",
    userAgentData: { platform, getHighEntropyValues: hints || (async () => ({ platform, architecture, bitness: "64" })) } };
  const ready = initializeDownloads({ document, navigator, detectionTimeoutMs: 10, fetchImpl: fetchImpl || (async url => {
    assert.equal(url, "./release.json");
    return { ok: true, json: async () => structuredClone(manifest) };
  }) });
  const byId = id => document.getElementById(id);
  const choose = (id, value) => { byId(id).value = value; byId(id).dispatchEvent(new dom.window.Event("change", { bubbles: true })); };
  return { ready, byId, choose, document };
}

test("the real download page selects ARM64 and preserves every package URL and checksum", async t => {
  const p = page(t);
  await p.ready;
  assert.equal(p.byId("download-platform").value, "windows");
  assert.equal(p.byId("download-architecture").value, "arm64");
  assert.match(p.byId("primary-download").href, /_arm64-setup\.exe$/);
  assert.equal(p.byId("download-choices").hidden, false);
  assert.equal(p.document.querySelectorAll(".architecture-group").length, 5);
  assert.equal(p.document.querySelectorAll(".download-card").length, 10);
  const cards = [...p.document.querySelectorAll(".download-card")];
  for (const asset of complete.release.assets) {
    const card = cards.find(card => card.querySelector("a").href === asset.url);
    assert.ok(card);
    assert.equal(card.querySelector(".checksum").textContent, asset.sha256);
  }
  assert.match(p.document.querySelector(".architecture-group.is-selected").textContent, /ARM64/);
  p.choose("download-architecture", "x64");
  assert.match(p.byId("primary-download").href, /_x64-setup\.exe$/);
  assert.ok(p.byId("download-platform").labels.length);
  assert.ok(p.byId("download-architecture").labels.length);
  assert.equal(p.byId("download-status").getAttribute("aria-live"), "polite");
});

test("unknown architecture requires a choice, then manual platform changes reset that choice", async t => {
  const p = page(t, { hints: async () => ({ platform: "Windows" }) });
  await p.ready;
  assert.equal(p.byId("download-architecture").value, "unknown");
  assert.equal(p.byId("primary-download").getAttribute("href"), "#download-architecture");
  assert.equal(p.byId("primary-download").hasAttribute("download"), false);
  p.byId("primary-download").click();
  assert.equal(p.document.activeElement, p.byId("download-architecture"));
  p.choose("download-architecture", "arm64");
  assert.match(p.byId("primary-download").href, /_arm64-setup/);
  p.choose("download-platform", "linux");
  assert.equal(p.byId("download-architecture").value, "unknown");
  p.choose("download-architecture", "arm64");
  assert.match(p.byId("primary-download").href, /_aarch64\.AppImage$/);
  p.choose("download-platform", "macos");
  assert.equal(p.byId("download-architecture").value, "universal");
  assert.equal(p.byId("download-architecture").disabled, true);
  assert.match(p.byId("primary-download").href, /_universal\.dmg$/);
});

test("the published x64-only catalog never silently substitutes x64 for an ARM64 computer", async t => {
  const p = page(t, { manifest: legacy });
  await p.ready;
  assert.equal(p.byId("download-architecture").value, "arm64");
  assert.equal(p.byId("primary-download").href, legacy.release.url);
  assert.equal(p.byId("primary-download").hasAttribute("download"), false);
  assert.match(p.byId("primary-detail").textContent, /No ARM64 package.*v1\.0\.0/);
  assert.equal(p.document.querySelectorAll(".download-card").length, 6);
  assert.equal(p.document.querySelectorAll('[data-architecture="arm64"]').length, 0);
  p.choose("download-architecture", "x64");
  assert.match(p.byId("primary-download").href, /_x64-setup\.exe$/);
});

test("a late architecture response cannot overwrite the user's explicit processor or OS choice", async t => {
  for (const changedPlatform of [false, true]) {
    let resolveHints;
    const p = page(t, { hints: () => new Promise(resolve => { resolveHints = resolve; }) });
    for (let i = 0; i < 5 && !resolveHints; i++) await Promise.resolve();
    assert.ok(resolveHints);
    if (changedPlatform) p.choose("download-platform", "linux");
    p.choose("download-architecture", "x64");
    resolveHints({ platform: "Windows", architecture: "arm", bitness: "64" });
    await p.ready;
    assert.equal(p.byId("download-platform").value, changedPlatform ? "linux" : "windows");
    assert.equal(p.byId("download-architecture").value, "x64");
    assert.match(p.byId("primary-download").href, changedPlatform ? /_amd64\.AppImage$/ : /_x64-setup\.exe$/);
  }
});

test("macOS Universal needs no CPU guess, while mobile and unsupported platforms require an OS choice", async t => {
  const mac = page(t, { platform: "macOS", hints: () => assert.fail("Universal needs no hints") });
  await mac.ready;
  assert.match(mac.byId("primary-download").href, /_universal\.dmg$/);
  const mobile = page(t, { platform: "Android", hints: () => assert.fail("no desktop CPU inference on Android") });
  await mobile.ready;
  assert.equal(mobile.byId("primary-download").getAttribute("href"), "#download-platform");
  assert.equal(mobile.byId("download-architecture").disabled, true);
});

test("denied or hanging hints leave usable choices; manifest failure retains the Releases fallback", async t => {
  for (const hints of [async () => { throw new Error("denied"); }, () => new Promise(() => {})]) {
    const p = page(t, { hints });
    await p.ready;
    p.choose("download-architecture", "arm64");
    assert.match(p.byId("primary-download").href, /_arm64-setup/);
  }
  const p = page(t, { fetchImpl: async () => ({ ok: false, status: 503 }) });
  await p.ready;
  assert.equal(p.byId("download-choices").hidden, true);
  assert.equal(p.byId("primary-download").href, "https://github.com/crims0n/scratchpad/releases");
  assert.equal(p.byId("primary-download").hasAttribute("download"), false);
});
