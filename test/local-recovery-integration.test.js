// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { marked } from "marked";
import { getAppElement, bootApp } from "./helpers/app-harness.js";

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
  assert.equal(getAppElement("editor").readOnly, true);
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
  assert.equal(getAppElement("editor").readOnly, false);
  await app.type("Healthy workspace edit");
  assert.ok(app.invocations.some(i => i.command === "save_note_db" && i.args.note.content === "Healthy workspace edit"));
  app.click("db-disconnect-btn");
  await app.settle(100);
  assert.deepEqual(app.sidebarTitles(), ["Kept note"]);
  assert.equal(getAppElement("editor").readOnly, true);
  assert.equal(app.storage.getItem("scratchpad_notes"), originalNotes);
  assert.equal(app.storage.getItem("scratchpad_folders"), rawFolders);
  assert.deepEqual(app.read("scratchpad_trash"), [deleted]);
  const saved = app.dumpStorage();
  dispose(app);
  const next = await boot({ storage: saved });
  assert.equal(next.storage.getItem("scratchpad_folders"), rawFolders);
  assert.equal(next.storage.getItem("scratchpad_notes"), originalNotes);
  assert.equal(getAppElement("editor").readOnly, true);
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
    assert.equal(exported.current.values.scratchpad_notes, original);
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
  assert.equal(JSON.parse(app.recoveryCopies[0]).values.scratchpad_notes, raw);
  assert.equal(app.storage.getItem("scratchpad_local_recovery"), null);
  assert.deepEqual(app.read("scratchpad_folders"), folders);
  assert.deepEqual(app.read("scratchpad_trash"), [deleted]);
  assert.equal(getAppElement("editor").readOnly, false);
  await app.type("New collection text");
  const saved = app.dumpStorage();
  dispose(app);
  const next = await boot({ storage: saved, recoveryCopies: app.recoveryCopies });
  assert.equal(next.read("scratchpad_notes")[0].content, "New collection text");
  assert.equal(JSON.parse(next.recoveryCopies[0]).values.scratchpad_notes, raw);
  assert.equal(next.dom.window.document.getElementById("local-recovery-banner").hidden, false);
  assert.equal(next.dom.window.document.getElementById("local-recovery-export-btn").hidden, false);
  next.click("local-recovery-export-btn");
  await next.settle();
  const exported = JSON.parse(next.invocations.findLast(i => i.command === "save_recovery_file_native").args.content);
  assert.equal(exported.current, null);
  assert.equal(JSON.parse(exported.preservedCopies[0]).values.scratchpad_notes, raw);
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
    assert.equal(getAppElement("editor").readOnly, true);
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
  assert.equal(getAppElement("editor").readOnly, false);
  assert.equal(app.storage.getItem("scratchpad_local_recovery"), null);
  dispose(app);
});

