// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { createMcpWriter, createNoteRevisionTracker, createFolderRevisionTracker } from "../src/mcp-writes.js";

const operations = ["rename_note", "move_note", "rename_folder"];
function harness(operation) {
  let counter = 0;
  const uuid = () => String(++counter);
  const noteRevision = createNoteRevisionTracker(uuid);
  const folderRevision = createFolderRevisionTracker(uuid);
  const state = { collectionId: "one", switching: false, permissions: Object.fromEntries(operations.map(tool => [tool, true])),
    notes: [{ id: "n", title: "Original", content: "Body 📝", updatedAt: 1, isTitleLocked: false, isPinned: true, folderId: null }],
    folders: [{ id: "f", name: "Work" }, { id: "g", name: "Personal" }] };
  const saved = [];
  let queue = Promise.resolve();
  const adapter = {
    state: () => state, uuid,
    revision: note => noteRevision(note, state.collectionId),
    folderRevision: folder => folderRevision(folder, state.collectionId),
    enqueue: action => { const result = queue.then(action); queue = result.catch(() => {}); return result; },
    applyNoteChange: note => { state.notes = state.notes.map(n => n.id === note.id ? note : n); },
    applyFolderChange: folder => { state.folders = state.folders.map(f => f.id === folder.id ? folder : f); },
    persist: async candidate => { saved.push(structuredClone(candidate)); },
    mutationSaved: () => {}, mutationSaveFailed: () => {}, refresh: async () => {}
  };
  const args = { collectionId: "one", requestId: "edit", ...(operation === "rename_folder"
    ? { folderId: "f", expectedRevision: adapter.folderRevision(state.folders[0]), name: "  New   name  " }
    : { noteId: "n", expectedRevision: adapter.revision(state.notes[0]), ...(operation === "rename_note" ? { title: " New title 📝 " } : { folderId: "f" }) }) };
  return { state, adapter, args, saved, writer: createMcpWriter(adapter) };
}

for (const operation of operations) {
  test(`${operation} preserves unrelated fields and retries exactly once`, async () => {
    const h = harness(operation);
    const before = structuredClone(h.state);
    const [result, retry] = await Promise.all([h.writer.request(operation, h.args), h.writer.request(operation, h.args)]);
    assert.deepEqual(retry, result);
    assert.equal(h.saved.length, 1);
    assert.notEqual(result.revision, h.args.expectedRevision);
    if (operation === "rename_folder") {
      assert.deepEqual(h.state.notes, before.notes);
      assert.deepEqual(h.state.folders, [{ id: "f", name: "New name" }, before.folders[1]]);
      assert.equal(result.folder.id, "f");
    } else {
      assert.equal(h.state.notes[0].content, before.notes[0].content);
      assert.equal(h.state.notes[0].isPinned, true);
      assert.ok(h.state.notes[0].updatedAt > 1);
      assert.deepEqual(h.state.folders, before.folders);
      assert.equal(Object.hasOwn(result.note, "content"), false);
      assert.equal(h.state.notes[0].title, operation === "rename_note" ? "New title 📝" : "Original");
      assert.equal(h.state.notes[0].isTitleLocked, operation === "rename_note");
      assert.equal(h.state.notes[0].folderId, operation === "move_note" ? "f" : null);
    }
    const changed = operation === "rename_folder" ? { name: "Other" } : operation === "rename_note" ? { title: "Other" } : { folderId: null };
    await assert.rejects(h.writer.request(operation, { ...h.args, ...changed }), /different arguments/);
  });

  test(`${operation} rechecks revision, permission, and collection at queued execution`, async () => {
    for (const change of [state => { state.permissions[operation] = false; }, state => { state.collectionId = "two"; }, state => { state.switching = true; },
      state => { if (operation === "rename_folder") state.folders[0].name = "User rename"; else state.notes[0].content += " unsaved edit"; }]) {
      const h = harness(operation);
      let release;
      h.adapter.enqueue(() => new Promise(resolve => { release = resolve; }));
      const pending = h.writer.request(operation, h.args);
      await Promise.resolve();
      change(h.state);
      const before = structuredClone(h.state);
      release();
      await assert.rejects(pending, /disabled|Collection|Revision conflict/);
      assert.deepEqual(h.state, before);
      assert.equal(h.saved.length, 0);
    }
  });

  test(`${operation} retries a failed save without overwriting later user edits or recreating deleted items`, async () => {
    const h = harness(operation);
    const persist = h.adapter.persist;
    h.adapter.persist = async () => { throw new Error("Disk full"); };
    await assert.rejects(h.writer.request(operation, h.args), /applied in the editor but save failed/);
    if (operation === "rename_folder") h.state.folders[0].name = "Later user rename";
    else { h.state.notes[0].title = "Later user title"; h.state.notes[0].folderId = "g"; h.state.notes[0].content += " Typed later"; }
    const before = structuredClone(h.state);
    h.adapter.persist = persist;
    await h.writer.request(operation, h.args);
    assert.deepEqual(h.state, before);
    assert.deepEqual(h.saved[0], before);

    const deleted = harness(operation);
    deleted.adapter.persist = async () => { throw new Error("Disk full"); };
    await assert.rejects(deleted.writer.request(operation, deleted.args));
    if (operation === "rename_folder") deleted.state.folders = []; else deleted.state.notes = [];
    await assert.rejects(deleted.writer.request(operation, deleted.args), /no longer exists/);
  });
}

test("move validates an explicit destination at execution and supports top level", async () => {
  const h = harness("move_note");
  for (const folderId of [undefined, "missing", "", 42]) {
    await assert.rejects(h.writer.request("move_note", { ...h.args, folderId }), /folder|Moving/);
  }
  const moved = await h.writer.request("move_note", h.args);
  const top = await h.writer.request("move_note", { ...h.args, requestId: "top", expectedRevision: moved.revision, folderId: null });
  assert.equal(top.note.folderId, null);
  const queued = harness("move_note");
  let release;
  queued.adapter.enqueue(() => new Promise(resolve => { release = resolve; }));
  const request = queued.writer.request("move_note", queued.args);
  await Promise.resolve();
  queued.state.folders = [];
  release();
  await assert.rejects(request, /Destination folder does not exist/);
  assert.equal(queued.saved.length, 0);
});

test("renames reject invalid names and folder collisions without mutation", async () => {
  for (const operation of ["rename_note", "rename_folder"]) {
    const h = harness(operation);
    const field = operation === "rename_note" ? "title" : "name";
    const invalid = ["", "  ", "x".repeat(201), null, 42];
    if (operation === "rename_folder") invalid.push("PERSONAL", "Pinned", "Top   level");
    for (const value of invalid) await assert.rejects(h.writer.request(operation, { ...h.args, [field]: value }));
    assert.equal(h.saved.length, 0);
  }
  const h = harness("rename_folder");
  h.state.editingFolderId = "f";
  await assert.rejects(h.writer.request("rename_folder", h.args), /being edited/);
});

test("folder revisions stay stable for membership changes and expire with names or collections", () => {
  const h = harness("rename_folder");
  h.state.notes[0].folderId = "f";
  assert.equal(h.adapter.folderRevision(h.state.folders[0]), h.args.expectedRevision);
  h.state.folders[0].name = "Changed";
  assert.notEqual(h.adapter.folderRevision(h.state.folders[0]), h.args.expectedRevision);
  const revision = h.adapter.folderRevision(h.state.folders[0]);
  h.state.collectionId = "two";
  assert.notEqual(h.adapter.folderRevision(h.state.folders[0]), revision);
});
