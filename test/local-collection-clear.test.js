// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { getAppElement, bootApp } from "./helpers/app-harness.js";
import { parseBackup, serializeBackup } from "../src/collection-backup.js";

const note = id => ({ id, title: id, content: id, updatedAt: 100, isTitleLocked: true, isPinned: false, folderId: null });
const collection = { notes: [note("one"), { ...note("two"), folderId: "folder" }],
  folders: [{ id: "folder", name: "Folder" }, { id: "empty", name: "Empty" }],
  trash: [{ id: "deleted", note: note("gone"), deletedAt: 200, folderName: null }] };
const empty = { notes: [], folders: [], trash: [] };
const seed = value => ({ scratchpad_notes: value.notes, scratchpad_folders: value.folders, scratchpad_trash: value.trash });
const local = app => ({ notes: app.read("scratchpad_notes"), folders: app.read("scratchpad_folders"), trash: app.read("scratchpad_trash") });
const settings = app => Object.fromEntries(Object.entries(app.dumpStorage()).filter(([key]) => !Object.keys(seed(empty)).includes(key)));
let instance = 1000;
function native() {
  let pending = null;
  const copies = [];
  return { copies, pending: () => pending, handlers: {
    read_local_restore: () => pending,
    begin_local_restore: ({ values, content }) => { copies.push(content); pending = values; return "/tmp/clear-safety.json"; },
    complete_local_restore: () => { pending = null; }
  } };
}
const boot = (bridge, options = {}) => bootApp({ instance: ++instance,
  storage: { ...seed(collection), scratchpad_editor_zoom: "1.2", scratchpad_custom_themes: "[]",
    scratchpad_collapsed_folders: '["empty"]', unrelated_key: "keep", ...options.storage },
  ...options, handlers: { ...bridge.handlers, ...options.handlers } });
async function open(app) { app.click("local-clear-btn"); await app.settle(); }
function type(text) {
  const input = document.getElementById("local-clear-confirmation");
  input.value = text;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}
async function clear(app) { await open(app); type("DELETE"); app.click("local-clear-confirm"); await app.settle(); }
async function close(app) { app.click("local-clear-cancel"); await app.settle(); app.dom.window.close(); }

test("exact DELETE is required, checked again on click, and discarded by Cancel/Escape/reopening", async () => {
  const bridge = native(), app = await boot(bridge), before = app.dumpStorage();
  await open(app);
  assert.match(document.getElementById("local-clear-status").textContent, /2 notes, 2 folders, 1 trash entry/);
  const confirm = document.getElementById("local-clear-confirm");
  for (const value of ["", "delete", "Delete", "DELET", "DELETE ", " DELETE", "DELETE!"]) {
    type(value);
    assert.equal(confirm.disabled, true);
    confirm.click();
    confirm.onclick();
    assert.equal(bridge.copies.length, 0);
    assert.deepEqual(app.dumpStorage(), before);
  }
  type("DELETE");
  assert.equal(confirm.disabled, false);
  document.getElementById("local-clear-confirmation").value = "not confirmed";
  confirm.onclick();
  assert.equal(bridge.copies.length, 0, "the click guard must not trust a stale enabled button");
  type("DELETE");
  app.click("local-clear-cancel"); await app.settle();
  assert.deepEqual(app.dumpStorage(), before);
  await open(app);
  assert.equal(document.getElementById("local-clear-confirmation").value, "");
  assert.equal(confirm.disabled, true);
  document.getElementById("local-clear-cancel").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await app.settle();
  assert.equal(document.getElementById("local-clear-backdrop").style.display, "none");
  assert.equal(document.activeElement.id, "actions-btn");
  assert.deepEqual(app.dumpStorage(), before);
  app.dom.window.close();
});

test("clear saves both pending panes, preserves a complete backup and all settings, and remains empty after restart", async () => {
  const bridge = native(), app = await boot(bridge);
  app.click("split-note-btn");
  const select = document.getElementById("secondary-note-select");
  select.value = "two";
  select.dispatchEvent(new window.Event("change"));
  for (const [id, text] of [["editor", "pending primary"], ["secondary-editor", "pending secondary"]]) {
    const field = getAppElement(id);
    field.value = text;
    field.dispatchEvent(new window.Event("input"));
  }
  const retained = settings(app);
  await clear(app);
  const backup = parseBackup(bridge.copies[0]);
  assert.deepEqual(backup.notes.map(n => n.content), ["pending primary", "pending secondary"]);
  assert.deepEqual(backup.folders, collection.folders);
  assert.deepEqual(backup.trash, collection.trash);
  assert.deepEqual(local(app), empty);
  assert.deepEqual(settings(app), retained);
  assert.equal(bridge.pending(), null);
  assert.match(document.getElementById("local-clear-status").textContent, /notes, folders, and trash cleared/);
  assert.match(document.getElementById("local-clear-safety").textContent, /clear-safety.json.*\n\nUse Restore Collection/);
  assert.equal(document.getElementById("local-clear-instructions").hidden, true);
  assert.equal(document.getElementById("local-clear-confirm").hidden, true);
  assert.equal(document.getElementById("local-clear-confirmation").value, "");
  const disk = app.dumpStorage();
  await close(app);
  const restarted = await boot(bridge, { storage: disk });
  assert.deepEqual(local(restarted), empty);
  assert.deepEqual(restarted.sidebarTitles(), []);
  for (const id of ["editor", "note-title", "secondary-editor", "secondary-note-title"]) {
    assert.equal(getAppElement(id).readOnly, true);
    assert.equal(getAppElement(id).value, "");
  }
  assert.equal(document.getElementById("empty-collection-prompt").hidden, false);
  restarted.dom.window.close();
});

