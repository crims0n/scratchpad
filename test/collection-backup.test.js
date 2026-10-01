// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { parseBackup, serializeBackup, validateCollection, readLocalValues,
  restoreLocalValues, replaceLocalCollection, recoverLocalRestore } from "../src/collection-backup.js";

const note = { id: "n", title: "A 🔐", content: "# Body\nUnicode 🐈", updatedAt: 123,
  isTitleLocked: true, isPinned: true, folderId: "f" };
const collection = { notes: [note, { ...note, id: "b", isPinned: false, folderId: null }],
  folders: [{ id: "empty", name: "Empty" }, { id: "f", name: "Folder" }],
  trash: [{ id: "t", note: { ...note, id: "deleted", folderId: "gone" }, deletedAt: 456, folderName: "Gone" }] };
const empty = { notes: [], folders: [], trash: [] };
const storage = initial => {
  const values = new Map(Object.entries(initial || {}));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
const initial = { scratchpad_notes: JSON.stringify(collection.notes), scratchpad_folders: JSON.stringify(collection.folders),
  scratchpad_trash: JSON.stringify(collection.trash) };
function journal() {
  let pending = null;
  const copies = [];
  return { copies, read: async () => pending, begin: async (values, content) => { pending = values; copies.push(content); },
    complete: async () => { pending = null; } };
}

test("versioned backups round-trip complete, empty, and trash-only collections without preferences", () => {
  for (const value of [collection, empty, { ...empty, trash: collection.trash }]) {
    const content = serializeBackup({ ...value, preferences: { secret: "excluded" } });
    assert.deepEqual(parseBackup(content), value);
    assert.equal(JSON.parse(content).schemaVersion, 1);
    assert.doesNotMatch(content, /secret|preferences/);
  }
});

test("malformed, truncated, unsupported, and invalid collection backups are rejected", () => {
  for (const content of ["{", "null", "[]", "{}", serializeBackup(collection).slice(0, -10),
    serializeBackup(collection).replace('"schemaVersion": 1', '"schemaVersion": 2'),
    serializeBackup(collection).replace("scratchpad-collection-backup", "scratchpad-local-recovery-export")]) {
    assert.throws(() => parseBackup(content));
  }
  const invalid = [
    { ...collection, notes: [...collection.notes, note] },
    { ...collection, folders: [...collection.folders, collection.folders[0]] },
    { ...collection, notes: [{ ...note, folderId: "missing" }] },
    { ...collection, notes: [{ ...note, isPinned: "yes" }] },
    { ...collection, notes: [{ ...note, updatedAt: 1.5 }] },
    { ...collection, trash: [...collection.trash, collection.trash[0]] },
    { ...collection, trash: [{ ...collection.trash[0], note: { ...note, isTitleLocked: 1 } }] },
    { ...collection, trash: [{ ...collection.trash[0], deletedAt: -1 }] },
    { ...collection, trash: [{ ...collection.trash[0], folderName: {} }] },
    { ...collection, folders: [{ id: "__pinned__", name: "Invalid" }] }
  ];
  invalid.forEach(value => assert.throws(() => validateCollection(value)));
});

test("local replacement is verified and retains a restorable safety copy", async () => {
  const disk = storage(initial), checkpoint = journal();
  await replaceLocalCollection(disk, empty, checkpoint, serializeBackup(collection));
  assert.deepEqual(JSON.parse(disk.getItem("scratchpad_notes")), []);
  assert.equal(await checkpoint.read(), null);
  assert.deepEqual(parseBackup(checkpoint.copies[0]), collection);
  await replaceLocalCollection(disk, parseBackup(checkpoint.copies[0]), checkpoint, serializeBackup(empty));
  assert.deepEqual(readLocalValues(disk), initial);
});

test("a failed checkpoint or invalid candidate cannot alter destination values", async () => {
  const disk = storage(initial), checkpoint = journal();
  checkpoint.begin = async () => { throw new Error("disk full"); };
  await assert.rejects(replaceLocalCollection(disk, empty, checkpoint, serializeBackup(collection)), /disk full/);
  assert.deepEqual(readLocalValues(disk), initial);
  await assert.rejects(replaceLocalCollection(disk, {}, checkpoint, serializeBackup(collection)));
  assert.deepEqual(readLocalValues(disk), initial);
});

test("each failed local write rolls back without removing the safety copy", async () => {
  for (let failingWrite = 1; failingWrite <= 3; failingWrite++) {
    const disk = storage(initial), checkpoint = journal();
    const original = disk.setItem;
    let writes = 0;
    disk.setItem = (key, value) => { if (++writes === failingWrite) throw new Error("quota exceeded"); original(key, value); };
    await assert.rejects(replaceLocalCollection(disk, empty, checkpoint, serializeBackup(collection)), /quota/);
    assert.deepEqual(readLocalValues(disk), initial);
    assert.equal(await checkpoint.read(), null);
    assert.equal(checkpoint.copies.length, 1);
  }
});

test("failed rollback retains the checkpoint and a later launch recovers the exact old values", async () => {
  const disk = storage(initial), checkpoint = journal(), original = disk.setItem;
  let writes = 0;
  disk.setItem = (key, value) => { if (++writes >= 2) throw new Error("storage unavailable"); original(key, value); };
  await assert.rejects(replaceLocalCollection(disk, empty, checkpoint, serializeBackup(collection)), /read-only/);
  assert.deepEqual(await checkpoint.read(), initial);
  disk.setItem = original;
  assert.equal(await recoverLocalRestore(disk, checkpoint), true);
  assert.deepEqual(readLocalValues(disk), initial);
  assert.equal(await recoverLocalRestore(disk, checkpoint), false);
});

test("interruption after any write restores absent keys too, and malformed checkpoints write nothing", async () => {
  const before = { scratchpad_notes: null, scratchpad_folders: "[]", scratchpad_trash: null };
  for (let completed = 0; completed <= 3; completed++) {
    const disk = storage({ scratchpad_folders: "[]" }), checkpoint = journal();
    await checkpoint.begin(before, serializeBackup(empty));
    Object.entries(initial).slice(0, completed).forEach(([key, value]) => disk.setItem(key, value));
    await recoverLocalRestore(disk, checkpoint);
    assert.deepEqual(readLocalValues(disk), before);
  }
  const disk = storage(initial);
  assert.throws(() => restoreLocalValues(disk, { scratchpad_notes: "[]", scratchpad_folders: 2, scratchpad_trash: "[]" }));
  assert.deepEqual(readLocalValues(disk), initial);
});

test("failure to finalize retains recoverability without an unjournaled rollback", async () => {
  const disk = storage(initial), checkpoint = journal();
  let attempts = 0;
  const original = checkpoint.complete;
  checkpoint.complete = async () => { if (++attempts === 1) throw new Error("finalize failed"); await original(); };
  await assert.rejects(replaceLocalCollection(disk, empty, checkpoint, serializeBackup(collection)), /finalize failed/);
  assert.equal(disk.getItem("scratchpad_notes"), "[]");
  await recoverLocalRestore(disk, checkpoint);
  assert.deepEqual(readLocalValues(disk), initial);
});

test("finalization failure after marker removal never starts a partial unjournaled rollback", async () => {
  const disk = storage(initial), checkpoint = journal(), original = checkpoint.complete;
  checkpoint.complete = async () => { await original(); throw new Error("directory sync failed"); };
  await assert.rejects(replaceLocalCollection(disk, empty, checkpoint, serializeBackup(collection)), /New collection was written/);
  assert.equal(await recoverLocalRestore(disk, checkpoint), false);
  assert.equal(disk.getItem("scratchpad_notes"), "[]");
  assert.equal(disk.getItem("scratchpad_folders"), "[]");
  assert.equal(disk.getItem("scratchpad_trash"), "[]");
});
