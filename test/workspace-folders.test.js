// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

const LOCAL_NOTES = [
  { id: "local", title: "Local", content: "Local body", updatedAt: 1, isTitleLocked: true, folderId: "local-folder" }
];
const LOCAL_FOLDERS = [{ id: "local-folder", name: "Local Folder" }];
let workspaceNotes = [
  { id: "workspace", title: "Workspace", content: "Workspace body", updatedAt: 2, isTitleLocked: true, folderId: "work-folder" }
];
let workspaceFolders = [{ id: "work-folder", name: "Workspace Folder" }];

const app = await bootApp({
  storage: {
    scratchpad_notes: LOCAL_NOTES,
    scratchpad_folders: LOCAL_FOLDERS
  },
  handlers: {
    select_db_file: () => "/tmp/folder-workspace.db",
    load_db_notes: () => workspaceNotes,
    load_db_folders: () => workspaceFolders,
    save_workspace_db: ({ notes, folders }) => {
      workspaceNotes = notes;
      workspaceFolders = folders;
    }
  }
});

const visibleFolders = () => [...document.querySelectorAll(".note-folder-name")]
  .map((element) => element.textContent);

test("workspace folders remain separate from local folders", async () => {
  assert.deepEqual(visibleFolders(), ["Local Folder"]);

  app.click("db-connect-btn");
  await app.settle();
  assert.deepEqual(visibleFolders(), ["Workspace Folder"]);
  assert.deepEqual(app.read("scratchpad_folders"), LOCAL_FOLDERS);

  app.click("new-folder-btn");
  const input = document.querySelector(".note-folder-input");
  input.value = "Workspace Empty Folder";
  input.dispatchEvent(new app.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await app.settle();
  assert.equal(workspaceFolders.some(({ name }) => name === "Workspace Empty Folder"), true);
  assert.deepEqual(app.read("scratchpad_folders"), LOCAL_FOLDERS);

  app.click("db-disconnect-btn");
  await app.settle();
  assert.deepEqual(visibleFolders(), ["Local Folder"]);
  assert.deepEqual(app.read("scratchpad_folders"), LOCAL_FOLDERS);
});
