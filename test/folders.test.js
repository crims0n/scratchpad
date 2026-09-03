// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import {
  PINNED_SECTION_ID,
  UNFILED_SECTION_ID,
  isFolderNameAvailable,
  isReservedFolderName,
  moveFolder,
  normalizeFolderName,
  normalizeFolders,
  normalizeNoteFolderAssignments,
  noteSectionId,
  removeFolder
} from "../src/folders.js";

test("folders preserve valid records while rejecting duplicate or reserved identities", () => {
  assert.deepEqual(normalizeFolders([
    { id: "one", name: " Work " },
    { id: "two", name: "work" },
    { id: "one", name: "Another" },
    { id: PINNED_SECTION_ID, name: "Reserved" },
    { id: "three", name: "Personal", extra: true },
    null
  ]), [
    { id: "one", name: "Work" },
    { id: "two", name: "work" },
    { id: "three", name: "Personal" }
  ]);
});

test("folder names are compacted and compared case-insensitively", () => {
  const folders = [{ id: "one", name: "Project Notes" }];
  assert.equal(normalizeFolderName("  Project   Notes  "), "Project Notes");
  assert.equal(isFolderNameAvailable(folders, "project notes"), false);
  assert.equal(isFolderNameAvailable(folders, "project notes", "one"), true);
  assert.equal(isFolderNameAvailable(folders, ""), false);
  assert.equal(isReservedFolderName(" pinned "), true);
  assert.equal(isFolderNameAvailable(folders, "Top Level"), false);
});

test("notes resolve to pinned, folder, or unfiled sections", () => {
  const folders = [{ id: "work", name: "Work" }];
  assert.equal(noteSectionId({ isPinned: true, folderId: "work" }, folders), PINNED_SECTION_ID);
  assert.equal(noteSectionId({ folderId: "work" }, folders), "work");
  assert.equal(noteSectionId({ folderId: "missing" }, folders), UNFILED_SECTION_ID);
  assert.equal(normalizeNoteFolderAssignments([{ id: "orphan", folderId: "missing" }], folders)[0].folderId, null);
  assert.equal(normalizeNoteFolderAssignments([{ id: "invalid", folderId: 42 }], folders)[0].folderId, null);
});

test("folders reorder independently and deletion safely unfiles their notes", () => {
  const folders = [{ id: "one", name: "One" }, { id: "two", name: "Two" }];
  assert.deepEqual(moveFolder(folders, "two", -1).map(({ id }) => id), ["two", "one"]);

  const result = removeFolder(folders, [
    { id: "a", folderId: "one" },
    { id: "b", folderId: "two", isPinned: true }
  ], "two");
  assert.deepEqual(result.folders.map(({ id }) => id), ["one"]);
  assert.equal(result.notes[0].folderId, "one");
  assert.equal(result.notes[1].folderId, null);
  assert.equal(result.notes[1].isPinned, true);
});