test("cancel resumes only the edits already pending without creating a safety backup", async () => {
  const bridge = native(), app = await boot(bridge);
  const editor = getAppElement("editor");
  editor.value = "pending edit";
  editor.dispatchEvent(new window.Event("input"));
  await open(app);
  app.click("local-clear-cancel"); await app.settle();
  assert.equal(bridge.copies.length, 0);
  assert.deepEqual(local(app), collection);
  await app.settle(500);
  assert.equal(app.read("scratchpad_notes")[0].content, "pending edit");
  app.dom.window.close();
});

test("workspace mode, corrupt local data/trash, browser mode, and leftover legacy notes cannot be cleared", async () => {
  for (const scenario of [
    { handlers: { load_workspace_preference: () => "/tmp/workspace.db", load_db_notes: () => [note("workspace")], load_db_folders: () => [], load_db_trash: () => [] } },
    { storage: { ...seed(collection), scratchpad_notes: "{ damaged" } },
    { storage: { ...seed(collection), scratchpad_trash: "{ damaged" } },
    { browser: true },
    { legacy: true }
  ]) {
    const bridge = native(), app = await boot(bridge, scenario);
    if (scenario.browser) delete window.__TAURI__;
    if (scenario.legacy) app.storage.setItem("scratchpad_local_notes", JSON.stringify([note("legacy")]));
    const before = app.dumpStorage();
    await open(app);
    assert.equal(bridge.copies.length, 0);
    assert.deepEqual(app.dumpStorage(), before);
    assert.equal(app.invocations.some(call => call.command === "save_workspace_db"), false);
    if (scenario.legacy) {
      assert.match(document.getElementById("local-clear-status").textContent, /set-aside notes still need migration/);
      await close(app);
    } else {
      assert.equal(document.getElementById("local-clear-backdrop").style.display, "none");
      app.dom.window.close();
    }
  }
});

test("pending-save and safety-checkpoint failures do not clear data or leave stale confirmation", async () => {
  for (const failure of ["flush", "begin", "invalid-path"]) {
    const bridge = native();
    const app = await boot(bridge, { handlers: failure === "begin" ? {
      begin_local_restore: () => { throw new Error("disk full"); }
    } : failure === "invalid-path" ? { begin_local_restore: () => "" } : {} });
    const proto = Object.getPrototypeOf(app.storage), originalSet = proto.setItem;
    if (failure === "flush") proto.setItem = function(key, value) {
      if (key === "scratchpad_notes") throw new Error("quota exceeded");
      return originalSet.call(this, key, value);
    };
    try {
      await clear(app);
      assert.match(document.getElementById("local-clear-status").textContent, /Could not clear/);
      assert.deepEqual(local(app), collection);
      assert.equal(document.getElementById("local-clear-confirm").hidden, true);
      assert.equal(document.getElementById("local-clear-confirmation").value, "");
      assert.equal(document.getElementById("local-clear-instructions").hidden, true);
      assert.equal(bridge.copies.length, 0);
    } finally { proto.setItem = originalSet; await close(app); }
  }
});

test("a failure at each clear write rolls back and retains the restorable safety copy", async () => {
  for (let failedWrite = 1; failedWrite <= 3; failedWrite++) {
    const bridge = native(), app = await boot(bridge), retained = settings(app);
    const proto = Object.getPrototypeOf(app.storage), originalSet = proto.setItem;
    let writes = 0;
    proto.setItem = function(key, value) {
      if (bridge.pending() && ++writes === failedWrite) throw new Error("write failed");
      return originalSet.call(this, key, value);
    };
    try {
      await clear(app);
      assert.match(document.getElementById("local-clear-status").textContent, /Could not clear.*write failed/);
      assert.deepEqual(local(app), collection);
      assert.deepEqual(parseBackup(bridge.copies[0]), collection);
      assert.deepEqual(settings(app), retained);
      assert.equal(bridge.pending(), null);
    } finally { proto.setItem = originalSet; await close(app); }
  }
});

