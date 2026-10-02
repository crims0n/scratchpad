// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { getAppElement, bootApp } from "./helpers/app-harness.js";

const numbers = (id = "editor") => [...document.querySelectorAll(`#${id} .cm-lineNumbers .cm-gutterElement`)]
  .filter(element => element.style.visibility !== "hidden").map(element => element.textContent);

test("native gutters update in both panes and share the editor scroller", async () => {
  const app = await bootApp({ storage: {
    scratchpad_editor_line_numbers: "true",
    scratchpad_notes: [
      { id: "one", title: "One", content: "one\ntwo", updatedAt: 2, isTitleLocked: true },
      { id: "two", title: "Two", content: "alpha\nbeta\ngamma", updatedAt: 1, isTitleLocked: true }
    ]
  } });
  const editor = getAppElement("editor");
  assert.deepEqual(numbers(), ["1", "2"]);
  editor.applyEdit({ value: "one\ntwo\nthree", selectionStart: 13, selectionEnd: 13 });
  await app.settle(30);
  assert.deepEqual(numbers(), ["1", "2", "3"]);
  editor.value = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join("\n");
  editor.dispatchEvent(new app.dom.window.Event("input"));
  await app.settle(30);
  assert.deepEqual(numbers(), Array.from({ length: 10 }, (_, index) => String(index + 1)));
  assert.ok(editor.view.scrollDOM.contains(document.querySelector("#editor .cm-gutters")));
  app.click("split-note-btn");
  assert.deepEqual(numbers("secondary-editor"), ["1", "2", "3"]);
  assert.ok(getAppElement("secondary-editor").view.scrollDOM.contains(document.querySelector("#secondary-editor .cm-gutters")));
});

test("line numbers are optional in both panes and toggling keeps text and selection", async () => {
  const app = await bootApp({ instance: 2, storage: { scratchpad_notes: [
    { id: "one", title: "One", content: "one\ntwo", updatedAt: 2 },
    { id: "two", title: "Two", content: "three\nfour", updatedAt: 1 }
  ] } });
  app.click("split-note-btn");
  const editor = getAppElement("editor");
  editor.setSelectionRange(1, 4, "backward");
  assert.equal(document.querySelector(".cm-lineNumbers"), null);
  app.click("line-numbers-toggle");
  assert.deepEqual(numbers(), ["1", "2"]);
  assert.deepEqual(numbers("secondary-editor"), ["1", "2"]);
  assert.equal(editor.value, "one\ntwo");
  assert.deepEqual([editor.selectionStart, editor.selectionEnd, editor.selectionDirection], [1, 4, "backward"]);
  app.click("line-numbers-toggle");
  assert.equal(document.querySelector(".cm-lineNumbers"), null);
});
