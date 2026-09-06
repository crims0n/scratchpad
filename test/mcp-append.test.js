// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { createMcpWriter, createNoteRevisionTracker } from "../src/mcp-writes.js";

function harness() {
  let counter = 0;
  const uuid = () => String(++counter);
  const revision = createNoteRevisionTracker(uuid);
  const state = { enabled: false, editEnabled: true, collectionId: "one", switching: false,
    notes: [{ id: "n", title: "Note", content: "Original", updatedAt: 1, isTitleLocked: true, isPinned: false, folderId: null }], folders: [] };
  let queue = Promise.resolve();
  let failures = 0;
  const saved = [];
  const adapter = {
    uuid, state: () => ({ ...state, permissions: { create_note: state.enabled, create_folder: state.enabled, append_to_note: state.editEnabled } }), revision: note => revision(note, state.collectionId),
    enqueue: operation => {
      const promise = queue.then(operation);
      queue = promise.catch(() => undefined);
      return promise;
    },
    applyNoteChange: note => { state.notes = state.notes.map(n => n.id === note.id ? note : n); },
    mutationSaveFailed: () => { failures++; }, mutationSaved: () => {},
    persist: async candidate => { saved.push(structuredClone(candidate)); }, refresh: async () => {}
  };
  const writer = createMcpWriter(adapter);
  const args = { collectionId: "one", requestId: "append-1", noteId: "n", expectedRevision: adapter.revision(state.notes[0]), content: "\n\nNew café 📝" };
  return { writer, adapter, args, state, saved, failures: () => failures };
}

test("append adds exact text once, preserves metadata, and returns a new revision", async () => {
  const h = harness();
  const results = await Promise.all([h.writer.request("append_to_note", h.args), h.writer.request("append_to_note", h.args)]);
  assert.equal(h.state.notes[0].content, "Original\n\nNew café 📝");
  assert.equal(h.state.notes[0].title, "Note");
  assert.equal(h.state.notes[0].isTitleLocked, true);
  assert.equal(h.saved.length, 1);
  assert.notEqual(results[0].revision, h.args.expectedRevision);
  assert.deepEqual(results[0], results[1]);
  await assert.rejects(h.writer.request("append_to_note", { ...h.args, content: "Different" }), /different arguments/);
});

test("live unsaved content and metadata changes invalidate revisions", async () => {
  for (const change of [note => { note.content += " typed"; }, note => { note.title = "Renamed"; }, note => { note.isPinned = true; }, note => { note.folderId = "moved"; }]) {
    const h = harness();
    change(h.state.notes[0]);
    const before = structuredClone(h.state.notes);
    await assert.rejects(h.writer.request("append_to_note", h.args), /Revision conflict/);
    assert.deepEqual(h.state.notes, before);
    assert.equal(h.saved.length, 0);
  }
});

test("queued appends recheck revisions and editing permission at execution", async () => {
  for (const change of [state => { state.notes[0].content = "New edit"; }, state => { state.editEnabled = false; }, state => { state.switching = true; }]) {
    const h = harness();
    let release;
    h.adapter.enqueue(() => new Promise(resolve => { release = resolve; }));
    const append = h.writer.request("append_to_note", h.args);
    await Promise.resolve();
    change(h.state);
    release();
    await assert.rejects(append, /conflict|disabled|switching/);
    assert.equal(h.saved.length, 0);
  }
});

test("failed save retains visible content and retries save without repeating the append", async () => {
  const h = harness();
  const persist = h.adapter.persist;
  h.adapter.persist = async () => { throw new Error("Disk full"); };
  await assert.rejects(h.writer.request("append_to_note", h.args), /Append applied in the editor but save failed/);
  assert.equal(h.state.notes[0].content, "Original\n\nNew café 📝");
  assert.equal(h.failures(), 1);
  // User edits after the failure are part of what the retry saves.
  h.state.notes[0].content += "\nUser addition";
  h.adapter.persist = persist;
  const result = await h.writer.request("append_to_note", h.args);
  assert.equal(result.note.id, "n");
  assert.equal(h.state.notes[0].content, "Original\n\nNew café 📝\nUser addition");
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].notes[0].content, h.state.notes[0].content);
});

test("typing during persistence is not overwritten by a successful append response", async () => {
  const h = harness();
  let finish;
  h.adapter.persist = () => new Promise(resolve => { finish = resolve; });
  const request = h.writer.request("append_to_note", h.args);
  await Promise.resolve();
  h.state.notes[0].content += "\nTyped while saving";
  finish();
  const result = await request;
  assert.equal(Object.hasOwn(result.note, "content"), false, "receipts do not retain growing note bodies");
  assert.equal(h.state.notes[0].content, "Original\n\nNew café 📝\nTyped while saving");
  assert.notEqual(h.adapter.revision(h.state.notes[0]), result.revision);
  await h.writer.request("append_to_note", h.args);
  assert.equal(h.state.notes[0].content.match(/New café/g).length, 1);
});

test("creation permission does not authorize appending; invalid requests have no effect", async () => {
  const h = harness();
  for (const args of [{ ...h.args, content: "" }, { ...h.args, content: "📝".repeat(25001) }, { ...h.args, expectedRevision: "" }, { ...h.args, noteId: "missing" }]) {
    await assert.rejects(h.writer.request("append_to_note", args));
  }
  h.state.enabled = true;
  h.state.editEnabled = false;
  await assert.rejects(h.writer.request("append_to_note", h.args), /disabled/);
  assert.equal(h.state.notes[0].content, "Original");
  assert.equal(h.saved.length, 0);
});

test("a deleted note is never recreated by retrying a failed append", async () => {
  const h = harness();
  h.adapter.persist = async () => { throw new Error("Disk full"); };
  await assert.rejects(h.writer.request("append_to_note", h.args));
  h.state.notes = [];
  await assert.rejects(h.writer.request("append_to_note", h.args), /no longer exists/);
  assert.deepEqual(h.state.notes, []);
});

test("revision tokens remain stable for unchanged notes and expire across collections", () => {
  const h = harness();
  assert.equal(h.adapter.revision(structuredClone(h.state.notes[0])), h.args.expectedRevision);
  h.state.collectionId = "two";
  assert.notEqual(h.adapter.revision(h.state.notes[0]), h.args.expectedRevision);
});
