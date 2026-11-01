// SPDX-License-Identifier: GPL-3.0-or-later

// A save that keeps failing must not trap the user: after a failed flush,
// close, quit and collection switching offer an explicit discard choice. Only
// that choice discards edits, and a successful save never asks.

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, getAppElement } from "./helpers/app-harness.js";

let instance = 15200;
const notes = [{ id: "note", title: "Note", content: "original", updatedAt: 1, isTitleLocked: true }];

async function boot({ discard, fail = true }) {
  let closeHandler, destroyed = 0;
  const app = await bootApp({ instance: instance++, handlers: {
    load_workspace_preference: () => "/tmp/save-failure-discard.db",
    load_db_notes: () => notes,
    save_workspace_db: () => { if (fail) throw new Error("read-only file system"); },
    complete_native_quit: () => true,
    confirm_discard_unsaved: () => discard
  }, windowApi: { getCurrentWindow: () => ({
    onCloseRequested: async handler => { closeHandler = handler; },
    destroy: async () => { destroyed += 1; }
  }) } });
  getAppElement("editor").applyEdit({ value: "unsaved edit", selectionStart: 0, selectionEnd: 0 });
  return { app, close: () => closeHandler({ preventDefault() {} }), destroyed: () => destroyed };
}

const prompts = app => app.invocations.filter(call => call.command === "confirm_discard_unsaved").map(call => call.args);
const commands = app => app.invocations.map(call => call.command);

test("a failed close keeps the window and edits unless discarding is chosen", async () => {
  const kept = await boot({ discard: false });
  await kept.close();
  assert.equal(kept.destroyed(), 0);
  assert.deepEqual(prompts(kept.app), [{ action: "close" }]);
  assert.match(document.getElementById("save-status").textContent, /close cancelled/);
  assert.equal(getAppElement("editor").value, "unsaved edit");
  assert.equal(getAppElement("editor").readOnly, false);
  kept.app.dom.window.close();

  const discarded = await boot({ discard: true });
  await discarded.close();
  assert.equal(discarded.destroyed(), 1);
  discarded.app.dom.window.close();
});

test("a successful save closes without asking to discard", async () => {
  const saved = await boot({ discard: true, fail: false });
  await saved.close();
  assert.equal(saved.destroyed(), 1);
  assert.deepEqual(prompts(saved.app), []);
  saved.app.dom.window.close();
});

test("a failed native quit is declined before discarding is offered", async () => {
  const kept = await boot({ discard: false });
  await kept.app.emit("scratchpad-native-quit", "kept");
  assert.equal(kept.destroyed(), 0);
  assert.equal(getAppElement("editor").value, "unsaved edit");
  kept.app.dom.window.close();

  const discarded = await boot({ discard: true });
  await discarded.app.emit("scratchpad-native-quit", "discarded");
  const order = commands(discarded.app);
  assert.ok(order.indexOf("complete_native_quit") < order.indexOf("confirm_discard_unsaved"),
    "the quit reply must be sent before the choice so the watchdog cannot prompt over it");
  assert.deepEqual(discarded.app.invocations.find(call => call.command === "complete_native_quit").args,
    { requestId: "discarded", saved: false });
  assert.deepEqual(prompts(discarded.app), [{ action: "quit" }]);
  assert.equal(discarded.destroyed(), 1);
  discarded.app.dom.window.close();
});

test("returning to local notes after a failed workspace save requires a discard choice", async () => {
  const kept = await boot({ discard: false });
  kept.app.click("db-disconnect-btn");
  await kept.app.settle();
  assert.deepEqual(prompts(kept.app), [{ action: "return-local" }]);
  assert.equal(document.getElementById("workspace-menu-value").textContent, "save-failure-discard.db");
  assert.equal(getAppElement("editor").value, "unsaved edit");
  kept.app.dom.window.close();

  const discarded = await boot({ discard: true });
  discarded.app.click("db-disconnect-btn");
  await discarded.app.settle();
  assert.equal(document.getElementById("workspace-menu-value").textContent, "Local notes");
  assert.doesNotMatch(document.getElementById("save-status").textContent, /Save failed/,
    "the workspace failure must not be reported against local notes");
  discarded.app.dom.window.close();
});
