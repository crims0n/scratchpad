// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { marked } from "marked";
import { bootApp } from "./helpers/app-harness.js";

test("browser-only HTML download uses an HTML blob and releases its object URL without changing notes", async () => {
  const app = await bootApp({ globals: { marked }, storage: { scratchpad_notes: [
    { id: "note", title: "Browser", content: "# Browser note", updatedAt: 1 }
  ] }, beforeBoot: win => { delete win.__TAURI__; } });
  const before = app.dumpStorage();
  let blob;
  let anchor;
  const revoked = [];
  globalThis.URL.createObjectURL = value => { blob = value; return "blob:test-html"; };
  globalThis.URL.revokeObjectURL = value => revoked.push(value);
  const original = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function () { anchor = this; };
  try {
    app.click("export-html-btn");
    await app.settle();
    assert.equal(blob.type, "text/html;charset=utf-8");
    const doc = new JSDOM(await blob.text()).window.document;
    assert.equal(doc.querySelector("h1").textContent, "Browser note");
    assert.equal(anchor.download, "Browser.html");
    assert.equal(anchor.href, "blob:test-html");
    assert.equal(anchor.isConnected, false);
    assert.deepEqual(app.dumpStorage(), before);
    assert.equal(app.invocations.length, 0);
    assert.deepEqual(revoked, []);
    await app.settle(1050);
    assert.deepEqual(revoked, ["blob:test-html"]);
  } finally {
    window.HTMLAnchorElement.prototype.click = original;
    delete globalThis.URL.createObjectURL;
    delete globalThis.URL.revokeObjectURL;
  }
});

test("an empty collection cannot export a phantom note or invoke a save picker", async () => {
  const app = await bootApp({ instance: 2, globals: { marked }, storage: {
    scratchpad_notes: [], scratchpad_folders: [], scratchpad_trash: []
  } });
  app.invocations.length = 0;
  app.click("export-html-btn");
  await app.settle();
  assert.equal(app.invocations.length, 0);
  assert.equal(document.getElementById("save-status").textContent, "Select a note to export");
  assert.deepEqual(app.read("scratchpad_notes"), []);
});