test("replacement write failures show errors and retain the original across relaunch", async () => {
  const raw = "{ notes with valuable text";
  for (const failKey of ["archive", "scratchpad_notes"]) {
    const app = await boot({ storage: { scratchpad_notes: raw },
      handlers: failKey === "archive" ? { archive_local_recovery: () => { throw new Error("Storage full"); } } : {},
      beforeBoot: window => {
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
    assert.equal(getAppElement("editor").readOnly, true);
    assert.equal(app.storage.getItem("scratchpad_notes"), raw);
    const saved = app.dumpStorage();
    dispose(app);
    const next = await boot({ storage: saved, recoveryCopies: app.recoveryCopies });
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
    assert.equal(getAppElement("editor").readOnly, failSeed);
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
  assert.equal(JSON.parse(app.recoveryCopies[0]).values.scratchpad_notes, raw);
  dispose(app);
});

test("connecting a populated workspace clears the quarantine unsaved class without a save", async () => {
  const app = await boot({ storage: { scratchpad_notes: "{ local notes" }, handlers: {
    select_db_file: () => "/tmp/status-recovery.db", load_db_notes: () => [note]
  } });
  const status = app.dom.window.document.getElementById("save-status");
  assert.equal(status.classList.contains("unsaved"), true);
  app.click("db-connect-btn");
  await app.settle(2200); // Allow the connection notification to restore the Saved label.
  assert.equal(status.textContent, "Saved (status-recovery.db)");
  assert.equal(status.classList.contains("unsaved"), false);
  assert.equal(app.invocations.some(i => i.command === "save_note_db" || i.command === "save_workspace_db"), false);
  dispose(app);
});

test("disconnecting to quarantined empty notes clears previews, backdrops, and counts", async () => {
  for (const layout of ["preview", "split"]) {
    const app = await boot({ globals: { marked }, storage: {
      scratchpad_notes: "{ local notes", scratchpad_layout_mode: layout
    }, handlers: { load_workspace_preference: () => "/tmp/preview-recovery.db",
      load_db_notes: () => [{ ...note, content: "# Workspace heading\n\nWorkspace body" },
        { ...note, id: "second", content: "# Other workspace heading\n\nOther body" }] } });
    const document = app.dom.window.document;
    assert.match(document.getElementById("markdown-preview").textContent, /Workspace heading/);
    app.click("split-note-btn");
    app.click("compare-notes-btn");
    assert.match(document.getElementById("secondary-markdown-preview").textContent, /Other workspace heading/);
    document.dispatchEvent(new app.dom.window.KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }));
    document.getElementById("find-input").value = "Workspace";
    document.getElementById("find-input").dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
    app.click("db-disconnect-btn");
    await app.settle(100);
    const assertEmpty = () => {
      assert.deepEqual(app.sidebarTitles(), []);
      for (const id of ["markdown-preview", "secondary-markdown-preview"]) {
        assert.equal(getAppElement(id).textContent, "", id);
      }
      for (const id of ["editor", "secondary-editor", "note-title", "secondary-note-title"]) {
        assert.equal(getAppElement(id).value, "", id);
      }
      assert.equal(document.getElementById("word-char-count").textContent, "0 words • 0 characters");
      assert.equal(document.getElementById("find-count").textContent, "0 of 0");
      assert.equal(document.getElementById("compare-notes-btn").getAttribute("aria-pressed"), "false");
    };
    assertEmpty();
    app.click("local-recovery-retry-btn");
    await app.settle(100);
    assertEmpty();
    dispose(app);
  }
});

test("switching or closing while archiving cannot reset the quarantined source", async () => {
  for (const action of ["connect", "close"]) {
    let release;
    let started;
    let closeHandler;
    let destroyed = false;
    const pending = new Promise(resolve => { release = resolve; });
    const archiving = new Promise(resolve => { started = resolve; });
    const copies = [];
    const raw = "{ original local notes";
    const app = await boot({ storage: { scratchpad_notes: raw }, recoveryCopies: copies,
      windowApi: { getCurrentWindow: () => ({ onCloseRequested: async handler => { closeHandler = handler; },
        destroy: async () => { destroyed = true; } }) },
      handlers: { archive_local_recovery: async ({ content }) => {
        started();
        await pending;
        copies.push(content);
        return "/tmp/recovery.json";
      }, select_db_file: () => "/tmp/racing-recovery.db", load_db_notes: () => [note] }
    });
    app.click("local-recovery-replace-btn");
    app.click("local-recovery-confirm-btn");
    await archiving;
    let closing;
    if (action === "connect") app.click("db-connect-btn");
    else closing = closeHandler({ preventDefault() {} });
    release();
    await closing;
    await app.settle(100);
    assert.equal(app.storage.getItem("scratchpad_notes"), raw);
    assert.equal(JSON.parse(copies[0]).values.scratchpad_notes, raw);
    assert.match(app.dom.window.document.getElementById("local-recovery-action-status").textContent, /changed or is closing/);
    if (action === "connect") assert.deepEqual(app.sidebarTitles(), ["Kept note"]);
    else assert.equal(destroyed, true);
    dispose(app);
  }
});

test("large quarantined sources recover through native archives and export after relaunch", async () => {
  const raw = '{"content":"' + '"'.repeat(2200000);
  const app = await boot({ storage: { scratchpad_notes: raw } });
  app.click("local-recovery-replace-btn");
  app.click("local-recovery-confirm-btn");
  await app.settle(100);
  assert.equal(getAppElement("editor").readOnly, false);
  assert.deepEqual(app.sidebarTitles(), ["Welcome to Scratchpad!"]);
  assert.equal(JSON.parse(app.recoveryCopies[0]).values.scratchpad_notes, raw);
  const saved = app.dumpStorage();
  dispose(app);
  const next = await boot({ storage: saved, recoveryCopies: app.recoveryCopies });
  next.click("local-recovery-export-btn");
  await next.settle();
  const exported = JSON.parse(next.invocations.findLast(i => i.command === "save_recovery_file_native").args.content);
  assert.equal(JSON.parse(exported.preservedCopies[0]).values.scratchpad_notes, raw);
  dispose(next);
});

test("archive discovery failure is visible and export can retry reading preserved files", async () => {
  const copy = JSON.stringify({ schemaVersion: 1, kind: "scratchpad-local-recovery",
    values: { scratchpad_notes: "{ original" } });
  const app = await boot({ storage: { scratchpad_notes: [note] }, recoveryCopies: [copy], handlers: {
    has_local_recovery_copies: () => { throw new Error("Temporarily unavailable"); }
  } });
  const document = app.dom.window.document;
  assert.equal(document.getElementById("local-recovery-banner").hidden, false);
  assert.match(document.getElementById("local-recovery-action-status").textContent, /Could not check/);
  assert.equal(getAppElement("editor").readOnly, false);
  app.click("local-recovery-export-btn");
  await app.settle();
  assert.match(document.getElementById("local-recovery-action-status").textContent, /exported/);
  assert.equal(document.getElementById("local-recovery-banner").hidden, false);
  assert.match(document.getElementById("local-recovery-message").textContent, /copy.*preserved/);
  dispose(app);
});
