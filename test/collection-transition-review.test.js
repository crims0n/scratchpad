// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, getAppElement } from "./helpers/app-harness.js";

const note = (id, content = id) => ({ id, title: id, content, updatedAt: 1,
  isTitleLocked: true, isPinned: false, folderId: null });
const local = [note("local")], workspace = [note("workspace")];
const seed = { scratchpad_notes: local, scratchpad_folders: [], scratchpad_trash: [] };
let instance = 12800;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const boot = options => bootApp({ instance: instance++, storage: seed, ...options });
const key = (element, value) => element.dispatchEvent(new window.KeyboardEvent("keydown", {
  key: value, bubbles: true, cancelable: true
}));

test("disconnecting with no saved local notes creates and displays a persisted local note", async () => {
  const app = await boot({ storage: {}, handlers: {
    load_workspace_preference: () => "/tmp/review-128.db",
    load_db_notes: () => workspace
  } });
  assert.equal(app.read("scratchpad_notes"), null);
  app.click("split-note-btn");
  app.click("db-disconnect-btn");
  await app.settle();
  const saved = app.read("scratchpad_notes");
  assert.equal(saved.length, 1);
  assert.notEqual(saved[0].id, "workspace");
  assert.equal(saved[0].content, "");
  assert.deepEqual(app.sidebarTitles(), ["Untitled Scratchpad"]);
  assert.equal(getAppElement("editor").value, "");
  assert.equal(document.getElementById("note-title").value, "Untitled Scratchpad");
  assert.equal(getAppElement("secondary-editor").value, "");
  assert.equal(document.getElementById("workspace-menu-value").textContent, "Local notes");
  assert.equal(getAppElement("editor").readOnly, false);
  const disk = app.dumpStorage();
  app.dom.window.close();
  const reopened = await boot({ storage: disk });
  assert.deepEqual(reopened.read("scratchpad_notes"), saved);
  assert.equal(getAppElement("editor").value, "");
  reopened.dom.window.close();
});

for (const outcome of ["cancel", "read failure", "seed failure"]) {
  test(`an import completing during a switch survives ${outcome} without changing collection identity`, async () => {
    const selected = deferred(), started = deferred(), imported = deferred();
    const app = await boot({ handlers: {
      import_file_native: () => imported.promise,
      start_mcp_server: () => ({ command: "/scratchpad", args: ["--mcp-stdio"] }),
      select_db_file: () => { started.resolve(); return selected.promise; },
      load_db_notes: () => {
        if (outcome === "read failure") throw new Error("workspace unavailable");
        return [];
      },
      save_workspace_db: () => { if (outcome === "seed failure") throw new Error("read only"); }
    } });
    app.click("agent-access-toggle-btn"); await app.settle();
    const collectionId = app.invocations.findLast(call => call.command === "update_mcp_snapshot").args.collectionId;
    app.click("import-btn"); app.click("db-connect-btn");
    await started.promise;
    imported.resolve({ title: "Keep imported note", content: "original import content" });
    await app.settle();
    assert.deepEqual(app.sidebarTitles(), ["local"], "imports wait for the switch outcome");
    selected.resolve(outcome === "cancel" ? null : "/tmp/review-128.db");
    await app.settle(100);
    assert.ok(app.sidebarTitles().includes("Keep imported note"));
    assert.equal(app.read("scratchpad_notes").find(note => note.title === "Keep imported note").content, "original import content");
    assert.equal(app.invocations.findLast(call => call.command === "update_mcp_snapshot").args.collectionId, collectionId);
    app.dom.window.close();
  });
}

