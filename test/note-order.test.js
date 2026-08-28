// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import {
  canMoveNote,
  insertNoteBelowPinned,
  normalizePinnedNoteOrder,
  setNotePinned
} from "../src/note-order.js";

const note = (id, isPinned = false) => ({ id, isPinned });
const ids = notes => notes.map(({ id }) => id);

test("pinned notes are normalized to the top without losing group order", () => {
  const ordered = normalizePinnedNoteOrder([
    note("one"),
    note("two", true),
    note("three"),
    note("four", true)
  ]);

  assert.deepEqual(ids(ordered), ["two", "four", "one", "three"]);
});

test("pinning moves a note to the top and unpinning moves it below pinned notes", () => {
  const pinned = setNotePinned([note("one"), note("two"), note("three")], "two", true);
  assert.deepEqual(ids(pinned), ["two", "one", "three"]);
  assert.equal(pinned[0].isPinned, true);

  const alsoPinned = setNotePinned(pinned, "three", true);
  const unpinned = setNotePinned(alsoPinned, "three", false);
  assert.deepEqual(ids(unpinned), ["two", "three", "one"]);
  assert.equal(unpinned[1].isPinned, false);
});

test("new notes and manual moves stay on their side of the pin boundary", () => {
  const notes = [note("pinned", true), note("one"), note("two")];
  assert.deepEqual(ids(insertNoteBelowPinned(notes, note("new"))), ["pinned", "new", "one", "two"]);
  assert.equal(canMoveNote(notes, 0, 1), false);
  assert.equal(canMoveNote(notes, 1, -1), false);
  assert.equal(canMoveNote(notes, 1, 1), true);
});