test("failed rollback quarantines local data, and restart recovers the pre-clear collection", async () => {
  const bridge = native(), app = await boot(bridge);
  const proto = Object.getPrototypeOf(app.storage), originalSet = proto.setItem;
  let writes = 0;
  proto.setItem = function(key, value) {
    if (bridge.pending() && ++writes >= 2) throw new Error("storage unavailable");
    return originalSet.call(this, key, value);
  };
  let disk;
  try {
    await clear(app);
    assert.ok(bridge.pending());
    assert.match(document.getElementById("local-clear-status").textContent, /read-only until checkpoint recovery/);
    disk = app.dumpStorage();
    app.click("local-clear-cancel"); await app.settle();
    assert.equal(getAppElement("editor").readOnly, true);
    app.dom.window.close();
  } finally { proto.setItem = originalSet; }
  const restarted = await boot(bridge, { storage: disk });
  assert.deepEqual(local(restarted), collection);
  assert.equal(bridge.pending(), null);
  restarted.dom.window.close();
});

test("finalization failure after marker removal reloads the written empty collection without unsafe rollback", async () => {
  const bridge = native(), complete = bridge.handlers.complete_local_restore;
  const app = await boot(bridge, { handlers: { complete_local_restore: () => { complete(); throw new Error("directory sync failed"); } } });
  await clear(app);
  assert.match(document.getElementById("local-clear-status").textContent, /New collection was written.*finalization failed/);
  assert.equal(bridge.pending(), null);
  assert.deepEqual(local(app), empty);
  assert.deepEqual(parseBackup(bridge.copies[0]), collection);
  app.click("local-clear-cancel"); await app.settle();
  assert.deepEqual(local(app), empty);
  app.dom.window.close();
});

test("clear preview and pending writes block background edits, switching, MCP writes, closing, and shortcuts", async () => {
  const bridge = native(), begin = bridge.handlers.begin_local_restore;
  let onClose, destroyed = 0, finish;
  const app = await boot(bridge, { handlers: {
    start_mcp_server: () => ({ command: "/scratchpad", args: ["--mcp-stdio"] }),
    begin_local_restore: args => new Promise(resolve => { finish = () => resolve(begin(args)); })
  }, windowApi: { getCurrentWindow: () => ({ onCloseRequested: async fn => { onClose = fn; }, destroy: async () => { destroyed++; } }) } });
  app.click("agent-access-toggle-btn"); await app.settle();
  app.click("mcp-permission-create_note"); await app.settle();
  const oldId = app.invocations.findLast(call => call.command === "update_mcp_snapshot").args.collectionId;
  await open(app);
  for (const phase of ["preview", "pending write"]) {
    assert.equal(document.getElementById("app").inert, true);
    assert.equal(getAppElement("editor").readOnly, true);
    app.click("new-note-btn"); app.click("db-connect-btn"); app.click("collection-restore-btn");
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "n", metaKey: true, bubbles: true, cancelable: true }));
    await onClose({ preventDefault() {} });
    await app.emit("mcp-write-request", { ticket: phase, operation: "create_note", arguments: { collectionId: oldId, requestId: phase, title: "Must not be added" } });
    assert.equal(app.invocations.findLast(call => call.command === "complete_mcp_write" && call.args.ticket === phase).args.result.ok, false);
    assert.equal(destroyed, 0);
    assert.deepEqual(local(app), collection);
    assert.equal(app.invocations.some(call => call.command === "select_db_file"), false);
    if (phase === "preview") {
      type("DELETE");
      document.getElementById("local-clear-confirm").focus();
      document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
      assert.equal(document.activeElement.id, "local-clear-confirmation");
      app.click("local-clear-confirm"); await app.settle();
    } else {
      document.getElementById("local-clear-modal").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      assert.equal(document.getElementById("local-clear-backdrop").style.display, "flex");
    }
  }
  finish(); await app.settle();
  assert.deepEqual(local(app), empty);
  const snapshot = app.invocations.findLast(call => call.command === "update_mcp_snapshot").args;
  assert.notEqual(snapshot.collectionId, oldId);
  assert.deepEqual(snapshot.notes, []);
  assert.deepEqual(snapshot.folders, []);
  await close(app);
});

test("the retained safety backup can restore the complete pre-clear collection", async () => {
  const bridge = native();
  const app = await boot(bridge, { handlers: { read_collection_backup: () => bridge.copies[0] } });
  await clear(app);
  app.click("local-clear-cancel"); await app.settle();
  app.click("collection-restore-btn"); await app.settle();
  app.click("collection-restore-confirm"); await app.settle();
  assert.deepEqual(local(app), collection);
  assert.equal(serializeBackup(parseBackup(bridge.copies[0]), new Date(0)), serializeBackup(collection, new Date(0)));
  app.click("collection-restore-cancel"); await app.settle();
  app.dom.window.close();
});
