// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, getAppElement } from "./helpers/app-harness.js";

const note = (id, content = id) => ({ id, title: id, content, updatedAt: 1,
  isTitleLocked: true, isPinned: false, folderId: null });
const local = [note("local-primary"), note("local-secondary")];
const workspace = [note("workspace-primary"), note("workspace-secondary")];
let instance = 10000;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const edit = (id, content) => getAppElement(id).applyEdit({ value: content, selectionStart: 0, selectionEnd: 0 });
const seed = { scratchpad_notes: local, scratchpad_folders: [], scratchpad_trash: [] };

function assertLocked(app) {
  for (const id of ["editor", "secondary-editor", "note-title", "secondary-note-title"]) {
    const element = getAppElement(id);
    assert.equal(element.readOnly, true, `${id} must be read-only before asynchronous work`);
    const before = element.value;
    if (id.endsWith("editor")) {
      edit(id, "must not be accepted");
      assert.equal(element.value, before, `${id} must reject editor commands`);
    }
    // A prequeued input must also be rejected even if it reaches the handler
    // after the native/editor read-only flags have already been applied.
    element.value = "must not be accepted";
    element.dispatchEvent(new window.Event("input"));
    assert.equal(element.value, before, `${id} must reject late mutations`);
  }
  assert.equal(document.getElementById("app").inert, true);
  const pins = [...document.querySelectorAll(".note-item-pin")].map(element => element.getAttribute("aria-pressed"));
  const titles = app.sidebarTitles();
  app.click("new-note-btn");
  app.click("new-folder-btn");
  document.querySelector(".note-item-pin").click();
  document.querySelector(".note-item-delete").click();
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "n", metaKey: true, bubbles: true, cancelable: true }));
  assert.deepEqual(app.sidebarTitles(), titles, "background controls and shortcuts must not mutate the collection");
  assert.deepEqual([...document.querySelectorAll(".note-item-pin")].map(element => element.getAttribute("aria-pressed")), pins);
}

function assertUnlocked() {
  assert.equal(Boolean(document.getElementById("app").inert), false);
  assert.equal(getAppElement("editor").readOnly, false);
  assert.equal(document.getElementById("note-title").readOnly, false);
}

test("connecting freezes both panes and metadata before delayed workspace reads", async () => {
  const reading = deferred(), started = deferred();
  const app = await bootApp({ instance: instance++, storage: seed, handlers: {
    select_db_file: () => "/tmp/transition.db",
    load_db_notes: () => { started.resolve(); return reading.promise; }
  } });
  app.click("split-note-btn");
  edit("editor", "pending primary");
  edit("secondary-editor", "pending secondary");
  app.click("db-connect-btn");
  await started.promise;
  assertLocked(app);
  assert.deepEqual(app.read("scratchpad_notes").map(item => item.content), ["pending primary", "pending secondary"]);
  reading.resolve(workspace);
  await app.settle();
  assertUnlocked();
  assert.equal(getAppElement("editor").value, "workspace-primary");
  assert.deepEqual(app.read("scratchpad_notes").map(item => item.content), ["pending primary", "pending secondary"]);
  app.dom.window.close();
});

for (const outcome of ["cancel", "read failure"]) {
  test(`connecting unlocks the outgoing collection after ${outcome}`, async () => {
    const waiting = deferred(), started = deferred();
    const app = await bootApp({ instance: instance++, storage: seed, handlers: {
      select_db_file: () => {
        if (outcome === "cancel") { started.resolve(); return waiting.promise; }
        return "/tmp/transition.db";
      },
      load_db_notes: () => { started.resolve(); return waiting.promise; }
    } });
    edit("editor", "keep outgoing edit");
    app.click("db-connect-btn");
    await started.promise;
    assert.equal(getAppElement("editor").readOnly, true);
    if (outcome === "cancel") waiting.resolve(null);
    else waiting.reject(new Error("workspace unavailable"));
    await app.settle();
    assertUnlocked();
    assert.equal(getAppElement("editor").value, "keep outgoing edit");
    edit("editor", "editable after cancellation or failure");
    assert.equal(getAppElement("editor").value, "editable after cancellation or failure");
    app.dom.window.close();
  });
}

