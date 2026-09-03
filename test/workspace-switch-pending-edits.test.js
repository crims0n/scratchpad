// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

const LOCAL_NOTES = [
  { id: "local", title: "Local", content: "Original local body", updatedAt: 1, isTitleLocked: true }
];
let workspaceNotes = [];

const app = await bootApp({
  storage: { scratchpad_notes: LOCAL_NOTES },
  handlers: {
    select_db_file: () => "/tmp/pending-edits.db",
    load_db_notes: () => workspaceNotes,
    load_db_folders: () => [],
    save_workspace_db: ({ notes }) => { workspaceNotes = notes; }
  }
});

test("connecting and disconnecting flush edits that are still inside the debounce window", async () => {
  const editor = document.getElementById("editor-textarea");
  editor.value = "Latest local body";
  editor.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));

  app.click("db-connect-btn");
  await app.settle(100);
  assert.equal(workspaceNotes[0].content, "Latest local body");
  assert.equal(app.read("scratchpad_notes")[0].content, "Latest local body");

  editor.value = "Latest workspace body";
  editor.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
  app.click("db-disconnect-btn");
  await app.settle(100);

  assert.equal(workspaceNotes[0].content, "Latest workspace body");
  assert.equal(document.getElementById("editor-textarea").value, "Latest local body");
});
