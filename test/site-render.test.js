// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const html = await readFile(new URL("../site/index.html", import.meta.url), "utf8");
const manifest = JSON.parse(
  await readFile(new URL("../site/release.json", import.meta.url), "utf8")
);

test("the landing page renders the recommended package and complete download catalog", async () => {
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
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => manifest
  });

  await import(`${new URL("../site/app.js", import.meta.url).href}?render-test`);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const primary = dom.window.document.getElementById("primary-download");
  assert.equal(primary.textContent, "Download for macOS");
  assert.match(primary.href, /universal\.dmg$/);
  assert.equal(dom.window.document.querySelectorAll(".download-card").length, 6);
  assert.equal(dom.window.document.querySelectorAll(".checksum").length, 6);
  assert.equal(dom.window.document.getElementById("release-badge").textContent, "Beta v0.4.0");
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
