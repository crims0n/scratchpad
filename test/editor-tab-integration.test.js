// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { bootApp } from "./helpers/app-harness.js";

test("Tab edits the primary textarea and follows the normal input path", async () => {
  const { dom, type } = await bootApp();
  const editor = document.getElementById("editor-textarea");
  await type("alphaomega");
  editor.setSelectionRange(5, 5);

  const event = new dom.window.KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
    cancelable: true
  });
  editor.dispatchEvent(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(editor.value, "alpha\tomega");
  assert.equal(editor.selectionStart, 6);
  assert.equal(document.getElementById("save-status").textContent, "Saving...");

  await type("- parent\n- child");
  editor.setSelectionRange(11, 11);
  const listEvent = new dom.window.KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
    cancelable: true
  });
  editor.dispatchEvent(listEvent);

  assert.equal(listEvent.defaultPrevented, true);
  assert.equal(editor.value, "- parent\n\t- child");
  assert.equal(editor.selectionStart, 12);
});
