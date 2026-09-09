// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, settle } from "./helpers/app-harness.js";

test("appending uses live revisions, preserves selection, and retries failed saves without duplication", async () => {
  const seed = { id: "n", title: "Original", content: "Original text", updatedAt: 1, isTitleLocked: true, folderId: null };
  let disk = { notes: [seed], folders: [] };
  let hold = null;
  let fail = false;
  const app = await bootApp({
    storage: { scratchpad_notes: [seed] },
    handlers: {
      start_mcp_server: () => ({ command: "/scratchpad", args: ["--mcp-stdio"] }),
      select_db_file: () => "/tmp/mcp-append.db",
      load_db_notes: () => structuredClone(disk.notes),
      load_db_folders: () => [],
      save_workspace_db: async ({ notes, folders }) => {
        const candidate = structuredClone({ notes, folders });
        if (hold) await new Promise(resolve => { hold.release = resolve; });
        if (fail) throw new Error("Disk full");
        disk = candidate;
      },
      save_note_db: ({ note }) => {
        if (fail) throw new Error("Disk full");
        disk.notes = disk.notes.map(n => n.id === note.id ? structuredClone(note) : n);
      }
    }
  });
  const editor = document.getElementById("editor-textarea");
  const snapshot = () => app.invocations.findLast(i => i.command === "update_mcp_snapshot").args;
  let ticket = 0;
  const send = async args => {
    const id = String(++ticket);
    await app.emit("mcp-write-request", { ticket: id, operation: "append_to_note", arguments: args });
    return app.invocations.findLast(i => i.command === "complete_mcp_write" && i.args.ticket === id).args.result;
  };
  app.click("agent-access-toggle-btn");
  await settle();
  app.click("mcp-permission-create_note");
  await settle();
  app.click("mcp-permission-create_folder");
  await settle();
  const args = { collectionId: snapshot().collectionId, requestId: "local", noteId: "n", expectedRevision: snapshot().noteRevisions.n, content: "\n\nAppended 📝" };
  assert.equal((await send(args)).ok, false, "creation permission alone does not grant append access");
  app.click("mcp-permission-append_to_note");
  await settle();
  assert.equal(document.getElementById("mcp-permissions-summary").textContent, "5 read · 3 write functions enabled");
  editor.focus();
  editor.setSelectionRange(2, 5);
  const result = await send(args);
  assert.equal(result.ok, true);
  assert.equal(editor.value, "Original text\n\nAppended 📝");
  assert.equal(document.activeElement, editor);
  assert.equal(editor.selectionStart, 2);
  assert.equal(editor.selectionEnd, 5);
  assert.equal(document.getElementById("note-title").value, "Original");
  assert.equal(app.read("scratchpad_notes")[0].content, editor.value);
  assert.equal(snapshot().noteRevisions.n, result.revision);
  assert.equal((await send(args)).revision, result.revision);
  assert.equal(editor.value.match(/Appended/g).length, 1);

  // Conflict against typing before its 50ms MCP snapshot debounce has fired.
  editor.value += "\nUnsaved typing";
  editor.dispatchEvent(new app.dom.window.Event("input"));
  const conflict = await send({ ...args, requestId: "stale", expectedRevision: result.revision });
  assert.equal(conflict.ok, false);
  assert.match(conflict.error, /Revision conflict/);
  assert.equal(editor.value.match(/Appended/g).length, 1);

  app.click("db-connect-btn");
  await settle(100);
  const dbArgs = { ...args, collectionId: snapshot().collectionId, requestId: "database", expectedRevision: snapshot().noteRevisions.n, content: "\nDatabase append" };
  hold = {};
  const pending = send(dbArgs);
  await settle(20);
  assert.equal(editor.value, "Original text\nDatabase append", "append is visible while saving");
  editor.value += "\nTyped during write";
  editor.dispatchEvent(new app.dom.window.Event("input"));
  const release = hold.release;
  hold = null;
  release();
  assert.equal((await pending).ok, true);
  await settle(600);
  assert.equal(disk.notes[0].content, "Original text\nDatabase append\nTyped during write");
  assert.equal(editor.value, disk.notes[0].content);
  await send(dbArgs); // refresh current full snapshot and verify original retry
  const failureArgs = { ...dbArgs, requestId: "failed", expectedRevision: snapshot().noteRevisions.n, content: "\nRetained on failure" };
  fail = true;
  const failed = await send(failureArgs);
  assert.equal(failed.ok, false);
  assert.match(failed.error, /applied in the editor but save failed/);
  assert.ok(editor.value.endsWith("\nRetained on failure"));
  assert.ok(!disk.notes[0].content.includes("Retained on failure"));
  assert.equal(document.getElementById("save-status").textContent, "Save failed");
  fail = false;
  assert.equal((await send(failureArgs)).ok, true);
  assert.equal(disk.notes[0].content.match(/Retained on failure/g).length, 1);
  assert.equal(document.getElementById("save-status").classList.contains("unsaved"), false);

  // Verify persisted content after reopening the database, and stale collection protection.
  app.click("db-disconnect-btn");
  await settle(100);
  assert.equal((await send(failureArgs)).ok, false);
  app.click("db-connect-btn");
  await settle(100);
  assert.equal(editor.value, disk.notes[0].content);
  app.click("mcp-permission-append_to_note");
  await settle();
  assert.equal(document.getElementById("mcp-permissions-summary").textContent, "5 read · 2 write functions enabled");
  assert.equal((await send({ ...failureArgs, collectionId: snapshot().collectionId })).ok, false);
});