test("disconnect freezes both panes while saving, unlocks on failure, and safely retries", async () => {
  let save = deferred(), started = deferred(), saved;
  const app = await bootApp({ instance: instance++, storage: seed, handlers: {
    load_workspace_preference: () => "/tmp/transition.db",
    load_db_notes: () => workspace,
    save_workspace_db: args => { saved = structuredClone(args); started.resolve(); return save.promise; }
  } });
  app.click("split-note-btn");
  edit("editor", "pending primary");
  edit("secondary-editor", "pending secondary");
  app.click("db-disconnect-btn");
  await started.promise;
  assertLocked(app);
  save.reject(new Error("disk full"));
  await app.settle();
  assertUnlocked();
  assert.equal(getAppElement("editor").value, "pending primary");
  assert.equal(getAppElement("secondary-editor").value, "pending secondary");
  edit("editor", "retry edit");
  save = deferred(); started = deferred();
  app.click("db-disconnect-btn");
  await started.promise;
  assertLocked(app);
  save.resolve();
  await app.settle();
  assertUnlocked();
  assert.deepEqual(saved.notes.map(item => item.content), ["retry edit", "pending secondary"]);
  assert.equal(getAppElement("editor").value, "local-primary");
  app.dom.window.close();
});

test("close freezes the final snapshot, cancels on save failure and retries without accepting late edits", async () => {
  let close, destroyed = 0, save = deferred(), started = deferred(), saved;
  const app = await bootApp({ instance: instance++, storage: seed, handlers: {
    load_workspace_preference: () => "/tmp/transition.db",
    load_db_notes: () => workspace,
    save_workspace_db: args => { saved = structuredClone(args); started.resolve(); return save.promise; }
  }, windowApi: { getCurrentWindow: () => ({
    onCloseRequested: async handler => { close = handler; },
    destroy: async () => { destroyed++; }
  }) } });
  app.click("split-note-btn");
  edit("editor", "pending primary");
  edit("secondary-editor", "pending secondary");
  let closing = close({ preventDefault() {} });
  await started.promise;
  assertLocked(app);
  app.click("db-connect-btn"); app.click("db-disconnect-btn");
  assert.equal(app.invocations.some(call => call.command === "select_db_file" || call.command === "set_last_workspace"), false);
  assert.equal(destroyed, 0);
  save.reject(new Error("disk full"));
  await closing;
  assertUnlocked();
  assert.equal(destroyed, 0);
  edit("secondary-editor", "editable retry");
  save = deferred(); started = deferred();
  closing = close({ preventDefault() {} });
  await started.promise;
  assertLocked(app);
  save.resolve();
  await closing;
  assert.equal(destroyed, 1);
  assert.deepEqual(saved.notes.map(item => item.content), ["pending primary", "editable retry"]);
  app.dom.window.close();
});

test("failed native destruction restores editing and permits another close attempt", async () => {
  let close, fail = true, destroyed = 0;
  const app = await bootApp({ instance: instance++, storage: seed,
    windowApi: { getCurrentWindow: () => ({
      onCloseRequested: async handler => { close = handler; },
      destroy: async () => { if (fail) throw new Error("native close failed"); destroyed++; }
    }) } });
  await close({ preventDefault() {} });
  assertUnlocked();
  edit("editor", "edit after failed destruction");
  fail = false;
  await close({ preventDefault() {} });
  assert.equal(destroyed, 1);
  assert.equal(app.read("scratchpad_notes")[0].content, "edit after failed destruction");
  app.dom.window.close();
});

test("close commits an in-progress folder name before capturing the final snapshot", async () => {
  let close, saved;
  const app = await bootApp({ instance: instance++, handlers: {
    load_workspace_preference: () => "/tmp/transition.db",
    load_db_notes: () => workspace,
    save_workspace_db: args => { saved = structuredClone(args); }
  }, windowApi: { getCurrentWindow: () => ({
    onCloseRequested: async handler => { close = handler; },
    destroy: async () => {}
  }) } });
  app.click("new-folder-btn");
  await app.settle();
  document.querySelector(".note-folder-input").value = "Pending folder name";
  await close({ preventDefault() {} });
  assert.deepEqual(saved.folders.map(folder => folder.name), ["Pending folder name"]);
  app.dom.window.close();
});

test("an import started earlier cannot publish into a switched collection", async () => {
  const imported = deferred();
  const app = await bootApp({ instance: instance++, storage: seed, handlers: {
    import_file_native: () => imported.promise,
    select_db_file: () => "/tmp/transition.db",
    load_db_notes: () => workspace
  } });
  app.click("import-btn");
  app.click("db-connect-btn");
  await app.settle();
  assertUnlocked();
  imported.resolve({ title: "Import for the old collection", content: "must not cross collections" });
  await app.settle();
  assert.deepEqual(app.sidebarTitles(), workspace.map(item => item.title));
  assert.match(document.getElementById("save-status").textContent, /import cancelled/);
  app.dom.window.close();
});
