// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { bootApp } from "./helpers/app-harness.js";

const NOTES = [
  { id: "one", title: "One", content: "First", updatedAt: 1, isTitleLocked: true },
  { id: "two", title: "Two", content: "Second", updatedAt: 2, isTitleLocked: true },
  { id: "three", title: "Three", content: "Third", updatedAt: 3, isTitleLocked: true }
];

test("notes can be pinned and unpinned from the sidebar", async () => {
  const app = await bootApp({ storage: { scratchpad_notes: NOTES } });
  const contextPinButton = document.getElementById("ctx-pin-note");
  const noteItem = id => document.querySelector(`.note-item[data-id="${id}"]`);
  const openContextMenu = id => noteItem(id).dispatchEvent(new app.dom.window.MouseEvent(
    "contextmenu",
    { bubbles: true, cancelable: true }
  ));

  openContextMenu("two");
  assert.equal(contextPinButton.textContent.trim(), "Pin to Top");
  contextPinButton.click();

  assert.deepEqual(app.sidebarTitles(), ["Two", "One", "Three"]);
  assert.equal(noteItem("two").dataset.pinned, "true");
  assert.equal(noteItem("two").querySelector(".note-item-pin").getAttribute("aria-pressed"), "true");

  noteItem("three").querySelector(".note-item-pin").click();
  assert.deepEqual(app.sidebarTitles(), ["Three", "Two", "One"]);

  openContextMenu("three");
  assert.equal(contextPinButton.textContent.trim(), "Unpin from Top");
  contextPinButton.click();

  assert.deepEqual(app.sidebarTitles(), ["Two", "Three", "One"]);
  assert.deepEqual(
    app.read("scratchpad_notes").map(({ id, isPinned }) => [id, isPinned === true]),
    [["two", true], ["three", false], ["one", false]]
  );
});
