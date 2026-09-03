// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

const LOCAL_NOTES = [
  { id: "local", title: "Local", content: "Local body", updatedAt: 1, isTitleLocked: true, folderId: "local-folder" }
];
const LOCAL_FOLDERS = [{ id: "local-folder", name: "Local Folder" }];
let seededNotes = null;

const app = await bootApp({
  storage: { scratchpad_notes: LOCAL_NOTES, scratchpad_folders: LOCAL_FOLDERS },
  handlers: {
    select_db_file: () => "/tmp/folder-seed-failure.db",
    load_db_notes: () => [],
    load_db_folders: () => [],
    save_workspace_db: ({ notes }) => {
      seededNotes = notes;
      throw new Error("database is read-only");
    }
  }
});

test("a folder seed failure does not claim the workspace was connected", async () => {
  app.click("db-connect-btn");
  await app.settle();

  assert.equal(seededNotes[0].content, "Local body");
  assert.equal(document.getElementById("workspace-menu-value").textContent, "Local notes");
  assert.equal(document.getElementById("db-disconnect-btn").style.display, "none");
  assert.deepEqual(app.read("scratchpad_notes"), LOCAL_NOTES);
  assert.deepEqual(app.read("scratchpad_folders"), LOCAL_FOLDERS);
});
