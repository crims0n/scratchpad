// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createLocalCollectionStorage, parseLocalNotes, parseLocalFolders,
  LOCAL_NOTES_KEY, LOCAL_FOLDERS_KEY, LOCAL_RECOVERY_KEY } from "../src/storage.js";
import { persistNotesAndTrashLocally, emptyTrashLocally } from "../src/trash.js";

const note = { id: "n", title: "Kept", content: "valuable text", updatedAt: 1, folderId: "work" };
const folders = [{ id: "work", name: "Work" }];
function memory(values = {}) {
  const data = new Map(Object.entries(values));
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key) };
}

function nativeArchive() {
  const copies = [];
  return { copies, saveCopy: async content => { copies.push(content); return "/tmp/recovery.json"; },
    hasCopies: async () => copies.length > 0, readCopies: async () => [...copies] };
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

test("one unreadable key locks all collection persistence, including trash purge", async () => {
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
    const exported = JSON.parse(await local.recoveryData());
    assert.equal(exported.current.values[badKey], "{ recoverable fragment");
    assert.equal(exported.schemaVersion, 2);
  }
});

test("read failures block replacement and permit a later explicit retry", async () => {
  const disk = memory({ [LOCAL_NOTES_KEY]: JSON.stringify([note]) });
  let fail = true;
  const local = createLocalCollectionStorage({ ...disk, getItem: key => {
    if (key === LOCAL_NOTES_KEY && fail) throw new Error("Storage unavailable");
    return disk.getItem(key);
  } });
  assert.doesNotThrow(() => local.load());
  assert.equal(local.blocked(), true);
  assert.deepEqual(JSON.parse(await local.recoveryData()).current.unreadableKeys, [LOCAL_NOTES_KEY]);
  await assert.rejects(local.replaceUnreadable(), /retry reading/);
  fail = false;
  assert.deepEqual(local.load().notes, [note]);
  assert.equal(local.blocked(), false);
  assert.equal(disk.getItem(LOCAL_NOTES_KEY), JSON.stringify([note]));
});

test("replacement archives originals first and preserves readable data and trash", async () => {
  const raw = "[{ truncated but valuable";
  const disk = memory({ [LOCAL_NOTES_KEY]: JSON.stringify([note]), [LOCAL_FOLDERS_KEY]: raw,
    scratchpad_trash: "{ original trash", [LOCAL_RECOVERY_KEY]: "previous preserved copy" });
  const archive = nativeArchive();
  const local = createLocalCollectionStorage(disk, archive);
  local.load();
  await local.replaceUnreadable();
  assert.equal(local.blocked(), false);
  assert.equal(disk.getItem(LOCAL_NOTES_KEY), JSON.stringify([note]));
  assert.equal(disk.getItem(LOCAL_FOLDERS_KEY), "[]");
  assert.equal(disk.getItem("scratchpad_trash"), "{ original trash");
  const archived = JSON.parse(archive.copies[0]);
  assert.equal(archived.values[LOCAL_FOLDERS_KEY], raw);
  assert.equal(archived.legacyRecovery, "previous preserved copy");
  assert.equal(disk.getItem(LOCAL_RECOVERY_KEY), null);
  const next = createLocalCollectionStorage(disk, archive);
  next.load();
  await next.refreshArchives();
  assert.equal(next.hasArchive(), true);
  assert.equal(await next.recoveryData(), await local.recoveryData());
});

test("archive failures never touch sources; partial replacement remains recoverable", async () => {
  for (const failKey of ["archive", LOCAL_NOTES_KEY, LOCAL_FOLDERS_KEY]) {
    const disk = memory({ [LOCAL_NOTES_KEY]: "{ notes", [LOCAL_FOLDERS_KEY]: "{ folders" });
    const archive = nativeArchive();
    const local = createLocalCollectionStorage({ ...disk, setItem: (key, value) => {
      if (key === failKey) throw new Error("Quota exceeded");
      disk.setItem(key, value);
    } }, failKey === "archive" ? { ...archive, saveCopy: async () => { throw new Error("Quota exceeded"); } } : archive);
    local.load();
    await assert.rejects(local.replaceUnreadable(), /Quota/);
    assert.equal(local.blocked(), true);
    if (failKey === "archive") {
      assert.equal(disk.getItem(LOCAL_NOTES_KEY), "{ notes");
      assert.equal(disk.getItem(LOCAL_FOLDERS_KEY), "{ folders");
    } else {
      const copy = JSON.parse(archive.copies[0]);
      assert.equal(copy.values[LOCAL_NOTES_KEY], "{ notes");
      assert.equal(copy.values[LOCAL_FOLDERS_KEY], "{ folders");
    }
    const next = createLocalCollectionStorage(disk, archive);
    next.load();
    assert.equal(next.blocked(), true);
    await next.replaceUnreadable();
    assert.equal(next.blocked(), false);
    assert.ok((await next.recoveryData()).includes("{ notes"));
  }
});

