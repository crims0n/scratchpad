// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { createMcpWriter, createNoteRevisionTracker, createFolderRevisionTracker } from "../src/mcp-writes.js";

function harness(operation) {
  let id = 0;
  const uuid = () => String(++id);
  const nr = createNoteRevisionTracker(uuid); const fr = createFolderRevisionTracker(uuid);
  const state = { collectionId: "c", notes: [{ id: "n", title: "Note", content: "Body", updatedAt: 1, isPinned: true, folderId: "f" }],
    folders: [{ id: "f", name: "Folder" }], trash: [], permissions: { delete_note: true, delete_folder: true } };
  if (operation === "delete_folder") state.notes = [];
  let queue = Promise.resolve();
  let saves = 0;
  const adapter = {
    state: () => state, revision: note => nr(note, state.collectionId), folderRevision: folder => fr(folder, state.collectionId),
    enqueue: action => { const p = queue.then(action); queue = p.catch(() => {}); return p; },
    applyNoteDeletion: note => { state.notes = state.notes.filter(n => n.id !== note.id); state.trash.push({ id: "t", note }); return { id: "t", noteId: note.id }; },
    applyFolderDeletion: folder => { state.folders = state.folders.filter(f => f.id !== folder.id); },
    persist: async () => { saves++; }, mutationSaveFailed: () => {}, deletionSaved: () => {}, refresh: async () => {}
  };
  const args = { collectionId: "c", requestId: "r", expectedRevision: operation === "delete_note" ? adapter.revision(state.notes[0]) : adapter.folderRevision(state.folders[0]),
    ...(operation === "delete_note" ? { noteId: "n" } : { folderId: "f" }) };
  return { state, adapter, args, writer: createMcpWriter(adapter), saves: () => saves };
}

for (const operation of ["delete_note", "delete_folder"]) {
  test(`${operation} retries without deleting twice, even after a failed save`, async () => {
    const h = harness(operation); const persist = h.adapter.persist;
    h.adapter.persist = async () => { throw new Error("Disk full"); };
    await assert.rejects(h.writer.request(operation, h.args), /Deletion applied.*save failed/);
    h.adapter.persist = persist;
    const [first, retry] = await Promise.all([h.writer.request(operation, h.args), h.writer.request(operation, h.args)]);
    assert.deepEqual(first, retry);
    assert.equal(h.saves(), 1);
    if (operation === "delete_note") {
      assert.equal(h.state.trash.length, 1);
      // Restoring a deleted note must not let an old retry delete it again.
      h.state.notes = [h.state.trash[0].note]; h.state.trash = [];
      await h.writer.request(operation, h.args);
      assert.equal(h.state.notes.length, 1);
    } else assert.equal(h.state.folders.length, 0);
  });

  test(`${operation} rechecks permission, live revision, and collection when queued`, async () => {
    for (const change of [s => { s.permissions[operation] = false; }, s => { s.collectionId = "other"; },
      s => { if (operation === "delete_note") s.notes[0].content += " typed"; else s.folders[0].name = "Renamed"; }]) {
      const h = harness(operation); let release;
      h.adapter.enqueue(() => new Promise(resolve => { release = resolve; }));
      const pending = h.writer.request(operation, h.args); await Promise.resolve();
      change(h.state); release();
      await assert.rejects(pending, /disabled|Collection|Revision conflict/);
      assert.equal(h.saves(), 0);
      assert.equal(h.state.trash.length, 0);
    }
  });
}

test("folder deletion rejects pinned members added after the agent read it", async () => {
  const h = harness("delete_folder");
  h.state.notes.push({ id: "p", folderId: "f", isPinned: true });
  await assert.rejects(h.writer.request("delete_folder", h.args), /not empty/);
  assert.equal(h.state.folders.length, 1);
  assert.equal(h.saves(), 0);
});

test("MCP has no restore or permanent trash-deletion operations", async () => {
  const h = harness("delete_note");
  for (const operation of ["empty_trash", "purge_trash", "restore_note"]) {
    await assert.rejects(h.writer.request(operation, h.args), /Unknown write operation/);
  }
});
