// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { bootApp } from "./helpers/app-harness.js";

function pressKey(dom, editor, key) {
  const event = new dom.window.KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true
  });
  editor.dispatchEvent(event);
  return event;
}

test("an empty generated table row can be exited with Enter or Backspace", async () => {
  const { dom, type } = await bootApp();
  const editor = document.getElementById("editor-textarea");
  const populated = "| A | B |\n| --- | --- |\n| 1 | 2 |";

  await type(populated);
  editor.setSelectionRange(editor.value.length, editor.value.length);
  assert.equal(pressKey(dom, editor, "Enter").defaultPrevented, true);
  assert.equal(editor.value, `${populated}\n|  |  |`);

  assert.equal(pressKey(dom, editor, "Enter").defaultPrevented, true);
  assert.equal(editor.value, `${populated}\n\n`);
  assert.equal(editor.selectionStart, editor.value.length - 1);

  await type(`${populated}\n|  |  |`);
  editor.setSelectionRange(populated.length + 3, populated.length + 3);
  assert.equal(pressKey(dom, editor, "Backspace").defaultPrevented, true);
  assert.equal(editor.value, `${populated}\n\n`);
  assert.equal(editor.selectionStart, editor.value.length - 1);
});
