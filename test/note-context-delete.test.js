// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

test("the note context menu deletes its target and stays separate from folder and text menus", async () => {
  const app = await bootApp({ storage: {
    scratchpad_notes: [
      { id: "one", title: "One", content: "First", updatedAt: 2, isTitleLocked: true },
      { id: "two", title: "Two", content: "Second", updatedAt: 1, isTitleLocked: true }
    ],
    scratchpad_folders: [{ id: "work", name: "Work" }]
  } });
  const item = id => document.querySelector(`.note-item[data-id="${id}"]`);
  const open = element => element.dispatchEvent(new app.dom.window.MouseEvent("contextmenu", {
    bubbles: true, cancelable: true, clientX: 100, clientY: 100
  }));
  const button = document.getElementById("ctx-delete-note");
  const divider = document.getElementById("ctx-delete-note-divider");
  item("one").click();
  open(item("two"));
  assert.equal(button.style.display, "flex");
  assert.equal(divider.style.display, "block");
  button.click();
  await app.settle();
  assert.deepEqual(app.read("scratchpad_notes").map(note => note.id), ["one"]);
  assert.equal(document.getElementById("note-title").value, "One");
  assert.equal(document.getElementById("custom-context-menu").style.display, "none");

  for (const target of [document.querySelector('.note-folder-header'), document.getElementById("editor-textarea")]) {
    open(target);
    assert.equal(button.style.display, "none");
    assert.equal(divider.style.display, "none");
  }

  open(item("one"));
  button.click();
  await app.settle();
  const remaining = app.read("scratchpad_notes");
  assert.equal(remaining.length, 1, "deleting the last note retains the existing blank-note fallback");
  assert.notEqual(remaining[0].id, "one");
  assert.equal(remaining[0].content, "");
  assert.equal(document.getElementById("editor-textarea").value, "");
});