for (const name of ["Existing", "Pinned"]) {
  test(`an invalid folder name (${name}) visibly cancels Close, Connect and Disconnect`, async () => {
    let close, destroyed = 0;
    const app = await boot({ storage: { ...seed, scratchpad_folders: [{ id: "f", name: "Existing" }] },
      windowApi: { getCurrentWindow: () => ({
        onCloseRequested: async handler => { close = handler; },
        destroy: async () => { destroyed++; }
      }) } });
    app.click("new-folder-btn"); await app.settle();
    const input = document.querySelector(".note-folder-input");
    input.value = name;
    await close({ preventDefault() {} });
    assert.equal(destroyed, 0);
    assert.match(document.getElementById("save-status").textContent, /Close cancelled.*folder name.*Escape/);
    app.click("db-connect-btn"); await app.settle();
    assert.match(document.getElementById("save-status").textContent, /Connect cancelled/);
    app.click("db-disconnect-btn"); await app.settle();
    assert.match(document.getElementById("save-status").textContent, /Disconnect cancelled/);
    assert.equal(app.invocations.some(call => call.command === "select_db_file"), false);
    assert.equal(document.getElementById("app").inert, false);
    assert.equal(input.value, name, "invalid drafts stay available for correction");
    key(input, "Escape");
    await close({ preventDefault() {} });
    assert.equal(destroyed, 1);
    app.dom.window.close();
  });
}

test("a stale folder edit whose input disappeared cannot trap closing", async () => {
  let close, destroyed = 0;
  const app = await boot({ windowApi: { getCurrentWindow: () => ({
    onCloseRequested: async handler => { close = handler; }, destroy: async () => { destroyed++; }
  }) } });
  app.click("new-folder-btn"); await app.settle();
  document.querySelector(".note-folder-input").remove();
  await close({ preventDefault() {} });
  assert.equal(destroyed, 1);
  assert.deepEqual(app.read("scratchpad_folders"), []);
  app.dom.window.close();
});

test("interrupted-restore retry freezes the collection until durable recovery completes", async () => {
  let calls = 0;
  const reading = deferred(), started = deferred();
  const app = await boot({ handlers: {
    read_local_restore: () => {
      if (++calls === 1) throw new Error("checkpoint unavailable");
      started.resolve(); return reading.promise;
    }
  } });
  app.click("local-recovery-retry-btn");
  await started.promise;
  assert.equal(document.getElementById("app").inert, true);
  for (const id of ["editor", "secondary-editor", "note-title", "secondary-note-title"]) {
    assert.equal(getAppElement(id).readOnly, true);
  }
  getAppElement("editor").applyEdit({ value: "IME-like late input", selectionStart: 0, selectionEnd: 0 });
  assert.equal(getAppElement("editor").value, "local");
  reading.resolve({ scratchpad_notes: JSON.stringify([note("recovered")]), scratchpad_folders: "[]", scratchpad_trash: "[]" });
  await app.settle();
  assert.equal(document.getElementById("app").inert, false);
  assert.equal(getAppElement("editor").readOnly, false);
  assert.equal(getAppElement("editor").value, "recovered");
  app.dom.window.close();
});

test("modal controls and outside controls remain operable during a pending switch", async () => {
  const reading = deferred(), started = deferred();
  const app = await boot({ handlers: {
    select_db_file: () => "/tmp/review-128.db",
    load_db_notes: () => { started.resolve(); return reading.promise; }
  } });
  app.click("db-connect-btn"); await started.promise;
  await app.emit("scratchpad-open-about");
  assert.equal(document.getElementById("about-modal-backdrop").style.display, "flex");
  key(document.getElementById("close-about-btn"), "Escape");
  assert.equal(document.getElementById("about-modal-backdrop").style.display, "none");
  await app.emit("scratchpad-open-about");
  app.click("close-about-btn");
  assert.equal(document.getElementById("about-modal-backdrop").style.display, "none");
  const modal = document.createElement("div");
  modal.setAttribute("role", "dialog");
  const confirm = document.createElement("button");
  confirm.textContent = "Confirm switch";
  confirm.onclick = () => reading.resolve(workspace);
  modal.append(confirm); document.body.append(modal);
  const outside = document.createElement("button"); let outsideClicks = 0;
  outside.onclick = () => outsideClicks++;
  document.body.append(outside);
  outside.click(); assert.equal(outsideClicks, 1);
  confirm.click(); await app.settle();
  assert.equal(getAppElement("editor").value, "workspace");
  assert.equal(document.getElementById("app").inert, false);
  app.dom.window.close();
});
