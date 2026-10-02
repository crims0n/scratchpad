// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";
import { parseBackup, serializeBackup } from "../src/collection-backup.js";

const note = (id, content = id) => ({ id, title: id, content, updatedAt: 100, isTitleLocked: true, isPinned: false, folderId: null });
const original = { notes: [note("original")], folders: [{ id: "empty", name: "Empty" }],
  trash: [{ id: "deleted", note: note("gone"), deletedAt: 200, folderName: null }] };
const incoming = { notes: [{ ...note("pinned", "Unicode 🐈"), isPinned: true, folderId: "f" }, note("second")],
  folders: [{ id: "empty2", name: "Empty two" }, { id: "f", name: "Folder" }],
  trash: [{ id: "old", note: { ...note("oldnote"), folderId: "missing" }, deletedAt: 300, folderName: "Removed" }] };
const empty = { notes: [], folders: [], trash: [] };
const seed = value => ({ scratchpad_notes: value.notes, scratchpad_folders: value.folders, scratchpad_trash: value.trash });
const local = app => ({ notes: app.read("scratchpad_notes"), folders: app.read("scratchpad_folders"), trash: app.read("scratchpad_trash") });
let instance = 700;
function native(initial = original) {
  let workspace = structuredClone(initial), checkpoint = null, selected = serializeBackup(incoming);
  const safety = [], exports = [], writes = [];
  return { safety, exports, writes, workspace: () => workspace, pending: () => checkpoint,
    select: value => { selected = value; }, checkpoint: value => { checkpoint = value; },
    handlers: {
      read_collection_backup: () => selected,
      save_collection_backup: ({ content }) => { exports.push(content); return "/tmp/export.json"; },
      preserve_collection_backup: ({ content }) => { safety.push(content); return "/tmp/safety.json"; },
      begin_local_restore: ({ values, content }) => { checkpoint = values; safety.push(content); return "/tmp/safety.json"; },
      read_local_restore: () => checkpoint,
      complete_local_restore: () => { checkpoint = null; },
      load_db_notes: () => workspace.notes, load_db_folders: () => workspace.folders, load_db_trash: () => workspace.trash,
      workspace_collection_initialized: () => true,
      save_workspace_db: value => { writes.push(structuredClone(value)); workspace = { notes: value.notes, folders: value.folders, trash: value.trash }; }
    }
  };
}
async function boot(bridge, options = {}) {
  return bootApp({ instance: ++instance, storage: seed(original), ...options,
    handlers: { ...bridge.handlers, ...options.handlers } });
}
async function restore(app, confirm = true) {
  app.click("collection-restore-btn");
  await app.settle();
  assert.equal(document.getElementById("collection-restore-confirm").hidden, false);
  assert.equal(document.getElementById("collection-backup-preflight").hidden, false);
  assert.match(document.getElementById("collection-backup-status").textContent, /\?\n\nCurrent:.*\nBackup:.*\n\nThis replaces.*\n\nA verified/);
  app.click(confirm ? "collection-restore-confirm" : "collection-restore-cancel");
  await app.settle();
}
async function close(app) { app.click("collection-restore-cancel"); await app.settle(); app.dom.window.close(); }

test("backup captures immediately pending edits and all metadata, verified file completion is shown", async () => {
  const bridge = native(), app = await boot(bridge);
  const editor = document.getElementById("editor-textarea");
  editor.value = "unsaved edit";
  editor.dispatchEvent(new window.Event("input"));
  app.click("collection-backup-btn");
  await app.settle();
  assert.equal(bridge.exports.length, 1);
  assert.deepEqual(parseBackup(bridge.exports[0]), { ...original, notes: [{ ...app.read("scratchpad_notes")[0], content: "unsaved edit" }] });
  assert.match(document.getElementById("collection-backup-status").textContent, /saved and verified/);
  assert.equal(document.getElementById("collection-backup-preflight").hidden, true);
  await close(app);
});

