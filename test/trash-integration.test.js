// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, settle } from "./helpers/app-harness.js";

const note = { id: "n", title: "Keep this", content: "Full body 📝", updatedAt: 1, isTitleLocked: true, isPinned: true, folderId: "f" };
const folders = [{ id: "f", name: "Work" }];

test("trash UI and MCP deletions support recovery, workspace isolation, retries, and user-only emptying", async () => {
  let disk = { notes: [structuredClone(note)], folders: structuredClone(folders), trash: [] };
  let fail = false;
  const app = await bootApp({ storage: { scratchpad_notes: [note], scratchpad_folders: folders }, handlers: {
    start_mcp_server: () => ({ command: "/scratchpad", args: ["--mcp-stdio"] }),
    select_db_file: () => "/tmp/trash.db",
    load_db_notes: () => structuredClone(disk.notes),
    load_db_folders: () => structuredClone(disk.folders),
    load_db_trash: () => structuredClone(disk.trash),
    save_workspace_db: args => {
      if (fail) throw new Error("Disk full");
      disk = structuredClone({ notes: args.notes, folders: args.folders, trash: args.trash ?? disk.trash });
    }
  } });
  const snapshot = () => app.invocations.findLast(i => i.command === "update_mcp_snapshot").args;
  let ticket = 0;
  const send = async (operation, args) => {
    const id = String(++ticket);
    await app.emit("mcp-write-request", { ticket: id, operation, arguments: args });
    return app.invocations.findLast(i => i.command === "complete_mcp_write" && i.args.ticket === id).args.result;
  };
  const deletion = (requestId = "delete") => ({ collectionId: snapshot().collectionId, requestId, noteId: "n", expectedRevision: snapshot().noteRevisions.n });
  const rightClick = id => document.getElementById(id).dispatchEvent(new app.dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 700 }));
  const restore = async id => { document.querySelector(`[data-trash-id="${id}"]`).click(); await settle(); };

  app.click("agent-access-toggle-btn"); await settle();
  app.click("mcp-permission-delete_folder"); await settle();
  const folderArgs = { collectionId: snapshot().collectionId, requestId: "folder", folderId: "f", expectedRevision: snapshot().folderRevisions.f };
  assert.match((await send("delete_folder", folderArgs)).error, /not empty/, "pinned members count");
  assert.equal((await send("delete_note", deletion())).ok, false, "separate delete permission is required");
  app.click("mcp-permission-delete_note"); await settle();
  const originalDelete = deletion();
  const removed = await send("delete_note", originalDelete);
  assert.equal(removed.ok, true, removed.error);
  const trashId = removed.trash.id;
  assert.equal(app.read("scratchpad_notes").some(n => n.id === "n"), false);
  assert.deepEqual(app.read("scratchpad_trash")[0].note, note);
  assert.deepEqual(await send("delete_note", originalDelete), removed);
  assert.equal(snapshot().trash[0].id, trashId);
  assert.equal(Object.hasOwn(snapshot().trash[0], "content"), false);
  assert.equal((await send("delete_folder", folderArgs)).ok, true);
  assert.deepEqual(app.read("scratchpad_folders"), []);

  app.click("trash-btn");
  assert.equal(document.getElementById("trash-modal-backdrop").getAttribute("aria-hidden"), "false");
  assert.match(document.getElementById("trash-list").textContent, /Keep this/);
  await restore(trashId);
  const restored = app.read("scratchpad_notes").find(n => n.id === "n");
  assert.equal(restored.content, note.content);
  assert.equal(restored.isPinned, true);
  assert.equal(restored.isTitleLocked, true);
  assert.equal(restored.folderId, null, "missing original folder falls back to top level");
  assert.deepEqual(app.read("scratchpad_trash"), []);
  assert.deepEqual(await send("delete_note", originalDelete), removed, "old retry never deletes a restored note");
  assert.ok(app.read("scratchpad_notes").some(n => n.id === "n"));
  assert.match((await send("delete_note", { ...originalDelete, requestId: "stale-after-restore" })).error, /Revision conflict/);
  app.click("close-trash-btn");

  // Local deletion failures retain recoverable state, and an identical retry saves it.
  const prototype = app.dom.window.Storage.prototype;
  const setItem = prototype.setItem;
  prototype.setItem = function(key, value) { if (key === "scratchpad_notes") throw new Error("Quota exceeded"); return setItem.call(this, key, value); };
  const localRequest = deletion("local-failure");
  try { assert.match((await send("delete_note", localRequest)).error, /Deletion applied.*save failed/); }
  finally { prototype.setItem = setItem; }
  assert.equal(document.getElementById("save-status").textContent, "Save failed");
  assert.equal(app.read("scratchpad_trash").length, 1, "recovery copy is saved before active removal");
  assert.equal((await send("delete_note", localRequest)).ok, true);
  const localTrash = structuredClone(app.read("scratchpad_trash"));

  // Each database has its own trash; reopening loads it from disk.
  app.click("db-connect-btn"); await settle(100);
  assert.deepEqual(snapshot().trash, []);
  const dbRequest = deletion("db-failure");
  fail = true;
  assert.match((await send("delete_note", dbRequest)).error, /save failed/);
  assert.equal(disk.notes.some(n => n.id === "n"), true);
  assert.deepEqual(disk.trash, []);
  fail = false;
  const dbRemoved = await send("delete_note", dbRequest);
  assert.equal(dbRemoved.ok, true);
  assert.equal(disk.notes.some(n => n.id === "n"), false);
  assert.equal(disk.trash[0].note.content, note.content);
  app.click("db-disconnect-btn"); await settle(100);
  assert.deepEqual(app.read("scratchpad_trash"), localTrash);
  assert.equal(snapshot().trash[0].id, localTrash[0].id);
  app.click("db-connect-btn"); await settle(100);
  assert.equal(snapshot().trash[0].id, dbRemoved.trash.id);

  // Right click exposes a user confirmation; cancellation preserves everything.
  rightClick("trash-btn");
  assert.equal(document.getElementById("trash-context-menu").style.display, "flex");
  assert.equal(document.getElementById("custom-context-menu").style.display, "none");
  app.click("trash-menu-empty");
  assert.equal(document.activeElement.id, "cancel-empty-trash-btn");
  assert.equal(document.getElementById("trash-empty-confirmation").hidden, false);
  app.click("cancel-empty-trash-btn");
  assert.equal(disk.trash.length, 1);
  app.click("close-trash-btn");
  rightClick("trash-btn"); app.click("trash-menu-empty");
  fail = true;
  app.click("confirm-empty-trash-btn"); await settle(100);
  assert.equal(disk.trash.length, 1);
  assert.match(document.getElementById("trash-status").textContent, /Could not complete/);
  fail = false;
  app.click("confirm-empty-trash-btn"); await settle(100);
  assert.deepEqual(disk.trash, []);
  assert.deepEqual(app.read("scratchpad_trash"), localTrash, "emptying workspace trash leaves local trash untouched");
  assert.deepEqual(snapshot().trash, []);
  assert.equal((await send("empty_trash", { collectionId: snapshot().collectionId, requestId: "agent-purge" })).ok, false);
});
