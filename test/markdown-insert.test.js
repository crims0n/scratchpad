// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { getMarkdownTemplateEdit } from "../src/markdown-insert.js";
import { bootApp } from "./helpers/app-harness.js";

test("block templates are placed on their own source lines", () => {
  const edit = getMarkdownTemplateEdit("beforeafter", 6, 6, "table");

  assert.match(edit.value, /^before\n\| Column 1 \| Column 2 \| Column 3 \|/);
  assert.match(edit.value, /\| Cell \| Cell \| Cell \|\nafter$/);
  assert.equal(edit.value.slice(edit.selectionStart, edit.selectionEnd), "Column 1");
});

test("templates select their first useful placeholder", () => {
  const expectations = new Map([
    ["task-list", "Task"],
    ["code-block", "language"],
    ["link", "link text"],
    ["reference-link", "link text"]
  ]);

  for (const [template, placeholder] of expectations) {
    const edit = getMarkdownTemplateEdit("", 0, 0, template);
    assert.equal(edit.value.slice(edit.selectionStart, edit.selectionEnd), placeholder);
  }
  assert.equal(getMarkdownTemplateEdit("", 0, 0, "unsupported"), null);
});

test("the editor context menu inserts a table through the normal input path", async () => {
  const app = await bootApp({
    storage: {
      scratchpad_notes: [{
        id: "insert-note",
        title: "Insert note",
        content: "Intro",
        updatedAt: 1,
        isTitleLocked: true
      }]
    }
  });

  const editor = document.getElementById("editor-textarea");
  editor.setSelectionRange(editor.value.length, editor.value.length);
  editor.dispatchEvent(new app.dom.window.MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 20,
    clientY: 20
  }));

  const contextMenu = document.getElementById("custom-context-menu");
  const insertGroup = document.getElementById("ctx-insert-group");
  assert.equal(contextMenu.style.display, "flex");
  assert.equal(insertGroup.style.display, "block");

  document.getElementById("ctx-insert").click();
  document.querySelector('[data-markdown-template="table"]').click();

  assert.equal(contextMenu.style.display, "none");
  assert.match(editor.value, /^Intro\n\| Column 1 \| Column 2 \| Column 3 \|/);
  assert.equal(editor.value.slice(editor.selectionStart, editor.selectionEnd), "Column 1");
  assert.equal(document.activeElement, editor);

  const title = document.getElementById("note-title");
  title.dispatchEvent(new app.dom.window.MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true
  }));
  assert.equal(insertGroup.style.display, "none", "Insert only appears for Markdown editors");
});