test("backup guidance is shown during work, hidden for results, and reset on reopening", async () => {
  const bridge = native();
  let finish;
  const app = await boot(bridge, { handlers: { save_collection_backup: () => new Promise((resolve, reject) => {
    finish = error => error ? reject(error) : resolve("/tmp/export.json");
  }) } });
  const reminder = document.getElementById("collection-backup-preflight");
  const status = document.getElementById("collection-backup-status");
  const cancel = document.getElementById("collection-restore-cancel");
  for (const error of [null, new Error("disk full")]) {
    app.click("collection-backup-btn"); await app.settle();
    assert.equal(reminder.hidden, false);
    assert.equal(cancel.disabled, true);
    assert.equal(document.getElementById("collection-backup-safety").hidden, true);
    assert.doesNotMatch(status.textContent, /saved and verified|failed/);
    finish(error); await app.settle();
    assert.equal(reminder.hidden, true);
    assert.equal(cancel.textContent, "Close");
    assert.equal(cancel.disabled, false);
    assert.equal(document.getElementById("collection-restore-confirm").hidden, true);
    assert.match(status.textContent, error ? /Backup failed: disk full/ : /saved and verified:\n\/tmp\/export.json/);
    assert.match(document.getElementById("collection-backup-modal").textContent, /not encrypted/);
    cancel.click(); await app.settle();
  }
  app.dom.window.close();
});

test("collection dialog paragraphs have a blank-line gap and preserve status paragraph breaks", async () => {
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const app = await boot(native(), { beforeBoot: win => {
    const style = win.document.createElement("style");
    style.textContent = styles;
    win.document.head.append(style);
  } });
  const paragraph = document.getElementById("collection-backup-status");
  const computed = app.dom.window.getComputedStyle(paragraph);
  assert.equal(computed.marginBottom, "1.5em");
  assert.equal(computed.lineHeight, "1.5");
  assert.equal(computed.whiteSpace, "pre-line");
  app.dom.window.close();
});

test("local restore preserves the original backup, publishes candidate only after save, and can be repeated", async () => {
  const bridge = native(), app = await boot(bridge);
  await restore(app);
  assert.deepEqual(local(app), incoming);
  assert.deepEqual(parseBackup(bridge.safety[0]), original);
  assert.equal(bridge.pending(), null);
  assert.deepEqual(app.sidebarTitles(), ["pinned", "second"]);
  assert.match(document.getElementById("collection-backup-status").textContent, /Collection restored/);
  assert.equal(document.getElementById("collection-backup-preflight").hidden, true);
  assert.match(document.getElementById("collection-backup-safety").textContent, /safety.json/);
  app.click("collection-restore-cancel"); await app.settle();
  app.click("collection-restore-btn"); await app.settle();
  assert.equal(document.getElementById("collection-backup-preflight").hidden, false);
  assert.equal(document.getElementById("collection-backup-safety").hidden, true);
  assert.equal(document.getElementById("collection-backup-safety").textContent, "");
  app.click("collection-restore-cancel"); await app.settle();
  await restore(app);
  assert.deepEqual(local(app), incoming);
  assert.deepEqual(parseBackup(bridge.safety[1]), incoming);
  await close(app);
});

test("cancel, invalid/truncated/unsupported backups, and file picker cancel do not replace data", async () => {
  const bridge = native(), app = await boot(bridge);
  await restore(app, false);
  assert.deepEqual(local(app), original);
  assert.equal(bridge.safety.length, 0);
  for (const file of ["{", "{}", serializeBackup(incoming).replace('"schemaVersion": 1', '"schemaVersion": 99')]) {
    bridge.select(file);
    app.click("collection-restore-btn"); await app.settle();
    assert.match(document.getElementById("collection-backup-status").textContent, /Restore failed/);
    assert.equal(document.getElementById("collection-backup-preflight").hidden, true);
    assert.deepEqual(local(app), original);
    app.click("collection-restore-cancel"); await app.settle();
  }
  bridge.select(null);
  app.click("collection-restore-btn"); await app.settle();
  assert.equal(document.getElementById("collection-backup-backdrop").style.display, "none");
  assert.deepEqual(local(app), original);
  assert.equal(bridge.safety.length, 0);
  app.dom.window.close();
});

