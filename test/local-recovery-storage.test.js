// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { createLocalCollectionStorage, parseLocalNotes, parseLocalFolders,
  LOCAL_NOTES_KEY, LOCAL_FOLDERS_KEY, LOCAL_RECOVERY_KEY } from "../src/storage.js";
import { persistNotesAndTrashLocally, emptyTrashLocally } from "../src/trash.js";

const note = { id: "n", title: "Kept", content: "valuable text", updatedAt: 1, folderId: "work" };
const folders = [{ id: "work", name: "Work" }];
function memory(values = {}) {
  const data = new Map(Object.entries(values));
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

test("strict local readers accept empty collections and legacy optional fields", () => {
  assert.deepEqual(parseLocalNotes(null), []);
  assert.deepEqual(parseLocalNotes("[]"), []);
  assert.deepEqual(parseLocalNotes(JSON.stringify([note])), [note]);
  assert.deepEqual(parseLocalFolders(null), []);
  assert.deepEqual(parseLocalFolders("[]"), []);
  assert.deepEqual(parseLocalFolders(JSON.stringify(folders)), folders);
});

test("invalid JSON, collection shapes, records, duplicate IDs, and metadata fail closed", () => {
  for (const raw of ["", "{ truncated", "null", "{}", "false", "[null]", "[1]",
    JSON.stringify([{ ...note, content: null }]), JSON.stringify([{ ...note, title: 1 }]),
    JSON.stringify([{ ...note, id: "" }]), JSON.stringify([{ ...note, updatedAt: "1" }]),
    JSON.stringify([{ ...note, isPinned: "true" }]), JSON.stringify([{ ...note, isTitleLocked: 1 }]),
    JSON.stringify([{ ...note, folderId: {} }]), JSON.stringify([note, note])]) {
    assert.throws(() => parseLocalNotes(raw), undefined, raw);
  }
  for (const raw of ["", "{ truncated", "null", "{}", "[null]", "[1]",
    JSON.stringify([{ id: "f", name: "" }]), JSON.stringify([{ id: " f ", name: "Kept" }]),
    JSON.stringify([{ id: "__pinned__", name: "Kept" }]), JSON.stringify([...folders, ...folders])]) {
    assert.throws(() => parseLocalFolders(raw), undefined, raw);
  }
});

test("one unreadable key locks all collection persistence, including trash purge", () => {
  for (const badKey of [LOCAL_NOTES_KEY, LOCAL_FOLDERS_KEY]) {
    const disk = memory({ [LOCAL_NOTES_KEY]: JSON.stringify([note]), [LOCAL_FOLDERS_KEY]: JSON.stringify(folders),
      scratchpad_trash: "[]", [badKey]: "{ recoverable fragment" });
    const before = new Map(disk.data);
    const local = createLocalCollectionStorage(disk);
    assert.throws(() => local.storage.setItem(LOCAL_NOTES_KEY, "[]"));
    local.load();
    assert.equal(local.blocked(), true);
    assert.equal(persistNotesAndTrashLocally(local.storage, [], []).ok, false);
    assert.equal(emptyTrashLocally(local.storage, [], []).ok, false);
    assert.throws(() => local.storage.setItem(LOCAL_FOLDERS_KEY, "[]"));
    assert.deepEqual(disk.data, before);
    const exported = JSON.parse(local.recoveryData());
    assert.equal(exported.values[badKey], "{ recoverable fragment");
    assert.equal(exported.schemaVersion, 1);
  }
});

test("read failures block replacement and permit a later explicit retry", () => {
  const disk = memory({ [LOCAL_NOTES_KEY]: JSON.stringify([note]) });
  let fail = true;
  const local = createLocalCollectionStorage({ ...disk, getItem: key => {
    if (key === LOCAL_NOTES_KEY && fail) throw new Error("Storage unavailable");
    return disk.getItem(key);
  } });
  assert.doesNotThrow(() => local.load());
  assert.equal(local.blocked(), true);
  assert.deepEqual(JSON.parse(local.recoveryData()).unreadableKeys, [LOCAL_NOTES_KEY]);
  assert.throws(() => local.replaceUnreadable(), /retry reading/);
  fail = false;
  assert.deepEqual(local.load().notes, [note]);
  assert.equal(local.blocked(), false);
  assert.equal(disk.getItem(LOCAL_NOTES_KEY), JSON.stringify([note]));
});

test("replacement archives originals first and preserves readable data and trash", () => {
  const raw = "[{ truncated but valuable";
  const disk = memory({ [LOCAL_NOTES_KEY]: JSON.stringify([note]), [LOCAL_FOLDERS_KEY]: raw,
    scratchpad_trash: "{ original trash", [LOCAL_RECOVERY_KEY]: "previous preserved copy" });
  const local = createLocalCollectionStorage(disk);
  local.load();
  local.replaceUnreadable();
  assert.equal(local.blocked(), false);
  assert.equal(disk.getItem(LOCAL_NOTES_KEY), JSON.stringify([note]));
  assert.equal(disk.getItem(LOCAL_FOLDERS_KEY), "[]");
  assert.equal(disk.getItem("scratchpad_trash"), "{ original trash");
  const archived = JSON.parse(local.recoveryData());
  assert.equal(archived.values[LOCAL_FOLDERS_KEY], raw);
  assert.equal(archived.previousRecovery, "previous preserved copy");
  const next = createLocalCollectionStorage(disk);
  next.load();
  assert.equal(next.hasArchive(), true);
  assert.equal(next.recoveryData(), local.recoveryData());
});

test("archive failures never touch sources; partial replacement remains recoverable", () => {
  for (const failKey of [LOCAL_RECOVERY_KEY, LOCAL_NOTES_KEY, LOCAL_FOLDERS_KEY]) {
    const disk = memory({ [LOCAL_NOTES_KEY]: "{ notes", [LOCAL_FOLDERS_KEY]: "{ folders" });
    const local = createLocalCollectionStorage({ ...disk, setItem: (key, value) => {
      if (key === failKey) throw new Error("Quota exceeded");
      disk.setItem(key, value);
    } });
    local.load();
    assert.throws(() => local.replaceUnreadable(), /Quota/);
    assert.equal(local.blocked(), true);
    if (failKey === LOCAL_RECOVERY_KEY) {
      assert.equal(disk.getItem(LOCAL_NOTES_KEY), "{ notes");
      assert.equal(disk.getItem(LOCAL_FOLDERS_KEY), "{ folders");
    } else {
      const archive = JSON.parse(disk.getItem(LOCAL_RECOVERY_KEY));
      assert.equal(archive.values[LOCAL_NOTES_KEY], "{ notes");
      assert.equal(archive.values[LOCAL_FOLDERS_KEY], "{ folders");
    }
    const next = createLocalCollectionStorage(disk);
    next.load();
    assert.equal(next.blocked(), true);
    next.replaceUnreadable();
    assert.equal(next.blocked(), false);
    assert.ok(next.recoveryData().includes("{ notes"));
  }
});

test("replacement refuses a changed source instead of overwriting newer data", () => {
  const disk = memory({ [LOCAL_NOTES_KEY]: "{ old" });
  const local = createLocalCollectionStorage(disk);
  local.load();
  disk.setItem(LOCAL_NOTES_KEY, JSON.stringify([note]));
  assert.throws(() => local.replaceUnreadable(), /changed/);
  assert.equal(disk.getItem(LOCAL_RECOVERY_KEY), null);
  assert.deepEqual(local.load().notes, [note]);
});
