// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

const LOCAL_FOLDERS = [{ id: "local-folder", name: "Local Folder" }];
const workspaceWrites = [];

const app = await bootApp({
  storage: {
    scratchpad_notes: [],
    scratchpad_folders: LOCAL_FOLDERS
  },
  handlers: {
    load_workspace_preference: () => "/tmp/empty-folder-seed.db",
    load_db_notes: () => [],
    load_db_folders: () => [],
    load_db_trash: () => [],
    save_workspace_db: ({ notes, folders }) => {
      workspaceWrites.push({ notes, folders });
    }
  }
});

test("folders-only local state seeds an empty remembered workspace", () => {
  assert.equal(workspaceWrites.length, 1);
  assert.deepEqual(workspaceWrites[0].folders, LOCAL_FOLDERS);
  assert.deepEqual(
    workspaceWrites[0].notes.map(({ title }) => title),
    ["Welcome to Scratchpad!"]
  );
  assert.deepEqual(app.sidebarTitles(), ["Welcome to Scratchpad!"]);
  assert.deepEqual(
    [...document.querySelectorAll(".note-folder-name")].map((element) => element.textContent),
    ["Local Folder"]
  );
  assert.equal(document.getElementById("workspace-menu-value").textContent, "empty-folder-seed.db");
});

test("successful seeding leaves the local-only collection untouched", () => {
  assert.deepEqual(app.read("scratchpad_notes"), []);
  assert.deepEqual(app.read("scratchpad_folders"), LOCAL_FOLDERS);
});