test("empty and trash-only local restore survive restart without a welcome note", async () => {
  for (const candidate of [empty, { ...empty, trash: incoming.trash }]) {
    const bridge = native(); bridge.select(serializeBackup(candidate));
    const app = await boot(bridge);
    await restore(app);
    const storage = app.dumpStorage();
    assert.deepEqual(local(app), candidate);
    assert.deepEqual(app.sidebarTitles(), []);
    await close(app);
    const restarted = await boot(bridge, { storage });
    assert.deepEqual(local(restarted), candidate);
    assert.deepEqual(restarted.sidebarTitles(), []);
    for (const id of ["editor-textarea", "note-title", "secondary-editor-textarea", "secondary-note-title"]) {
      assert.equal(document.getElementById(id).readOnly, true);
    }
    assert.equal(document.getElementById("empty-collection-prompt").hidden, false);
    restarted.dom.window.close();
  }
});

test("cancelled restore resumes previously pending edits without taking a safety copy", async () => {
  const bridge = native(), app = await boot(bridge);
  const editor = document.getElementById("editor-textarea");
  editor.value = "pending before cancel";
  editor.dispatchEvent(new window.Event("input"));
  await restore(app, false);
  assert.equal(app.read("scratchpad_notes")[0].content, "original");
  await app.settle(600);
  assert.equal(app.read("scratchpad_notes")[0].content, "pending before cancel");
  assert.equal(bridge.safety.length, 0);
  app.dom.window.close();
});

test("empty local editors reject unattached input and unlock when a note is created", async () => {
  const bridge = native(), app = await boot(bridge, { storage: { ...seed(empty), scratchpad_layout_mode: "preview" } });
  const prompt = document.getElementById("empty-collection-prompt");
  assert.equal(prompt.hidden, false);
  assert.match(prompt.textContent, /Create a new scratchpad or select a note/);
  // Read-only attributes prevent actual typing; even synthetic input cannot
  // leave unattached text on screen that looks as if it was saved.
  for (const id of ["editor-textarea", "note-title", "secondary-editor-textarea", "secondary-note-title"]) {
    const field = document.getElementById(id);
    assert.equal(field.readOnly, true);
    field.value = "must not look saved";
    field.dispatchEvent(new window.Event("input"));
    assert.equal(field.value, "");
  }
  assert.deepEqual(local(app), empty);
  app.click("new-note-btn"); await app.settle();
  assert.equal(document.getElementById("editor-textarea").readOnly, false);
  assert.equal(document.getElementById("note-title").readOnly, false);
  assert.equal(prompt.hidden, true);
  const title = document.getElementById("note-title");
  title.value = "Keep this title"; title.dispatchEvent(new window.Event("input"));
  await app.type("Keep this body");
  assert.equal(app.read("scratchpad_notes")[0].title, "Keep this title");
  assert.equal(app.read("scratchpad_notes")[0].content, "Keep this body");
  app.dom.window.close();
});

