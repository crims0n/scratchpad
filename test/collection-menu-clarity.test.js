// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";
import { serializeBackup } from "../src/collection-backup.js";

const note = id => ({ id, title: id, content: id, updatedAt: 100, isTitleLocked: true });
const original = { notes: [note("Local note")], folders: [], trash: [] };
const incoming = { notes: [note("Restored note")], folders: [], trash: [] };
const storage = { scratchpad_notes: original.notes, scratchpad_folders: [], scratchpad_trash: [] };
let instance = 3000;
const text = id => document.getElementById(id).textContent;

function assertDescriptions() {
  for (const id of ["db-connect-btn", "db-disconnect-btn", "collection-backup-btn", "collection-restore-btn", "local-clear-btn", "collection-backup-modal"]) {
    const ids = document.getElementById(id).getAttribute("aria-describedby").split(/\s+/);
    ids.forEach(description => {
      const element = document.getElementById(description);
      assert.ok(element, `${id} description ${description} exists`);
      const hiddenHelp = ["collection-menu-description", "workspace-menu-return-description", "collection-menu-scope", "local-clear-menu-scope"].includes(description);
      assert.equal(element.hidden, hiddenHelp, `${description} is referenced for screen readers without adding menu paragraphs`);
    });
  }
}

test("collection menu clarifies local/workspace scope, switching, and long filenames without changing local data", async () => {
  const path = "C:\\Notes\\" + "A very long portable workspace name ".repeat(5) + "<private>&日本語.sqlite";
  const filename = path.split("\\").pop();
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const app = await bootApp({ instance: ++instance, storage, handlers: {
    select_db_file: () => path,
    load_db_notes: () => [note("Workspace note")]
  }, beforeBoot: win => {
    const style = win.document.createElement("style");
    style.textContent = styles;
    win.document.head.append(style);
  } });
  assert.equal(text("workspace-menu-storage"), "In this app");
  assert.equal(text("workspace-menu-value"), "Local notes");
  assert.equal(text("collection-menu-heading"), "Collection");
  assert.equal(document.querySelectorAll("#workspace-menu-section p:not([hidden])").length, 0, "descriptions do not clutter the menu");
  assert.match(document.getElementById("db-connect-btn").title, /portable workspace file.*local notes stay separate/);
  assert.match(document.getElementById("collection-backup-btn").title, /Back up the notes, folders, and trash.*Local notes/);
  assert.match(document.getElementById("collection-restore-btn").title, /Replace.*Local notes.*does not merge/);
  assert.match(text("collection-menu-description"), /notes, folders, and trash.*portable workspace file/);
  assert.match(text("collection-menu-scope"), /apply to Local notes/);
  assert.equal(document.getElementById("local-clear-btn").disabled, false);
  assert.equal(document.getElementById("local-clear-btn").hidden, false);
  assertDescriptions();

  app.click("db-connect-btn"); await app.settle();
  assert.equal(text("workspace-menu-storage"), "Workspace file");
  assert.equal(text("collection-menu-heading"), "Workspace");
  assert.equal(text("workspace-menu-value"), filename);
  assert.equal(document.getElementById("workspace-menu-value").title, path);
  assert.equal(text("collection-menu-scope"), "Backup and restore apply to this workspace collection. Local notes stay separate.");
  assert.equal(document.getElementById("workspace-menu-value").children.length, 0, "filenames are plain text");
  for (const id of ["collection-backup-btn", "collection-restore-btn"]) {
    assert.match(document.getElementById(id).getAttribute("aria-describedby"), /workspace-menu-storage workspace-menu-value/, "accessible descriptions include the storage type and full workspace filename");
  }
  assert.equal(document.getElementById("local-clear-btn").disabled, true);
  assert.equal(document.getElementById("local-clear-btn").hidden, true);
  for (const id of ["collection-backup-btn", "collection-restore-btn"]) {
    assert.equal(document.getElementById(id).hidden, false, "workspace backup and restore remain available");
    assert.ok(document.getElementById(id).title.includes(path), "hover help names the full workspace path");
  }
  assert.match(text("local-clear-menu-scope"), /Return to local notes to clear.*never cleared/);
  assertDescriptions();
  const valueStyle = app.dom.window.getComputedStyle(document.getElementById("workspace-menu-value"));
  assert.equal(valueStyle.textOverflow, "ellipsis");
  assert.equal(valueStyle.maxWidth, "145px");
  assert.equal(app.dom.window.getComputedStyle(document.getElementById("collection-menu-scope")).display, "none");
  assert.deepEqual(app.read("scratchpad_notes"), original.notes);

  app.click("db-disconnect-btn"); await app.settle();
  assert.equal(text("workspace-menu-storage"), "In this app");
  assert.equal(text("collection-menu-heading"), "Collection");
  assert.match(text("collection-menu-scope"), /apply to Local notes.*Workspace files stay separate/);
  assert.equal(text("local-clear-menu-scope"), "Clears only local notes, folders, and trash.");
  assert.equal(document.getElementById("local-clear-btn").disabled, false);
  assert.equal(document.getElementById("local-clear-btn").hidden, false);
  assert.match(document.getElementById("collection-backup-btn").title, /Local notes/);
  assert.ok(!document.getElementById("collection-backup-btn").title.includes(path), "hover help resets after returning to local notes");
  assert.deepEqual(app.read("scratchpad_notes"), original.notes);
  app.dom.window.close();
});

