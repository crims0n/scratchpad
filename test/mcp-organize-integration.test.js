// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, settle } from "./helpers/app-harness.js";

for (const database of [false, true]) {
  test(`MCP organization persists in ${database ? "SQLite workspaces" : "local storage"} and keeps the editor synchronized`, async () => {
    const seed = { id: "n", title: "Original", content: "Original body", updatedAt: 1, isTitleLocked: false, isPinned: true, folderId: null };
    const seedFolders = [{ id: "f", name: "Work" }];
    let disk = { notes: [seed], folders: seedFolders };
    let hold = null;
    let fail = false;
    const app = await bootApp({ instance: database ? 2 : 1, storage: { scratchpad_notes: [seed], scratchpad_folders: seedFolders }, handlers: {
      start_mcp_server: () => ({ command: "/scratchpad", args: ["--mcp-stdio"] }),
      select_db_file: () => "/tmp/mcp-organize.db",
      load_db_notes: () => structuredClone(disk.notes),
      load_db_folders: () => structuredClone(disk.folders),
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
    } });
    const stored = () => database ? disk : { notes: app.read("scratchpad_notes"), folders: app.read("scratchpad_folders") };
    if (database) { app.click("db-connect-btn"); await settle(100); }
    app.click("agent-access-toggle-btn");
    await settle();
    // Register the write bridge with an unrelated permission to exercise denials.
    app.click("mcp-permission-create_note");
    await settle();
    const snapshot = () => app.invocations.findLast(i => i.command === "update_mcp_snapshot").args;
    let ticket = 0;
    const send = async (operation, args) => {
      const id = String(++ticket);
      await app.emit("mcp-write-request", { ticket: id, operation, arguments: args });
      return app.invocations.findLast(i => i.command === "complete_mcp_write" && i.args.ticket === id).args.result;
    };
    const args = (operation, requestId, extra) => ({ collectionId: snapshot().collectionId, requestId,
      ...(operation === "rename_folder" ? { folderId: "f", expectedRevision: snapshot().folderRevisions.f }
        : { noteId: "n", expectedRevision: snapshot().noteRevisions.n }), ...extra });
    const editor = document.getElementById("editor-textarea");
    for (const [operation, extra] of [["rename_note", { title: "Agent title" }], ["move_note", { folderId: "f" }], ["rename_folder", { name: "Projects" }]]) {
      assert.equal((await send(operation, args(operation, `denied-${operation}`, extra))).ok, false);
      app.click(`mcp-permission-${operation}`);
      await settle();
      editor.focus(); editor.setSelectionRange(2, 6);
      const request = args(operation, operation, extra);
      const result = await send(operation, request);
      assert.equal(result.ok, true, result.error);
      assert.equal(document.activeElement, editor);
      assert.equal(editor.selectionStart, 2);
      assert.equal(editor.selectionEnd, 6);
      assert.equal(editor.value, "Original body");
      assert.deepEqual(await send(operation, request), result);
      assert.equal(document.getElementById("note-title").value, "Agent title");
      assert.equal(document.querySelector('#secondary-note-select option[value="n"]').textContent, "Agent title");
      assert.equal(stored().notes[0].content, "Original body");
      assert.equal(stored().notes[0].isPinned, true);
      if (operation === "rename_note") assert.equal(stored().notes[0].isTitleLocked, true);
      if (operation === "move_note") assert.equal(stored().notes[0].folderId, "f");
      if (operation === "rename_folder") {
        assert.equal(stored().folders[0].name, "Projects");
        assert.equal(stored().folders[0].id, "f");
        assert.equal(stored().notes[0].folderId, "f");
        assert.equal(snapshot().folderRevisions.f, result.revision);
        assert.match(document.getElementById("note-list").textContent, /Projects/);
      }
    }
    const topArgs = args("move_note", "top", { folderId: null });
    const top = await send("move_note", topArgs);
    assert.equal(top.ok, true);
    assert.equal(stored().notes[0].folderId, null);
    const stale = args("rename_note", "stale", { title: "Stale rename" });
    editor.value += " typed";
    editor.dispatchEvent(new app.dom.window.Event("input"));
    assert.match((await send("rename_note", stale)).error, /Revision conflict/);
    assert.equal(document.getElementById("note-title").value, "Agent title", "manual MCP title stays locked during typing");
    await settle(600);
    await send("move_note", topArgs); // Retry refreshes the full snapshot after typing.

    if (database) {
      // Every metadata mutation remains visible on save failure; retry persists later user changes.
      for (const [operation, extra] of [["rename_note", { title: "Saved retry title" }], ["move_note", { folderId: "f" }], ["rename_folder", { name: "Saved retry folder" }]]) {
        // Refresh both revision maps after debounced typing.
        await send("move_note", { ...args("move_note", "refresh", { folderId: null }), requestId: `refresh-${operation}` });
        const request = args(operation, `failure-${operation}`, extra);
        fail = true;
        const before = structuredClone(disk);
        assert.match((await send(operation, request)).error, /applied in the editor but save failed/);
        assert.deepEqual(disk, before);
        assert.equal(document.getElementById("save-status").textContent, "Save failed");
        fail = false;
        assert.equal((await send(operation, request)).ok, true);
        assert.equal(document.getElementById("save-status").classList.contains("unsaved"), false);
      }
      hold = {};
      const request = args("rename_note", "concurrent", { title: "Concurrent rename" });
      const pending = send("rename_note", request);
      await settle(20);
      assert.equal(document.getElementById("note-title").value, "Concurrent rename");
      editor.value += " during save";
      editor.dispatchEvent(new app.dom.window.Event("input"));
      const release = hold.release; hold = null; release();
      assert.equal((await pending).ok, true);
      await settle(600);
      assert.equal(disk.notes[0].content, editor.value);
      assert.equal(disk.notes[0].title, "Concurrent rename");
      app.click("db-disconnect-btn"); await settle(100);
      app.click("db-connect-btn"); await settle(100);
      assert.equal(editor.value, disk.notes[0].content);
      assert.equal(document.getElementById("note-title").value, "Concurrent rename");
      assert.equal(snapshot().folders[0].name, "Saved retry folder");
    }
    app.dom.window.close();
  });
}
