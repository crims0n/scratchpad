// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

const note = { id: "valuable", title: "Kept note", content: "valuable body", updatedAt: 1, isTitleLocked: true, folderId: "work" };
const folders = [{ id: "work", name: "Work" }];
const deleted = { id: "deleted", note: { ...note, id: "trashed" }, deletedAt: 2 };
let instance = 400;
const boot = options => bootApp({ ...options, instance: ++instance });
const dispose = app => { app.dom.window.dispatchEvent(new app.dom.window.Event("pagehide")); app.dom.window.close(); };

test("malformed local notes survive startup, legacy adoption, actions, close, and relaunch", async () => {
  const original = JSON.stringify([note]).slice(0, -1);
  let closeHandler;
  let destroyed = false;
  const app = await boot({ storage: { scratchpad_notes: original, scratchpad_folders: folders,
    scratchpad_trash: [deleted], scratchpad_local_notes: [note] },
    windowApi: { getCurrentWindow: () => ({ onCloseRequested: async handler => { closeHandler = handler; },
      destroy: async () => { destroyed = true; } }) } });
  const document = app.dom.window.document;
  assert.equal(document.getElementById("local-recovery-banner").hidden, false);
  assert.equal(document.getElementById("save-status").textContent, "Recovery required");
  assert.deepEqual(app.sidebarTitles(), []);
  app.click("new-note-btn");
  document.dispatchEvent(new app.dom.window.KeyboardEvent("keydown", { key: "n", ctrlKey: true, bubbles: true }));
  app.click("local-recovery-replace-btn");
  assert.equal(document.getElementById("local-recovery-confirmation").hidden, false);
  assert.equal(document.activeElement.id, "local-recovery-cancel-btn");
  app.click("local-recovery-cancel-btn");
  assert.equal(document.getElementById("local-recovery-confirmation").hidden, true);
  assert.equal(app.storage.getItem("scratchpad_notes"), original);
  assert.deepEqual(app.read("scratchpad_local_notes"), [note]);
  await closeHandler({ preventDefault() {} });
  assert.equal(destroyed, true, "read-only recovery does not trap the user in the window");
  const saved = app.dumpStorage();
  dispose(app);
  const second = await boot({ storage: saved });
  assert.equal(second.storage.getItem("scratchpad_notes"), original);
  assert.deepEqual(second.read("scratchpad_folders"), folders);
  assert.deepEqual(second.read("scratchpad_trash"), [deleted]);
  assert.deepEqual(second.sidebarTitles(), []);
  assert.equal(second.dom.window.document.getElementById("local-recovery-banner").hidden, false);
  dispose(second);
});

test("bad folders keep valid notes read-only, reject MCP mutations, and isolate workspace edits", async () => {
  const rawFolders = "[{ recoverable folders";
  const originalNotes = JSON.stringify([note]);
  const app = await boot({ storage: { scratchpad_notes: originalNotes, scratchpad_folders: rawFolders, scratchpad_trash: [deleted] },
    handlers: { start_mcp_server: () => ({ command: "/scratchpad", args: ["--mcp-stdio"] }),
      select_db_file: () => "/tmp/local-recovery.db", load_db_notes: () => [{ ...note, id: "workspace", title: "Workspace" }] } });
  const document = app.dom.window.document;
  assert.deepEqual(app.sidebarTitles(), ["Kept note"]);
  assert.equal(document.getElementById("editor-textarea").readOnly, true);
  assert.equal(document.querySelector(".note-item-delete").disabled, true);
  await app.type("Must not overwrite");
  document.dispatchEvent(new app.dom.window.KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }));
  app.click("agent-access-toggle-btn");
  await app.settle();
  app.click("mcp-permission-create_note");
  await app.settle();
  const collectionId = app.invocations.findLast(i => i.command === "update_mcp_snapshot").args.collectionId;
  await app.emit("mcp-write-request", { ticket: "blocked", operation: "create_note",
    arguments: { collectionId, requestId: "blocked", title: "Agent note" } });
  assert.equal(app.invocations.findLast(i => i.command === "complete_mcp_write").args.result.ok, false);
  assert.deepEqual(app.sidebarTitles(), ["Kept note"]);
  app.click("trash-btn");
  assert.match(document.getElementById("trash-status").textContent, /needs recovery/);
  app.click("close-trash-btn");
  app.click("db-connect-btn");
  await app.settle(100);
  assert.deepEqual(app.sidebarTitles(), ["Workspace"]);
  assert.equal(document.getElementById("editor-textarea").readOnly, false);
  await app.type("Healthy workspace edit");
  assert.ok(app.invocations.some(i => i.command === "save_note_db" && i.args.note.content === "Healthy workspace edit"));
  app.click("db-disconnect-btn");
  await app.settle(100);
  assert.deepEqual(app.sidebarTitles(), ["Kept note"]);
  assert.equal(document.getElementById("editor-textarea").readOnly, true);
  assert.equal(app.storage.getItem("scratchpad_notes"), originalNotes);
  assert.equal(app.storage.getItem("scratchpad_folders"), rawFolders);
  assert.deepEqual(app.read("scratchpad_trash"), [deleted]);
  const saved = app.dumpStorage();
  dispose(app);
  const next = await boot({ storage: saved });
  assert.equal(next.storage.getItem("scratchpad_folders"), rawFolders);
  assert.equal(next.storage.getItem("scratchpad_notes"), originalNotes);
  assert.equal(next.dom.window.document.getElementById("editor-textarea").readOnly, true);
  dispose(next);
});

