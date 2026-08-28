// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { applyEditorEdit } from "../src/editor-edit.js";

test("editor changes use one native insertText transaction when available", () => {
  const dom = new JSDOM("<textarea>one</textarea>");
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const textarea = document.querySelector("textarea");
  let commands = 0;

  document.execCommand = (command, _showUi, text) => {
    assert.equal(command, "insertText");
    commands += 1;
    textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd);
    return true;
  };

  applyEditorEdit(textarea, {
    value: "one\n- ",
    selectionStart: 6,
    selectionEnd: 6
  });

  assert.equal(commands, 1);
  assert.equal(textarea.value, "one\n- ");
  assert.equal(textarea.selectionStart, 6);
});
