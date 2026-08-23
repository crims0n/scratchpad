// SPDX-License-Identifier: GPL-3.0-or-later

// Connecting must not switch collections until the local-only notes are
// genuinely recoverable, because the next mirror write destroys them.

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

const LOCAL_NOTES = [
  { id: "local-1", title: "Local one", content: "local one body", updatedAt: 1, isTitleLocked: true },
  { id: "local-2", title: "Local two", content: "local two body", updatedAt: 2, isTitleLocked: true }
];

const WORKSPACE_NOTES = [
  { id: "ws-1", title: "Workspace note", content: "workspace body", updatedAt: 9, isTitleLocked: true }
];

const app = await bootApp({
  storage: { scratchpad_notes: LOCAL_NOTES },
  handlers: {
    select_db_file: () => "/tmp/scratchpad-test-workspace.db",
    load_db_notes: () => WORKSPACE_NOTES
  }
});

test("connecting is refused when the local notes cannot be set aside", async () => {
  const { Storage } = app.dom.window;
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key === "scratchpad_local_notes") throw new Error("quota exceeded");
    return setItem.call(this, key, value);
  };

  try {
    app.click("db-connect-btn");
    await app.settle();
  } finally {
    Storage.prototype.setItem = setItem;
  }

  assert.deepEqual(app.sidebarTitles(), ["Local one", "Local two"], "the editor stays on the local notes");
  assert.deepEqual(app.read("scratchpad_notes"), LOCAL_NOTES, "the mirror is untouched");
  assert.equal(
    app.invocations.some(({ command }) => command === "set_last_workspace"),
    false,
    "a refused workspace is not remembered"
  );
  assert.equal(
    app.dom.window.document.getElementById("db-disconnect-btn").style.display,
    "none",
    "the app is still in local mode"
  );
});

test("an unreadable set-aside copy is replaced rather than trusted", async () => {
  // Previously any value at all counted as preservation, so a corrupt stash
  // would wave the connection through and the local notes would be lost.
  app.storage.setItem("scratchpad_local_notes", "{ truncated");

  app.click("db-connect-btn");
  await app.settle();

  assert.deepEqual(app.sidebarTitles(), ["Workspace note"], "the workspace connects");
  assert.deepEqual(
    app.read("scratchpad_local_notes"),
    LOCAL_NOTES,
    "a readable copy replaces the unusable one"
  );
});
