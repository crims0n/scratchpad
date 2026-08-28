// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { bootApp } from "./helpers/app-harness.js";

test("smart editing uses the normal editor input path", async () => {
  const { dom, type } = await bootApp();
  const editor = document.getElementById("editor-textarea");
  await type("");
  editor.setSelectionRange(0, 0);

  const pairEvent = new dom.window.KeyboardEvent("keydown", {
    key: "(",
    bubbles: true,
    cancelable: true
  });
  editor.dispatchEvent(pairEvent);

  assert.equal(pairEvent.defaultPrevented, true);
  assert.equal(editor.value, "()");
  assert.equal(editor.selectionStart, 1);
  assert.equal(document.getElementById("save-status").textContent, "Saving...");

  await type("OpenAI");
  editor.setSelectionRange(0, 6);
  const pasteEvent = new dom.window.Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(pasteEvent, "clipboardData", {
    value: { getData: () => "https://openai.com" }
  });
  editor.dispatchEvent(pasteEvent);

  assert.equal(pasteEvent.defaultPrevented, true);
  assert.equal(editor.value, "[OpenAI](https://openai.com)");
});
