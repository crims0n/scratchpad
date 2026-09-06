// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { createTrashUi } from "../src/trash-ui.js";

const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
test("trash confirmation captures its collection and entries and supports keyboard cancellation", async () => {
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  globalThis.document = dom.window.document; globalThis.window = dom.window;
  const state = { collectionId: "one", entries: [{ id: "first", note: { title: "First" }, deletedAt: 1 }] };
  const calls = [];
  const ui = createTrashUi({ state: () => state, restore: async () => {}, empty: async (...args) => { calls.push(args); } });
  const button = document.getElementById("trash-btn");
  const key = (target, key, extra = {}) => target.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }));
  button.focus();
  key(button, "F10", { shiftKey: true });
  assert.equal(document.getElementById("trash-context-menu").style.display, "flex");
  document.getElementById("trash-menu-empty").click();
  assert.equal(document.activeElement.id, "cancel-empty-trash-btn");
  state.entries.push({ id: "later", note: { title: "Later" }, deletedAt: 2 });
  ui.refresh();
  assert.match(document.getElementById("trash-status").textContent, /1 deleted note/);
  document.getElementById("confirm-empty-trash-btn").click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls, [[["first"], "one"]], "newly deleted notes are outside the confirmed selection");
  const close = document.getElementById("close-trash-btn");
  close.focus(); key(close, "Tab", { shiftKey: true });
  assert.equal(document.activeElement.dataset.trashId, "first", "Shift+Tab wraps to the last restore button");
  key(document.activeElement, "Escape");
  assert.equal(document.getElementById("trash-modal-backdrop").getAttribute("aria-hidden"), "true");
  assert.equal(document.activeElement.id, "trash-btn");
  ui.close(); dom.window.close();
});
