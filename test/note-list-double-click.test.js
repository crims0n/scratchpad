// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

const FOLDERS = [{ id: "work", name: "Work" }];

const NOTES = [
  { id: "work-note", title: "Work note", content: "Work body", updatedAt: 2, isTitleLocked: true, folderId: "work" },
  { id: "loose", title: "Loose note", content: "Loose body", updatedAt: 1, isTitleLocked: true }
];

const app = await bootApp({
  storage: {
    scratchpad_notes: NOTES,
    scratchpad_folders: FOLDERS
  }
});

const doubleClick = (element) => element.dispatchEvent(new app.dom.window.MouseEvent(
  "dblclick",
  { bubbles: true, cancelable: true }
));
const noteCount = () => document.querySelectorAll(".note-item").length;

test("double-clicking the empty space below the list creates a scratchpad", () => {
  assert.equal(noteCount(), 2);

  doubleClick(document.getElementById("note-list-container"));

  assert.equal(noteCount(), 3);
  const created = app.read("scratchpad_notes").find(note => note.title === "Untitled Scratchpad");
  assert.ok(created, "a blank scratchpad was stored");
  assert.equal(document.querySelector(".note-item.active").dataset.id, created.id);
  assert.equal(document.getElementById("note-title").value, "Untitled Scratchpad");
  assert.equal(document.getElementById("editor-textarea").value, "");
});

test("gaps between rows count as empty space", () => {
  const before = noteCount();
  doubleClick(document.getElementById("note-list"));
  assert.equal(noteCount(), before + 1);
});

// The gesture rides on the list container, so anything inside it that owns its
// own double-click has to be left alone -- otherwise selecting a word of a
// folder name, or double-clicking a note to open it, also spawns a scratchpad.
test("double-clicking a note, a folder header or its input creates nothing", () => {
  const before = noteCount();

  doubleClick(document.querySelector('.note-item[data-id="loose"]'));
  doubleClick(document.querySelector('.note-item[data-id="loose"] .note-item-title'));
  doubleClick(document.querySelector(".note-folder-header"));
  doubleClick(document.querySelector(".note-folder-notes"));

  document.getElementById("new-folder-btn").click();
  const folderInput = document.querySelector(".note-folder-input");
  assert.ok(folderInput, "the folder name editor is open");
  doubleClick(folderInput);

  assert.equal(noteCount(), before, "no scratchpad was created");
});