test("export handles success, cancellation, and failure without replacing source data", async () => {
  const original = "{ valuable fragment";
  let result = "success";
  let exported;
  const app = await boot({ storage: { scratchpad_notes: original }, handlers: {
    save_recovery_file_native: ({ content, defaultName }) => {
      assert.equal(defaultName, "scratchpad-local-recovery.json");
      exported = JSON.parse(content);
      if (result !== "success") throw result;
      return "/tmp/recovery.json";
    }
  } });
  const status = () => app.dom.window.document.getElementById("local-recovery-action-status").textContent;
  for (const outcome of ["success", "Cancelled", "Disk full"]) {
    result = outcome;
    app.click("local-recovery-export-btn");
    await app.settle();
    assert.equal(exported.values.scratchpad_notes, original);
    assert.equal(app.storage.getItem("scratchpad_notes"), original);
    assert.match(status(), outcome === "success" ? /exported/ : outcome === "Cancelled" ? /cancelled/ : /Could not export/);
  }
  dispose(app);
});

test("explicit replacement keeps trash, archives raw data across launches, and resumes editing", async () => {
  const raw = "{ precious notes";
  const app = await boot({ storage: { scratchpad_notes: raw, scratchpad_folders: folders, scratchpad_trash: [deleted] } });
  app.click("local-recovery-replace-btn");
  app.click("local-recovery-confirm-btn");
  await app.settle(100);
  assert.deepEqual(app.sidebarTitles(), ["Welcome to Scratchpad!"]);
  assert.equal(JSON.parse(app.storage.getItem("scratchpad_local_recovery")).values.scratchpad_notes, raw);
  assert.deepEqual(app.read("scratchpad_folders"), folders);
  assert.deepEqual(app.read("scratchpad_trash"), [deleted]);
  assert.equal(app.dom.window.document.getElementById("editor-textarea").readOnly, false);
  await app.type("New collection text");
  const saved = app.dumpStorage();
  dispose(app);
  const next = await boot({ storage: saved });
  assert.equal(next.read("scratchpad_notes")[0].content, "New collection text");
  assert.equal(JSON.parse(next.storage.getItem("scratchpad_local_recovery")).values.scratchpad_notes, raw);
  assert.equal(next.dom.window.document.getElementById("local-recovery-export-btn").hidden, false);
  dispose(next);
});

test("invalid parsed note shapes and records are preserved on a second launch", async () => {
  for (const original of ["{}", "null", "[null]", JSON.stringify([{ ...note, content: null }])]) {
    const app = await boot({ storage: { scratchpad_notes: original } });
    assert.deepEqual(app.sidebarTitles(), []);
    const saved = app.dumpStorage();
    dispose(app);
    const next = await boot({ storage: saved });
    assert.equal(next.storage.getItem("scratchpad_notes"), original);
    assert.equal(next.dom.window.document.getElementById("editor-textarea").readOnly, true);
    dispose(next);
  }
});

