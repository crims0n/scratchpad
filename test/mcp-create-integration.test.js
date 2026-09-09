// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, settle } from "./helpers/app-harness.js";

const seed = { id: "original", title: "Original", content: "Original body", updatedAt: 1, isTitleLocked: true, folderId: null };

test("MCP creations persist, preserve editor work, and cannot cross workspace switches", async () => {
  let disk = { notes: [structuredClone(seed)], folders: [] };
  let holdSave = null;
  let failSave = false;
  const app = await bootApp({
    storage: { scratchpad_notes: [seed] },
    handlers: {
      start_mcp_server: () => ({ command: "/scratchpad", args: ["--mcp-stdio"] }),
      select_db_file: () => "/tmp/mcp-create.db",
      load_db_notes: () => structuredClone(disk.notes),
      load_db_folders: () => structuredClone(disk.folders),
      save_workspace_db: async ({ notes, folders }) => {
        const candidate = structuredClone({ notes, folders });
        if (failSave) throw new Error("Disk full");
        if (holdSave) await new Promise(resolve => { holdSave.release = resolve; });
        disk = candidate;
      },
      save_note_db: ({ note }) => {
        const index = disk.notes.findIndex(n => n.id === note.id);
        if (index >= 0) disk.notes[index] = structuredClone(note);
      }
    }
  });
  const currentCollection = () => app.invocations.findLast(i => i.command === "update_mcp_snapshot").args.collectionId;
  let ticket = 0;
  const send = async (operation, args) => {
    const currentTicket = String(++ticket);
    await app.emit("mcp-write-request", { ticket: currentTicket, operation, arguments: args });
    return app.invocations.findLast(i => i.command === "complete_mcp_write" && i.args.ticket === currentTicket).args.result;
  };
  app.click("agent-access-toggle-btn");
  await settle();
  app.click("mcp-permission-create_note");
  await settle();
  app.click("mcp-permission-create_folder");
  await settle();
  assert.equal(document.getElementById("mcp-permissions-summary").textContent, "5 read · 2 write functions enabled");
  const localCollection = currentCollection();
  const folderArgs = { collectionId: localCollection, requestId: "local-folder", name: "Research" };
  const folder = await send("create_folder", folderArgs);
  assert.equal(folder.ok, true);
  assert.equal(app.read("scratchpad_folders")[0].id, folder.folder.id);
  const localNoteArgs = { collectionId: localCollection, requestId: "local-note", title: "Agent note", content: "Saved text", folderId: folder.folder.id };
  const localNote = await send("create_note", localNoteArgs);
  assert.equal(localNote.ok, true);
  assert.equal(app.read("scratchpad_notes").filter(n => n.id === localNote.note.id).length, 1);
  assert.equal((await send("create_note", localNoteArgs)).note.id, localNote.note.id);
  assert.equal(document.getElementById("note-title").value, "Original");
  assert.equal(document.getElementById("editor-textarea").value, "Original body");

  const storagePrototype = app.dom.window.Storage.prototype;
  const originalSetItem = storagePrototype.setItem;
  storagePrototype.setItem = function(key, value) {
    if (key === "scratchpad_notes") throw new Error("Quota exceeded");
    return originalSetItem.call(this, key, value);
  };
  const quotaArgs = { ...localNoteArgs, requestId: "quota", title: "Retry after quota" };
  try {
    assert.equal((await send("create_note", quotaArgs)).ok, false);
    assert.ok(!app.sidebarTitles().includes("Retry after quota"));
  } finally {
    storagePrototype.setItem = originalSetItem;
  }
  assert.equal((await send("create_note", quotaArgs)).ok, true);

  app.click("db-connect-btn");
  await settle(100);
  const collectionId = currentCollection();
  assert.notEqual(collectionId, localCollection);
  assert.equal((await send("create_note", localNoteArgs)).ok, false);
  const noteArgs = { collectionId, requestId: "workspace-note", title: "Workspace agent", content: "Durable body" };
  failSave = true;
  assert.equal((await send("create_note", noteArgs)).ok, false);
  assert.ok(!app.sidebarTitles().includes("Workspace agent"));
  assert.equal(disk.notes.length, 1);
  failSave = false;

  // Hold the creation on disk while the user types and creates a second note.
  holdSave = {};
  const created = send("create_note", noteArgs);
  await settle(20);
  const editor = document.getElementById("editor-textarea");
  editor.focus();
  editor.value = "Typed while MCP was saving";
  editor.dispatchEvent(new app.dom.window.Event("input"));
  app.click("new-note-btn");
  const selectedTitle = document.getElementById("note-title").value;
  const release = holdSave.release;
  holdSave = null;
  release();
  const result = await created;
  assert.equal(result.ok, true);
  await settle(600);
  assert.equal(disk.notes.length, 3, "a queued structural save must retain the MCP creation");
  assert.equal(disk.notes.find(n => n.id === "original").content, "Typed while MCP was saving");
  assert.equal(disk.notes.find(n => n.id === result.note.id).content, "Durable body");
  assert.equal(document.getElementById("note-title").value, selectedTitle);
  assert.equal((await send("create_note", noteArgs)).note.id, result.note.id);

  holdSave = {};
  const last = send("create_folder", { collectionId, requestId: "last-folder", name: "Last" });
  await settle(20);
  app.click("db-disconnect-btn");
  const rejected = await send("create_note", { ...noteArgs, requestId: "too-late" });
  assert.equal(rejected.ok, false);
  const finish = holdSave.release;
  holdSave = null;
  finish();
  assert.equal((await last).ok, true);
  await settle(100);
  assert.ok(app.sidebarTitles().includes("Agent note"));
  assert.ok(!app.sidebarTitles().includes("Workspace agent"));
  assert.ok(disk.folders.some(f => f.name === "Last"));
  assert.equal(disk.notes.length, 3);

  // Reopen from persisted data, then revoke writes while keeping reads active.
  app.click("db-connect-btn");
  await settle(100);
  assert.ok(app.sidebarTitles().includes("Workspace agent"));
  app.click("mcp-permission-create_note");
  await settle();
  app.click("mcp-permission-create_folder");
  await settle();
  assert.equal(document.getElementById("mcp-permissions-summary").textContent, "5 read · 0 write functions enabled");
  assert.equal((await send("create_note", { ...noteArgs, collectionId: currentCollection(), requestId: "disabled" })).ok, false);
});
