// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { bootApp } from "./helpers/app-harness.js";

test("list autocomplete edits the textarea and follows the normal input path", async () => {
  const { dom, type } = await bootApp();
  const editor = document.getElementById("editor-textarea");
  await type("- first");
  editor.setSelectionRange(editor.value.length, editor.value.length);

  const event = new dom.window.KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true
  });
  editor.dispatchEvent(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(editor.value, "- first\n- ");
  assert.equal(editor.selectionStart, 10);
  assert.equal(document.getElementById("save-status").textContent, "Saving...");
});