test("storage read errors surface recovery and can be retried without replacement", async () => {
  let unavailable = true;
  const app = await boot({ storage: { scratchpad_notes: [note], scratchpad_folders: folders },
    beforeBoot: window => {
      const read = window.Storage.prototype.getItem;
      window.Storage.prototype.getItem = function(key) {
        if (unavailable && key === "scratchpad_notes") throw new Error("Read unavailable");
        return read.call(this, key);
      };
    } });
  assert.equal(app.dom.window.document.getElementById("local-recovery-banner").hidden, false);
  assert.deepEqual(app.sidebarTitles(), []);
  app.click("local-recovery-replace-btn");
  app.click("local-recovery-confirm-btn");
  await app.settle();
  assert.match(app.dom.window.document.getElementById("local-recovery-action-status").textContent, /retry reading/);
  unavailable = false;
  assert.deepEqual(app.read("scratchpad_notes"), [note]);
  app.click("local-recovery-retry-btn");
  await app.settle();
  assert.deepEqual(app.sidebarTitles(), ["Kept note"]);
  assert.equal(app.dom.window.document.getElementById("local-recovery-banner").hidden, true);
  assert.equal(app.dom.window.document.getElementById("editor-textarea").readOnly, false);
  assert.equal(app.storage.getItem("scratchpad_local_recovery"), null);
  dispose(app);
});

test("replacement write failures show errors and retain the original across relaunch", async () => {
  const raw = "{ notes with valuable text";
  for (const failKey of ["scratchpad_local_recovery", "scratchpad_notes"]) {
    const app = await boot({ storage: { scratchpad_notes: raw }, beforeBoot: window => {
      const write = window.Storage.prototype.setItem;
      window.Storage.prototype.setItem = function(key, value) {
        if (key === failKey) throw new Error("Storage full");
        return write.call(this, key, value);
      };
    } });
    app.click("local-recovery-replace-btn");
    app.click("local-recovery-confirm-btn");
    await app.settle();
    assert.match(app.dom.window.document.getElementById("local-recovery-action-status").textContent, /Could not recover.*Storage full/);
    assert.equal(app.dom.window.document.getElementById("editor-textarea").readOnly, true);
    assert.equal(app.storage.getItem("scratchpad_notes"), raw);
    const saved = app.dumpStorage();
    dispose(app);
    const next = await boot({ storage: saved });
    assert.equal(next.storage.getItem("scratchpad_notes"), raw);
    assert.deepEqual(next.sidebarTitles(), []);
    dispose(next);
  }
});

test("empty remembered workspaces do not seed from a damaged local collection", async () => {
  for (const failSeed of [false, true]) {
    const raw = "{ folders";
    const app = await boot({ storage: { scratchpad_notes: [note], scratchpad_folders: raw }, handlers: {
      load_workspace_preference: () => "/tmp/empty-recovery-workspace.db",
      load_db_notes: () => [],
      save_workspace_db: () => { if (failSeed) throw new Error("Read only"); }
    } });
    const seed = app.invocations.find(i => i.command === "save_workspace_db");
    assert.deepEqual(seed.args.folders, []);
    assert.equal(seed.args.notes.some(n => n.id === note.id), false);
    assert.deepEqual(app.sidebarTitles(), failSeed ? ["Kept note"] : ["Welcome to Scratchpad!"]);
    assert.equal(app.dom.window.document.getElementById("editor-textarea").readOnly, failSeed);
    assert.deepEqual(app.read("scratchpad_notes"), [note]);
    assert.equal(app.storage.getItem("scratchpad_folders"), raw);
    dispose(app);
  }
});

test("a failed welcome-note save after replacement is not reported as saved", async () => {
  const raw = "{ original data";
  const app = await boot({ storage: { scratchpad_notes: raw }, beforeBoot: window => {
    const write = window.Storage.prototype.setItem;
    window.Storage.prototype.setItem = function(key, value) {
      if (key === "scratchpad_notes" && value !== "[]") throw new Error("Quota exceeded");
      return write.call(this, key, value);
    };
  } });
  app.click("local-recovery-replace-btn");
  app.click("local-recovery-confirm-btn");
  await app.settle();
  assert.equal(app.dom.window.document.getElementById("save-status").textContent, "Save failed");
  assert.equal(app.storage.getItem("scratchpad_notes"), "[]");
  assert.equal(JSON.parse(app.storage.getItem("scratchpad_local_recovery")).values.scratchpad_notes, raw);
  dispose(app);
});