test("connecting folders-only, trash-only, and new empty workspaces protects empty editors", async () => {
  const cases = [
    { workspace: { ...empty, folders: original.folders }, storage: seed(original), initialized: true },
    { workspace: { ...empty, trash: original.trash }, storage: seed(original), initialized: true },
    { workspace: empty, storage: seed(empty), initialized: false },
    { workspace: empty, storage: { scratchpad_notes: "{ damaged", scratchpad_folders: [], scratchpad_trash: [] }, initialized: false }
  ];
  for (const scenario of cases) {
    const bridge = native(scenario.workspace), app = await boot(bridge, { storage: scenario.storage, handlers: {
      select_db_file: () => "/tmp/empty-connect.db",
      workspace_collection_initialized: () => scenario.initialized
    } });
    app.click("db-connect-btn"); await app.settle();
    assert.equal(document.getElementById("workspace-menu-value").textContent, "empty-connect.db");
    assert.equal(document.getElementById("empty-collection-prompt").hidden, false);
    assert.equal(document.getElementById("editor-textarea").readOnly, true);
    assert.equal(document.getElementById("note-title").readOnly, true);
    assert.deepEqual(bridge.workspace(), scenario.workspace);
    app.click("split-note-btn");
    assert.equal(document.getElementById("secondary-editor-textarea").readOnly, true);
    assert.equal(document.getElementById("secondary-note-title").readOnly, true);
    app.click("new-note-btn"); await app.settle();
    assert.equal(document.getElementById("empty-collection-prompt").hidden, true);
    assert.equal(document.getElementById("editor-textarea").readOnly, false);
    assert.equal(document.getElementById("secondary-editor-textarea").readOnly, false);
    await app.type("Saved in workspace");
    // The incremental save command is mocked separately from full saves.
    const saved = app.invocations.findLast(call => call.command === "save_note_db");
    assert.equal(saved.args.note.content, "Saved in workspace");
    if (typeof scenario.storage.scratchpad_notes === "string") assert.equal(app.storage.getItem("scratchpad_notes"), "{ damaged");
    app.dom.window.close();
  }
});

test("checkpoint staging failure keeps local data editable and a later restore can retry", async () => {
  const bridge = native(), originalBegin = bridge.handlers.begin_local_restore;
  let fail = true;
  bridge.handlers.begin_local_restore = args => {
    if (fail) throw new Error("checkpoint temporary write failed");
    return originalBegin(args);
  };
  const app = await boot(bridge);
  await restore(app);
  assert.match(document.getElementById("collection-backup-status").textContent, /Restore failed.*temporary write failed/);
  assert.deepEqual(local(app), original);
  assert.equal(bridge.pending(), null);
  app.click("collection-restore-cancel"); await app.settle();
  assert.equal(document.getElementById("editor-textarea").readOnly, false);
  assert.equal(document.getElementById("local-recovery-banner").hidden, true);
  fail = false;
  await restore(app);
  assert.deepEqual(local(app), incoming);
  await close(app);
});

test("restore safety copy includes edits pending at confirmation", async () => {
  const bridge = native(), app = await boot(bridge);
  const editor = document.getElementById("editor-textarea");
  editor.value = "preserve this edit";
  editor.dispatchEvent(new window.Event("input"));
  await restore(app);
  assert.equal(parseBackup(bridge.safety[0]).notes[0].content, "preserve this edit");
  assert.deepEqual(local(app), incoming);
  await close(app);
});

test("workspace backup and restore preserve order, pins, trash, and the other local collection", async () => {
  const bridge = native(), app = await boot(bridge, { handlers: { load_workspace_preference: () => "/tmp/workspace.db" } });
  app.click("collection-backup-btn"); await app.settle();
  assert.deepEqual(parseBackup(bridge.exports[0]), original);
  app.click("collection-restore-cancel"); await app.settle();
  await restore(app);
  assert.deepEqual(bridge.workspace(), incoming);
  assert.deepEqual(local(app), original);
  assert.equal(document.getElementById("workspace-menu-value").textContent, "workspace.db");
  assert.equal(bridge.writes.at(-1).dbPath, "/tmp/workspace.db");
  assert.deepEqual(parseBackup(bridge.safety[0]), original);
  app.click("collection-restore-cancel"); await app.settle();
  bridge.select(bridge.exports[0]);
  await restore(app);
  assert.deepEqual(bridge.workspace(), original);
  await close(app);
});