test("replacement refuses a changed source instead of overwriting newer data", async () => {
  const disk = memory({ [LOCAL_NOTES_KEY]: "{ old" });
  const local = createLocalCollectionStorage(disk, nativeArchive());
  local.load();
  disk.setItem(LOCAL_NOTES_KEY, JSON.stringify([note]));
  await assert.rejects(local.replaceUnreadable(), /changed/);
  assert.equal(disk.getItem(LOCAL_RECOVERY_KEY), null);
  assert.deepEqual(local.load().notes, [note]);
});

test("quota-bound sources recover without storing archives or pointers in localStorage", async () => {
  const dom = new JSDOM("", { url: "https://scratchpad.test", storageQuota: 5000000 });
  const disk = dom.window.localStorage;
  const raw = '{"content":"' + '"'.repeat(2200000);
  disk.setItem(LOCAL_NOTES_KEY, raw);
  const archive = nativeArchive();
  const local = createLocalCollectionStorage(disk, archive);
  local.load();
  const copy = JSON.stringify(JSON.parse(await local.recoveryData()).current, null, 2);
  assert.throws(() => disk.setItem(LOCAL_RECOVERY_KEY, copy), /quota/i,
    "the same-storage archive cannot fit alongside its original");
  await local.replaceUnreadable();
  assert.equal(local.blocked(), false);
  assert.equal(disk.getItem(LOCAL_NOTES_KEY), "[]");
  assert.equal(disk.getItem(LOCAL_RECOVERY_KEY), null);
  assert.equal(JSON.parse(archive.copies[0]).values[LOCAL_NOTES_KEY], raw);
  const first = archive.copies[0];
  disk.setItem(LOCAL_NOTES_KEY, raw);
  local.load();
  await local.replaceUnreadable();
  assert.equal(archive.copies[0], first);
  assert.equal(archive.copies[1].length, first.length, "new files never embed prior native copies");
  const next = createLocalCollectionStorage(disk, archive);
  next.load();
  await next.refreshArchives();
  assert.equal(next.hasArchive(), true);
  assert.deepEqual(JSON.parse(await next.recoveryData()).preservedCopies, archive.copies);
  dom.window.close();
});

test("replacement rechecks source and collection context after asynchronous archiving", async () => {
  for (const changeContext of [false, true]) {
    const disk = memory({ [LOCAL_NOTES_KEY]: "{ original" });
    const archive = nativeArchive();
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const local = createLocalCollectionStorage(disk, { ...archive, saveCopy: async content => {
      await pending;
      return archive.saveCopy(content);
    } });
    local.load();
    let changed = false;
    const replacing = local.replaceUnreadable(() => { if (changed) throw new Error("Collection changed"); });
    if (changeContext) changed = true;
    else disk.setItem(LOCAL_NOTES_KEY, JSON.stringify([note]));
    release();
    await assert.rejects(replacing, /changed/);
    assert.equal(disk.getItem(LOCAL_NOTES_KEY), changeContext ? "{ original" : JSON.stringify([note]));
    assert.equal(JSON.parse(archive.copies[0]).values[LOCAL_NOTES_KEY], "{ original");
  }
});

test("browser-only recovery permits export but refuses unprotected replacement", async () => {
  const disk = memory({ [LOCAL_NOTES_KEY]: "{ original" });
  const local = createLocalCollectionStorage(disk);
  local.load();
  assert.equal(local.canReplace(), false);
  await assert.rejects(local.replaceUnreadable(), /desktop app/);
  assert.equal(JSON.parse(await local.recoveryData()).current.values[LOCAL_NOTES_KEY], "{ original");
  assert.equal(disk.getItem(LOCAL_NOTES_KEY), "{ original");
});

test("replacement requires acknowledgement of a preserved native file", async () => {
  const disk = memory({ [LOCAL_NOTES_KEY]: "{ original" });
  const local = createLocalCollectionStorage(disk, { ...nativeArchive(), saveCopy: async () => null });
  local.load();
  await assert.rejects(local.replaceUnreadable(), /did not confirm/);
  assert.equal(disk.getItem(LOCAL_NOTES_KEY), "{ original");
  assert.equal(local.blocked(), true);
});
