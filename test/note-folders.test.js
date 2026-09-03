// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

const FOLDERS = [
  { id: "work", name: "Work" },
  { id: "personal", name: "Personal" }
];

const NOTES = [
  { id: "pinned", title: "Pinned", content: "Important", updatedAt: 4, isTitleLocked: true, isPinned: true, folderId: "work" },
  { id: "work-note", title: "Work note", content: "Work body", updatedAt: 3, isTitleLocked: true, folderId: "work" },
  { id: "personal-note", title: "Personal note", content: "Personal body", updatedAt: 2, isTitleLocked: true, folderId: "personal" },
  { id: "loose", title: "Loose note", content: "Loose body", updatedAt: 1, isTitleLocked: true }
];

const app = await bootApp({
  storage: {
    scratchpad_notes: NOTES,
    scratchpad_folders: FOLDERS
  }
});

const sectionNames = () => [...document.querySelectorAll(".note-folder-name")]
  .map((element) => element.textContent);
const section = (id) => document.querySelector(`.note-folder-section[data-section-id="${id}"]`);
const topLevelNote = (id) => document.querySelector(`#note-list > .note-item[data-id="${id}"]`);
const contextMenu = (element) => element.dispatchEvent(new app.dom.window.MouseEvent(
  "contextmenu",
  { bubbles: true, cancelable: true }
));

test("pinned notes stay at the top level above folders", () => {
  assert.deepEqual(sectionNames(), ["Work", "Personal"]);
  assert.equal(document.querySelectorAll('.note-item[data-id="pinned"]').length, 1);
  assert.equal(topLevelNote("pinned").dataset.id, "pinned");
  assert.equal(document.getElementById("note-list").firstElementChild.dataset.id, "pinned");
  assert.equal(topLevelNote("pinned").nextElementSibling.className, "pinned-notes-divider");
  assert.equal(document.querySelectorAll(".pinned-notes-divider").length, 1);
  assert.equal(section("work").querySelector(".note-item").dataset.id, "work-note");
  assert.equal(section("personal").nextElementSibling.className, "top-level-notes-divider");
  assert.equal(document.querySelector(".top-level-notes-divider").nextElementSibling.dataset.id, "loose");
  assert.equal(topLevelNote("loose").dataset.id, "loose");
  assert.equal(document.getElementById("note-list").lastElementChild.dataset.id, "loose");
});

test("unpinning returns a note to its underlying folder", () => {
  document.querySelector('.note-item[data-id="pinned"] .note-item-pin').click();
  assert.ok(section("work").querySelector('.note-item[data-id="pinned"]'));
  assert.equal(document.querySelector(".pinned-notes-divider"), null);
  document.querySelector('.note-item[data-id="pinned"] .note-item-pin').click();
  assert.ok(topLevelNote("pinned"));
  assert.equal(document.getElementById("note-list").firstElementChild.dataset.id, "pinned");
  assert.ok(document.querySelector(".pinned-notes-divider"));
});

test("creating from a pinned note creates at the top level", () => {
  document.querySelector('.note-item[data-id="pinned"]').click();
  document.getElementById("new-note-btn").click();

  const createdNote = app.read("scratchpad_notes").find(({ id }) => id.startsWith("note_"));
  assert.equal(createdNote.folderId, null);
  assert.ok(topLevelNote(createdNote.id));
});

test("the split-view selector also leaves folderless notes at the top level", () => {
  document.getElementById("split-note-btn").click();
  const select = document.getElementById("secondary-note-select");
  assert.deepEqual([...select.querySelectorAll("optgroup")].map(({ label }) => label), [
    "Work",
    "Personal"
  ]);
  assert.equal(select.querySelector('option[value="pinned"]').parentElement, select);
  assert.equal(select.firstElementChild.value, "pinned");
  assert.equal(select.querySelector('option[value="loose"]').parentElement, select);
  assert.equal(select.lastElementChild.value, "loose");
  document.getElementById("close-secondary-btn").click();
});

test("collapsed folders reopen temporarily for sidebar search", () => {
  const toggle = section("work").querySelector(".note-folder-toggle");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  toggle.focus();
  toggle.click();
  assert.equal(section("work").classList.contains("collapsed"), true);
  const collapsedToggle = section("work").querySelector(".note-folder-toggle");
  assert.equal(collapsedToggle.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, collapsedToggle);

  const search = document.getElementById("search-input");
  search.value = "Work body";
  search.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
  assert.deepEqual(sectionNames(), ["Work"]);
  assert.equal(section("work").classList.contains("collapsed"), false);
  assert.equal(document.querySelector(".top-level-notes-divider"), null);

  search.value = "";
  search.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
  assert.equal(section("work").classList.contains("collapsed"), true);
});

test("the note context menu moves notes between folders", () => {
  contextMenu(document.querySelector('.note-item[data-id="work-note"]'));
  document.getElementById("ctx-move-folder").click();
  document.querySelector('#ctx-move-folder-menu [data-folder-id="personal"]').click();

  const saved = app.read("scratchpad_notes");
  assert.equal(saved.find(({ id }) => id === "work-note").folderId, "personal");
  assert.ok(section("personal").querySelector('.note-item[data-id="work-note"]'));
});

test("folders can be created, renamed, used for new notes, and safely deleted", () => {
  document.getElementById("new-folder-btn").click();
  let input = document.querySelector(".note-folder-input");
  input.value = "Projects";
  input.dispatchEvent(new app.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

  const project = app.read("scratchpad_folders").find(({ name }) => name === "Projects");
  assert.ok(project);

  contextMenu(section(project.id).querySelector(".note-folder-header"));
  document.getElementById("ctx-folder-new-note").click();
  let createdNote = app.read("scratchpad_notes").find(({ id }) => id.startsWith("note_"));
  assert.equal(createdNote.folderId, project.id);

  contextMenu(section(project.id).querySelector(".note-folder-header"));
  document.getElementById("ctx-folder-rename").click();
  input = document.querySelector(".note-folder-input");
  input.value = "Projects Archive";
  input.dispatchEvent(new app.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(app.read("scratchpad_folders").find(({ id }) => id === project.id).name, "Projects Archive");

  document.getElementById("split-note-btn").click();
  assert.ok([...document.querySelectorAll("#secondary-note-select optgroup")]
    .some(({ label }) => label === "Projects Archive"));
  document.getElementById("close-secondary-btn").click();

  contextMenu(section(project.id).querySelector(".note-folder-header"));
  document.getElementById("ctx-folder-delete").click();
  assert.equal(app.read("scratchpad_folders").some(({ id }) => id === project.id), false);
  createdNote = app.read("scratchpad_notes").find(({ id }) => id === createdNote.id);
  assert.equal(createdNote.folderId, null);
  assert.ok(topLevelNote(createdNote.id));
});

test("creating a note clears an active sidebar search so the new note remains visible", () => {
  const search = document.getElementById("search-input");
  search.value = "no existing note matches this";
  search.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
  assert.equal(document.querySelectorAll(".note-item").length, 0);

  document.getElementById("new-note-btn").click();
  assert.equal(search.value, "");
  assert.ok(document.querySelector(".note-item.active"));
});
