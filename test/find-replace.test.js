// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { getAppElement, bootApp } from "./helpers/app-harness.js";

const ORIGINAL_CONTENT = "İstanbul trip. Book a hotel, then book a flight.";

test("Replace and Replace All preserve offsets and use one undoable editor transaction", async () => {
  const app = await bootApp({
    storage: {
      scratchpad_notes: [{
        id: "note-one",
        title: "Travel",
        content: ORIGINAL_CONTENT,
        updatedAt: 1,
        isTitleLocked: true
      }]
    },
    handlers: { load_workspace_preference: () => null }
  });
  const { document, Event, KeyboardEvent } = app.dom.window;
  const editor = getAppElement("editor");
  const transactions = [];

  const applyEdit = editor.applyEdit.bind(editor);
  editor.applyEdit = edit => {
    transactions.push({ previousValue: editor.value });
    applyEdit(edit);
  };

  document.dispatchEvent(new KeyboardEvent("keydown", {
    key: "f",
    ctrlKey: true,
    bubbles: true
  }));
  document.getElementById("find-toggle-replace").click();

  const findInput = document.getElementById("find-input");
  const replaceInput = document.getElementById("replace-input");
  findInput.value = "book";
  findInput.dispatchEvent(new Event("input", { bubbles: true }));
  replaceInput.value = "reserve";
  replaceInput.focus();

  document.getElementById("replace-one-btn").click();

  assert.equal(transactions.length, 1);
  assert.equal(document.activeElement, replaceInput);
  assert.equal(
    editor.value,
    "İstanbul trip. reserve a hotel, then book a flight."
  );
  assert.equal(editor.value.slice(editor.selectionStart, editor.selectionEnd), "book");

  // Restore the two-match fixture so Replace All proves that separated edits
  // are still grouped into one undo transaction.
  editor.value = ORIGINAL_CONTENT;
  editor.dispatchEvent(new Event("input", { bubbles: true }));

  const replaceAllButton = document.getElementById("replace-all-btn");
  replaceAllButton.focus();
  replaceAllButton.click();

  assert.equal(transactions.length, 2);
  assert.equal(document.activeElement, replaceAllButton);
  assert.equal(transactions[1].previousValue, ORIGINAL_CONTENT);
  assert.equal(
    editor.value,
    "İstanbul trip. reserve a hotel, then reserve a flight."
  );
  assert.equal(document.getElementById("find-count").textContent, "0 of 0");
  assert.equal(editor.undo(), true);
  assert.equal(editor.value, ORIGINAL_CONTENT);
  assert.equal(editor.redo(), true);
  assert.equal(editor.value, "İstanbul trip. reserve a hotel, then reserve a flight.");

  await app.settle(600);
  assert.equal(
    app.read("scratchpad_notes")[0].content,
    "İstanbul trip. reserve a hotel, then reserve a flight."
  );
});
