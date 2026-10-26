// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, getAppElement } from "./helpers/app-harness.js";

const notes = [{ id: "primary", title: "Primary", content: "original primary", updatedAt: 1, isTitleLocked: true },
  { id: "secondary", title: "Secondary", content: "original secondary", updatedAt: 1, isTitleLocked: true }];
let instance = 12700;
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
function boot(handlers = {}) {
  return bootApp({ instance: instance++, handlers: {
    load_workspace_preference: () => "/tmp/native-quit-review.db",
    load_db_notes: () => notes,
    complete_native_quit: () => true,
    ...handlers
  }, windowApi: { getCurrentWindow: () => ({
    onCloseRequested: async () => {},
    destroy: async () => { assert.fail("AppKit quit must use its reply rather than destroying the window"); }
  }) } });
}
function edit(id, value) { getAppElement(id).applyEdit({ value, selectionStart: 0, selectionEnd: 0 }); }
const replies = app => app.invocations.filter(call => call.command === "complete_native_quit").map(call => call.args);

test("native quit saves pending edits from both panes before acknowledging the exact request", async () => {
  let persisted;
  const app = await boot({ save_workspace_db: args => { persisted = structuredClone(args); } });
  app.click("split-note-btn");
  edit("editor", "pending primary"); edit("secondary-editor", "pending secondary");
  await app.emit("scratchpad-native-quit", "quit-success");
  assert.deepEqual(persisted.notes.map(note => note.content), ["pending primary", "pending secondary"]);
  assert.deepEqual(replies(app), [{ requestId: "quit-success", saved: true }]);
  app.dom.window.close();
});

test("failed native quit saves cancel termination, retain edits and permit retry", async () => {
  let fail = true, persisted;
  const app = await boot({ save_workspace_db: args => {
    if (fail) throw new Error("disk full");
    persisted = structuredClone(args);
  } });
  edit("editor", "keep this edit");
  await app.emit("scratchpad-native-quit", "failed-save");
  assert.deepEqual(replies(app), [{ requestId: "failed-save", saved: false }]);
  assert.match(document.getElementById("save-status").textContent, /quit cancelled/);
  assert.equal(getAppElement("editor").value, "keep this edit");
  assert.equal(getAppElement("editor").readOnly, false);
  fail = false;
  edit("editor", "retry edit");
  await app.emit("scratchpad-native-quit", "retry-save");
  assert.equal(persisted.notes[0].content, "retry edit");
  assert.deepEqual(replies(app).at(-1), { requestId: "retry-save", saved: true });
  app.dom.window.close();
});

test("native timeout cancellation prevents a late save from terminating the app", async () => {
  const write = deferred(), started = deferred();
  const app = await boot({ save_workspace_db: () => { started.resolve(); return write.promise; } });
  const quit = app.emit("scratchpad-native-quit", "timed-out");
  await started.promise;
  await app.emit("scratchpad-native-quit-cancelled", "timed-out");
  write.resolve();
  await quit;
  assert.deepEqual(replies(app), [], "a cancelled request cannot approve a quit later");
  assert.equal(getAppElement("editor").readOnly, false);
  edit("editor", "still editable");
  assert.equal(getAppElement("editor").value, "still editable");
  await app.emit("scratchpad-native-quit", "new-request");
  assert.deepEqual(replies(app), [{ requestId: "new-request", saved: true }]);
  app.dom.window.close();
});

test("an expired acknowledgement cannot leave the editor closing", async () => {
  const app = await boot({ complete_native_quit: () => false });
  await app.emit("scratchpad-native-quit", "expired");
  edit("editor", "editable after expiry");
  assert.equal(getAppElement("editor").value, "editable after expiry");
  assert.equal(getAppElement("editor").readOnly, false);
  app.dom.window.close();
});

test("native quit explicitly cancels while a collection switch is in progress", async () => {
  const choice = deferred(), started = deferred();
  const app = await boot({ select_db_file: () => { started.resolve(); return choice.promise; } });
  app.click("db-connect-btn");
  await started.promise;
  await app.emit("scratchpad-native-quit", "busy-switch");
  assert.deepEqual(replies(app), [{ requestId: "busy-switch", saved: false }]);
  choice.resolve(null);
  await app.settle();
  app.dom.window.close();
});

test("a stalled existing close leaves the native watchdog armed", async () => {
  const write = deferred(), started = deferred();
  let close;
  const app = await bootApp({ instance: instance++, handlers: {
    load_workspace_preference: () => "/tmp/native-quit-review.db",
    load_db_notes: () => notes,
    save_workspace_db: () => { started.resolve(); return write.promise; }
  }, windowApi: { getCurrentWindow: () => ({
    onCloseRequested: async handler => { close = handler; },
    destroy: async () => {}
  }) } });
  const closing = close({ preventDefault() {} });
  await started.promise;
  await app.emit("scratchpad-native-quit", "stalled-close");
  assert.deepEqual(replies(app), [], "do not repeatedly cancel a quit while its save is stalled");
  write.resolve();
  await closing;
  app.dom.window.close();
});
