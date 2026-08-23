// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const document = new JSDOM(html).window.document;

test("interactive controls have an accessible name", () => {
  const unnamed = [...document.querySelectorAll("button, input, select, textarea")]
    .filter((element) => {
      const visibleText = element.textContent.trim();
      return !visibleText &&
        !element.getAttribute("aria-label")?.trim() &&
        !element.getAttribute("title")?.trim();
    })
    .map((element) => element.id || element.outerHTML);

  assert.deepEqual(unnamed, []);
});

test("help and theme overlays expose modal dialog semantics", () => {
  const dialogs = [...document.querySelectorAll("[role='dialog']")];

  assert.equal(dialogs.length, 2);
  dialogs.forEach((dialog) => {
    assert.equal(dialog.getAttribute("aria-modal"), "true");
    assert.ok(dialog.getAttribute("aria-label") || dialog.getAttribute("aria-labelledby"));
  });
});
