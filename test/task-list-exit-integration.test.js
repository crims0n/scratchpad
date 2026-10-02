// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { getAppElement, bootApp } from "./helpers/app-harness.js";

function pressEnter(dom, editor) {
  const event = new dom.window.KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true
  });
  editor.dispatchEvent(event);
  return event;
}

test("an inserted task list continues once and exits from its empty task", async () => {
  const { dom } = await bootApp({
    storage: {
      scratchpad_notes: [{
        id: "task-note",
        title: "Tasks",
        content: "",
        updatedAt: 1,
        isTitleLocked: true
      }]
    }
  });
  const editor = getAppElement("editor");

  editor.dispatchEvent(new dom.window.MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true
  }));
  document.getElementById("ctx-insert").click();
  document.querySelector('[data-markdown-template="task-list"]').click();

  assert.equal(editor.value, "- [ ] Task");
  assert.equal(editor.value.slice(editor.selectionStart, editor.selectionEnd), "Task");

  editor.applyEdit({
    value: editor.value.slice(0, editor.selectionStart) + "Buy milk" + editor.value.slice(editor.selectionEnd),
    selectionStart: editor.selectionStart + 8, selectionEnd: editor.selectionStart + 8
  });
  assert.equal(pressEnter(dom, editor).defaultPrevented, true);
  assert.equal(editor.value, "- [ ] Buy milk\n- [ ] ");

  assert.equal(pressEnter(dom, editor).defaultPrevented, true);
  assert.equal(editor.value, "- [ ] Buy milk\n\n");
  assert.equal(editor.selectionStart, editor.value.length - 1);

  editor.applyEdit({
    value: editor.value.slice(0, editor.selectionStart) + "Notes" + editor.value.slice(editor.selectionEnd),
    selectionStart: editor.selectionStart + 5, selectionEnd: editor.selectionStart + 5
  });
  assert.equal(editor.value, "- [ ] Buy milk\nNotes\n");
});