test("empty and trash-only initialized workspaces reopen without seeding local notes", async () => {
  for (const value of [empty, { ...empty, trash: incoming.trash }]) {
    const bridge = native(value), app = await boot(bridge, { handlers: { load_workspace_preference: () => "/tmp/empty.db" } });
    assert.deepEqual(app.sidebarTitles(), []);
    assert.deepEqual(bridge.workspace(), value);
    assert.equal(bridge.writes.length, 0);
    assert.deepEqual(local(app), original);
    app.dom.window.close();
  }
});

test("workspace restore safety failure or failed transaction leaves UI and destination unchanged", async () => {
  for (const failing of ["preserve_collection_backup", "save_workspace_db"]) {
    const bridge = native();
    let calls = 0;
    const handler = bridge.handlers[failing];
    const app = await boot(bridge, { handlers: {
      load_workspace_preference: () => "/tmp/failed.db",
      [failing]: args => { if (failing !== "save_workspace_db" || ++calls === 2) throw new Error("write failed"); return handler(args); }
    } });
    await restore(app);
    assert.match(document.getElementById("collection-backup-status").textContent, /Restore failed/);
    assert.deepEqual(bridge.workspace(), original);
    assert.deepEqual(app.sidebarTitles(), ["original"]);
    assert.deepEqual(local(app), original);
    await close(app);
  }
});

test("export and pending-save failures never report a completed backup", async () => {
  const bridge = native(), app = await boot(bridge, { handlers: { save_collection_backup: () => { throw new Error("disk full"); } } });
  app.click("collection-backup-btn"); await app.settle();
  assert.match(document.getElementById("collection-backup-status").textContent, /Backup failed.*disk full/);
  assert.equal(document.getElementById("collection-backup-preflight").hidden, true);
  assert.deepEqual(local(app), original);
  await close(app);
  const bridge2 = native(), app2 = await boot(bridge2, { handlers: {
    load_workspace_preference: () => "/tmp/no-save.db",
    save_workspace_db: () => { throw new Error("save failed"); }
  } });
  app2.click("collection-backup-btn"); await app2.settle();
  assert.match(document.getElementById("collection-backup-status").textContent, /Pending edits could not be saved/);
  assert.equal(bridge2.exports.length, 0);
  assert.equal(bridge2.safety.length, 0);
  await close(app2);
});

test("failed local replacement and rollback remain read-only until checkpoint recovery succeeds", async () => {
  const bridge = native(); let restoring = false, unavailable = true, writes = 0;
  const begin = bridge.handlers.begin_local_restore;
  bridge.handlers.begin_local_restore = args => { const path = begin(args); restoring = true; return path; };
  const app = await boot(bridge);
  const prototype = Object.getPrototypeOf(app.storage), originalSet = prototype.setItem;
  prototype.setItem = function(key, value) {
    if (restoring && unavailable && ++writes >= 2) throw new Error("quota exceeded");
    return originalSet.call(this, key, value);
  };
  try {
    await restore(app);
    assert.match(document.getElementById("collection-backup-status").textContent, /Restore failed/);
    assert.ok(bridge.pending());
    app.click("collection-restore-cancel"); await app.settle();
    assert.equal(document.getElementById("editor-textarea").readOnly, true);
    assert.equal(document.getElementById("local-recovery-replace-btn").disabled, true);
    unavailable = false;
    app.click("local-recovery-retry-btn"); await app.settle();
    assert.deepEqual(local(app), original);
    assert.deepEqual(app.sidebarTitles(), ["original"]);
    assert.equal(document.getElementById("editor-textarea").readOnly, false);
    assert.equal(bridge.pending(), null);
  } finally { prototype.setItem = originalSet; app.dom.window.close(); }
});

test("checkpoint finalization error after marker removal reloads written data instead of autosaving stale state", async () => {
  const bridge = native(), complete = bridge.handlers.complete_local_restore;
  bridge.handlers.complete_local_restore = () => { complete(); throw new Error("directory sync failed"); };
  const app = await boot(bridge);
  await restore(app);
  assert.match(document.getElementById("collection-backup-status").textContent, /New collection was written.*finalization failed/);
  assert.deepEqual(local(app), incoming);
  assert.deepEqual(app.sidebarTitles(), ["pinned", "second"]);
  assert.deepEqual(parseBackup(bridge.safety[0]), original);
  await close(app);
});

