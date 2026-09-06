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
    load_workspace_preference: () => "/tmp/failing-folder-seed.db",
    load_db_notes: () => [],
    load_db_folders: () => [],
    load_db_trash: () => [],
    save_workspace_db: ({ notes, folders }) => {
      workspaceWrites.push({ notes, folders });
      throw new Error("database is read-only");
    }
  }
});

test("a failed folders-only startup seed falls back to local mode", () => {
  assert.equal(workspaceWrites.length, 1);
  assert.deepEqual(workspaceWrites[0].folders, LOCAL_FOLDERS);
  assert.deepEqual(
    workspaceWrites[0].notes.map(({ title }) => title),
    ["Welcome to Scratchpad!"]
  );
  assert.equal(document.getElementById("workspace-menu-value").textContent, "Local notes");
  assert.equal(document.getElementById("db-connect-btn").style.display, "block");
  assert.equal(document.getElementById("db-disconnect-btn").style.display, "none");
});

test("the fallback keeps local folders and persists its welcome note locally", () => {
  assert.deepEqual(app.read("scratchpad_folders"), LOCAL_FOLDERS);
  assert.deepEqual(
    app.read("scratchpad_notes").map(({ title }) => title),
    ["Welcome to Scratchpad!"]
  );
  assert.deepEqual(
    [...document.querySelectorAll(".note-folder-name")].map((element) => element.textContent),
    ["Local Folder"]
  );
});
