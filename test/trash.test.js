// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { LOCAL_TRASH_KEY, persistNotesAndTrashLocally, readTrash, restoredNote, trashSummary, emptyTrashLocally } from "../src/trash.js";
import { LOCAL_NOTES_KEY } from "../src/storage.js";

const note = { id: "n", title: "Keep me", content: "Full content 📝", updatedAt: 1, isTitleLocked: true, isPinned: true, folderId: "work" };
const entry = { id: "t", note, deletedAt: 2, folderName: "Work" };
function storage(notes, trash, failAt = Infinity) {
  const values = new Map([[LOCAL_NOTES_KEY, JSON.stringify(notes)], [LOCAL_TRASH_KEY, JSON.stringify(trash)]]);
  let count = 0;
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => {
    if (++count === failAt) throw new Error("Quota exceeded");
    values.set(key, value);
  } };
}

test("local deletion and restoration never lose both copies if any storage write fails", () => {
  for (const restoring of [false, true]) {
    for (const failAt of [1, 2, 3, Infinity]) {
      const store = storage(restoring ? [] : [note], restoring ? [entry] : [], failAt);
      const result = persistNotesAndTrashLocally(store, restoring ? [note] : [], restoring ? [] : [entry]);
      const active = JSON.parse(store.getItem(LOCAL_NOTES_KEY));
      const trash = readTrash(store.getItem(LOCAL_TRASH_KEY));
      assert.ok(active.some(n => n.content === note.content) || trash.some(e => e.note.content === note.content));
      assert.equal(result.ok, failAt === Infinity);
    }
  }
});

test("restore preserves metadata, falls back to top level, and refuses to overwrite a live ID", () => {
  const restored = restoredNote(entry, [], [{ id: "work", name: "Renamed work" }]);
  assert.deepEqual({ ...restored, updatedAt: note.updatedAt }, note);
  assert.ok(restored.updatedAt > note.updatedAt, "restoration invalidates old note revisions");
  assert.equal(restoredNote(entry, [], []).folderId, null);
  assert.throws(() => restoredNote(entry, [note], []), /already exists/);
  assert.equal(Object.hasOwn(trashSummary(entry), "content"), false);
  assert.equal(Object.hasOwn(trashSummary(entry), "note"), false);
});

test("corrupt trash is preserved and cannot be silently overwritten", () => {
  for (const raw of ["broken", "{}", '[{"id":"bad"}]']) {
    const store = storage([note], []);
    store.setItem(LOCAL_TRASH_KEY, raw);
    assert.throws(() => readTrash(raw));
    assert.equal(persistNotesAndTrashLocally(store, [], []).ok, false);
    assert.equal(store.getItem(LOCAL_TRASH_KEY), raw);
    assert.deepEqual(JSON.parse(store.getItem(LOCAL_NOTES_KEY)), [note]);
  }
});

test("confirmed emptying can free local storage after a quota failure", () => {
  const store = storage([note], [entry]);
  const setItem = store.setItem;
  store.setItem = (key, value) => {
    if (key === LOCAL_TRASH_KEY && value !== "[]") throw new Error("Quota exceeded");
    setItem(key, value);
  };
  assert.equal(persistNotesAndTrashLocally(store, [], [entry]).ok, false);
  assert.equal(emptyTrashLocally(store, [], []).ok, true);
  assert.deepEqual(readTrash(store.getItem(LOCAL_TRASH_KEY)), []);
  assert.deepEqual(JSON.parse(store.getItem(LOCAL_NOTES_KEY)), []);
});