test("backup and restore identify local and startup-workspace targets during work and in results", async () => {
  for (const path of [null, "/tmp/Portable notes.sqlite"]) {
    let checkpoint = null, finishBackup;
    const app = await bootApp({ instance: ++instance, storage, handlers: {
      load_workspace_preference: () => path,
      load_db_notes: () => original.notes,
      read_local_restore: () => checkpoint,
      begin_local_restore: ({ values }) => { checkpoint = values; return "/tmp/safety.json"; },
      complete_local_restore: () => { checkpoint = null; },
      preserve_collection_backup: () => "/tmp/safety.json",
      read_collection_backup: () => serializeBackup(incoming),
      save_collection_backup: () => new Promise(resolve => { finishBackup = () => resolve("/tmp/export.json"); })
    } });
    const destination = path ? `Workspace file: ${path}` : "Local notes (stored in this app)";
    assert.equal(text("workspace-menu-storage"), path ? "Workspace file" : "In this app");
    assert.equal(text("collection-menu-heading"), path ? "Workspace" : "Collection");
    assert.equal(document.getElementById("local-clear-btn").hidden, Boolean(path));
    app.click("collection-backup-btn"); await app.settle();
    assert.equal(text("collection-backup-target"), `Backup source: ${destination}\nIncludes notes, folders, and trash.`);
    assert.equal(document.getElementById("collection-backup-preflight").hidden, false);
    assertDescriptions();
    finishBackup(); await app.settle();
    assert.equal(text("collection-backup-status"), `Collection backup saved and verified:\n/tmp/export.json\n\nSource: ${destination}`);
    assert.equal(document.getElementById("collection-backup-preflight").hidden, true);
    app.click("collection-restore-cancel"); await app.settle();

    app.click("collection-restore-btn"); await app.settle();
    assert.equal(text("collection-backup-target"), `Restore destination: ${destination}\nIncludes notes, folders, and trash.`);
    assert.ok(text("collection-backup-status").startsWith(`Replace ${destination}?\n\n`));
    assert.match(text("collection-backup-status"), /does not merge/);
    document.getElementById("collection-restore-cancel").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await app.settle();
    assert.equal(document.getElementById("collection-backup-backdrop").style.display, "none");
    assert.equal(document.activeElement.id, "actions-btn");
    assert.deepEqual(app.read("scratchpad_notes"), original.notes);

    app.click("collection-restore-btn"); await app.settle();
    app.click("collection-restore-confirm"); await app.settle();
    assert.ok(text("collection-backup-status").includes(`Destination: ${destination}\n\n`));
    assert.match(text("collection-backup-status"), /Collection restored.*\n\n.*\n\nThe previous collection/);
    assert.equal(document.getElementById("collection-backup-preflight").hidden, true);
    if (path) assert.deepEqual(app.read("scratchpad_notes"), original.notes, "workspace restore leaves local notes alone");
    app.click("collection-restore-cancel"); await app.settle();
    app.dom.window.close();
  }
});

test("clear menu explains browser-only and unreadable-data restrictions through hover and accessible help", async () => {
  for (const browser of [true, false]) {
    const app = await bootApp({ instance: ++instance, storage: browser ? storage : { ...storage, scratchpad_notes: "{broken" },
      beforeBoot: win => { if (browser) delete win.__TAURI__; } });
    assert.equal(document.getElementById("local-clear-btn").disabled, true);
    assert.equal(document.getElementById("local-clear-btn").hidden, false);
    assert.match(document.getElementById("local-clear-btn").title, browser ? /desktop app/ : /Recover unreadable local data/);
    assert.match(text("local-clear-menu-scope"), browser ? /requires the desktop app.*verified safety backup/ : /Recover unreadable local data/);
    assertDescriptions();
    app.dom.window.close();
  }
});
