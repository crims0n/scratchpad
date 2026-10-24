// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const html = await readFile(new URL("../site/index.html", import.meta.url), "utf8");
const manifest = JSON.parse(
  await readFile(new URL("../site/release.json", import.meta.url), "utf8")
);
let renderId = 0;

async function render(t, response = manifest) {
  const dom = new JSDOM(html, {
    url: "https://crims0n.github.io/scratchpad/",
    pretendToBeVisual: true
  });
  Object.defineProperty(dom.window.navigator, "userAgentData", {
    value: { platform: "macOS" },
    configurable: true
  });

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true
  });
  globalThis.fetch = async () => {
    if (response instanceof Error) throw response;
    return { ok: true, json: async () => response };
  };

  await import(`${new URL("../site/app.js", import.meta.url).href}?render-test-${++renderId}`);
  await new Promise((resolve) => setTimeout(resolve, 0));
  t.after(() => dom.window.close());
  return dom.window.document;
}

test("the landing page renders the currently published package and complete download catalog", async t => {
  const document = await render(t);
  const primary = document.getElementById("primary-download");
  assert.equal(primary.textContent, "Download for macOS");
  assert.match(primary.href, /universal\.dmg$/);
  assert.equal(document.querySelectorAll(".download-card").length, 6);
  assert.equal(document.querySelectorAll(".checksum").length, 6);
  assert.equal(document.getElementById("release-badge").textContent, "Beta v0.8.2");
});

test("the landing page renders a published stable manifest with stable URLs and final checksums", async t => {
  const fixture = JSON.parse(await readFile(new URL("fixtures/release-transition.json", import.meta.url), "utf8"));
  const document = await render(t, fixture.manifest);
  assert.equal(document.getElementById("release-badge").textContent, "v1.0.0");
  assert.match(document.getElementById("primary-download").href, /\/v1\.0\.0\/Scratchpad_1\.0\.0_universal\.dmg$/);
  assert.equal(document.querySelectorAll(".download-card").length, 6);
  assert.ok([...document.querySelectorAll(".checksum")].every(element => /^[a-f0-9]{64}$/.test(element.textContent)));
});

test("an unavailable manifest falls back to release-neutral GitHub downloads", async t => {
  const document = await render(t, new Error("offline"));
  assert.equal(document.getElementById("release-badge").textContent, "Latest release");
  assert.equal(document.getElementById("primary-download").href, "https://github.com/crims0n/scratchpad/releases");
  assert.equal(document.querySelectorAll(".download-card").length, 0);
});

test("the landing page has named navigation, images, and download controls", () => {
  const document = new JSDOM(html).window.document;
  assert.ok(document.querySelector("nav[aria-label]"));
  assert.ok([...document.querySelectorAll("img")].every((image) => image.hasAttribute("alt")));
  assert.ok(document.getElementById("primary-download").textContent.trim());
  assert.ok(document.querySelector("meta[http-equiv='Content-Security-Policy']"));
});

test("the landing page describes current Markdown assistance", () => {
  const document = new JSDOM(html).window.document;
  const markdownFeature = [...document.querySelectorAll(".feature-grid article")]
    .find((article) => article.querySelector("h3")?.textContent === "Markdown-native");

  assert.match(markdownFeature.textContent, /smart list and table helpers/);
  assert.match(markdownFeature.textContent, /right-click starter templates/);
  assert.match(markdownFeature.textContent, /optional line numbers/);
  assert.match(markdownFeature.textContent, /language-aware code previews/);
});
