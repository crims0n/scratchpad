// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCAL_NOTES_BACKUP_KEY,
  LOCAL_NOTES_KEY,
  persistNotesLocally,
  readStoredNotes
} from "../src/storage.js";

test("local persistence serializes the complete note collection", () => {
  const writes = new Map();
  const storage = {
    setItem(key, value) {
      writes.set(key, value);
    }
  };
  const notes = [{ id: "note-1", title: "One", content: "Hello" }];

  const result = persistNotesLocally(storage, notes);

  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(writes.get("scratchpad_notes")), notes);
});

test("local persistence reports quota failures without throwing", () => {
  const quotaError = new Error("Quota exceeded");
  const storage = {
    setItem() {
      throw quotaError;
    }
  };

  const result = persistNotesLocally(storage, []);

  assert.equal(result.ok, false);
  assert.equal(result.error, quotaError);
});

test("the legacy set-aside key is distinct from the local collection", () => {
  assert.notEqual(LOCAL_NOTES_BACKUP_KEY, LOCAL_NOTES_KEY);
});

test("stored notes are read back when the collection has content", () => {
  const notes = [{ id: "note-1", title: "One", content: "Hello" }];

  assert.deepEqual(readStoredNotes(JSON.stringify(notes)), notes);
});

test("nothing worth preserving reads back as null", () => {
  assert.equal(readStoredNotes(null), null, "missing value");
  assert.equal(readStoredNotes(""), null, "empty value");
  assert.equal(readStoredNotes("[]"), null, "empty collection");
  assert.equal(readStoredNotes("{\"id\":\"note-1\"}"), null, "not a collection");
  assert.equal(readStoredNotes("{ truncated"), null, "unparsable value");
});
