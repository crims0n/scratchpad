// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { createMcpWriter } from "../src/mcp-writes.js";

function harness() {
  const state = { enabled: true, switching: false, collectionId: "one", notes: [], folders: [] };
  let queue = Promise.resolve();
  let nextId = 0;
  const saved = [];
  const adapter = {
    state: () => ({ ...state, permissions: { create_note: state.enabled, create_folder: state.enabled, append_to_note: state.editEnabled } }),
    uuid: () => String(++nextId),
    enqueue: operation => {
      const result = queue.then(operation);
      queue = result.catch(() => undefined);
      return result;
    },
    persist: async candidate => { saved.push(structuredClone(candidate)); },
    publish: ({ note, folder }) => {
      if (note) state.notes.push(note);
      if (folder) state.folders.push(folder);
    },
    refresh: async () => {}
  };
  const writer = createMcpWriter(adapter);
  const note = { collectionId: "one", requestId: "n1", title: "New", content: "café 📝" };
  return { state, saved, adapter, writer, note };
}

test("simultaneous retries create one note and retain its stable ID", async () => {
  const h = harness();
  const results = await Promise.all(Array.from({ length: 5 }, () => h.writer.request("create_note", h.note)));
  assert.equal(h.saved.length, 1);
  assert.equal(h.state.notes.length, 1);
  assert.ok(results.every(result => result.note.id === results[0].note.id));
  await assert.rejects(h.writer.request("create_note", { ...h.note, title: "Different" }), /different arguments/);
});

test("failed persistence publishes nothing and the same request can be retried", async () => {
  const h = harness();
  const persist = h.adapter.persist;
  h.adapter.persist = async () => { throw new Error("Disk full"); };
  await assert.rejects(h.writer.request("create_note", h.note), /Disk full/);
  assert.equal(h.state.notes.length, 0);
  h.adapter.persist = persist;
  await h.writer.request("create_note", h.note);
  assert.equal(h.state.notes.length, 1);
});

test("a failed snapshot refresh cannot duplicate an already committed creation", async () => {
  const h = harness();
  h.adapter.refresh = async () => { throw new Error("Snapshot unavailable"); };
  await assert.rejects(h.writer.request("create_note", h.note), /Snapshot unavailable/);
  assert.equal(h.state.notes.length, 1);
  h.adapter.refresh = async () => {};
  await h.writer.request("create_note", h.note);
  assert.equal(h.saved.length, 1);
});

test("pending creates recheck collection and permission when the queue runs", async () => {
  for (const change of [s => { s.collectionId = "two"; }, s => { s.enabled = false; }, s => { s.switching = true; }]) {
    const h = harness();
    let release;
    h.adapter.enqueue(() => new Promise(resolve => { release = resolve; }));
    const request = h.writer.request("create_note", h.note);
    await Promise.resolve();
    change(h.state);
    release();
    await assert.rejects(request, /Collection|disabled/);
    assert.equal(h.saved.length, 0);
  }
});

test("folder names and references are validated against the latest queued state", async () => {
  const h = harness();
  const folderArgs = { collectionId: "one", requestId: "f1", name: "  Research   notes " };
  const folder = await h.writer.request("create_folder", folderArgs);
  assert.equal(folder.folder.name, "Research notes");
  await assert.rejects(h.writer.request("create_folder", { ...folderArgs, requestId: "f2", name: "research notes" }), /already exists/);
  await assert.rejects(h.writer.request("create_folder", { ...folderArgs, requestId: "f3", name: "Pinned" }), /reserved/);
  await assert.rejects(h.writer.request("create_note", { ...h.note, folderId: "missing" }), /does not exist/);
  const created = await h.writer.request("create_note", { ...h.note, folderId: folder.folder.id });
  assert.equal(created.note.folderId, folder.folder.id);
});

test("input bounds include UTF-8 bytes and unknown operations cannot mutate state", async () => {
  const h = harness();
  await assert.rejects(h.writer.request("create_note", { ...h.note, content: "📝".repeat(25001) }), /100000/);
  await assert.rejects(h.writer.request("create_note", { ...h.note, title: " " }), /Title/);
  await assert.rejects(h.writer.request("create_note", { ...h.note, requestId: "" }), /requestId/);
  await assert.rejects(h.writer.request("empty_trash", h.note), /Unknown/);
  assert.equal(h.saved.length, 0);
});

test("pending folders reserve names only until persistence finishes", async () => {
  const h = harness();
  let release;
  h.adapter.persist = () => new Promise(resolve => { release = resolve; });
  const request = h.writer.request("create_folder", { collectionId: "one", requestId: "f", name: "Work" });
  await Promise.resolve();
  assert.equal(h.writer.reservedFolders()[0].name, "Work");
  assert.equal(h.state.folders.length, 0);
  release();
  await request;
  assert.deepEqual(h.writer.reservedFolders(), []);
});