test("restore preview blocks shortcuts, background buttons, MCP writes, switching, and closing", async () => {
  const bridge = native(); let onClose, destroyed = 0;
  const app = await boot(bridge, { handlers: { start_mcp_server: () => ({ command: "/scratchpad", args: ["--mcp-stdio"] }) }, windowApi: { getCurrentWindow: () => ({
    onCloseRequested: async fn => { onClose = fn; }, destroy: async () => { destroyed++; }
  }) } });
  app.click("agent-access-toggle-btn"); await app.settle();
  app.click("mcp-permission-create_note"); await app.settle();
  const collectionId = app.invocations.findLast(call => call.command === "update_mcp_snapshot").args.collectionId;
  app.click("collection-restore-btn"); await app.settle();
  assert.equal(document.getElementById("app").inert, true);
  assert.equal(document.getElementById("editor-textarea").readOnly, true);
  app.click("new-note-btn"); app.click("db-connect-btn");
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "n", metaKey: true, bubbles: true, cancelable: true }));
  await onClose({ preventDefault() {} });
  await app.emit("mcp-write-request", { ticket: "during-restore", operation: "create_note",
    arguments: { collectionId, requestId: "during-restore", title: "Must not be added" } });
  const result = app.invocations.findLast(call => call.command === "complete_mcp_write" && call.args.ticket === "during-restore").args.result;
  assert.equal(result.ok, false);
  assert.equal(destroyed, 0);
  assert.deepEqual(local(app), original);
  assert.equal(app.invocations.some(call => call.command === "select_db_file"), false);
  // Focus wraps and Escape cancels, restoring keyboard focus to the menu.
  document.getElementById("collection-restore-confirm").focus();
  document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  assert.equal(document.activeElement.id, "collection-restore-cancel");
  document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await app.settle();
  assert.equal(document.getElementById("app").inert, false);
  assert.equal(document.getElementById("editor-textarea").readOnly, false);
  assert.equal(document.activeElement.id, "actions-btn");
  app.dom.window.close();
});

test("startup recovers an interrupted local restore before normal loading or autosave", async () => {
  const bridge = native();
  bridge.checkpoint(Object.fromEntries(Object.entries(seed(original)).map(([key, value]) => [key, JSON.stringify(value)])));
  const app = await boot(bridge, { storage: seed(incoming) });
  assert.deepEqual(local(app), original);
  assert.deepEqual(app.sidebarTitles(), ["original"]);
  assert.equal(bridge.pending(), null);
  app.dom.window.close();
});

test("unreadable checkpoints quarantine local data and Retry reading recovers it", async () => {
  const bridge = native();
  const values = Object.fromEntries(Object.entries(seed(original)).map(([key, value]) => [key, JSON.stringify(value)]));
  bridge.checkpoint(values);
  let unavailable = true;
  const app = await boot(bridge, { storage: seed(incoming), handlers: {
    read_local_restore: () => { if (unavailable) throw new Error("checkpoint unreadable"); return bridge.pending(); }
  } });
  assert.deepEqual(local(app), incoming);
  assert.equal(document.getElementById("editor-textarea").readOnly, true);
  assert.equal(document.getElementById("local-recovery-replace-btn").disabled, true);
  assert.match(document.getElementById("local-recovery-message").textContent, /Interrupted collection restore/);
  app.click("collection-restore-btn"); await app.settle();
  assert.equal(bridge.safety.length, 0);
  unavailable = false;
  app.click("local-recovery-retry-btn"); await app.settle();
  assert.deepEqual(local(app), original);
  assert.equal(document.getElementById("editor-textarea").readOnly, false);
  assert.equal(bridge.pending(), null);
  app.dom.window.close();
});
