// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

const LOCAL_NOTES = [
  { id: "local", title: "Local", content: "Local body", updatedAt: 1, isTitleLocked: true, folderId: "local-folder" }
];
const LOCAL_FOLDERS = [{ id: "local-folder", name: "Local Folder" }];

const app = await bootApp({
  storage: { scratchpad_notes: LOCAL_NOTES, scratchpad_folders: LOCAL_FOLDERS },
  handlers: {
    load_workspace_preference: () => "/tmp/malformed-folders.db",
    load_db_notes: () => [
      { id: "workspace", title: "Workspace", content: "Workspace body", updatedAt: 2, isTitleLocked: true }
    ],
    load_db_folders: () => ({ unexpected: "shape" })
  }
});

test("a malformed workspace folder response falls back without rewriting either collection", () => {
  assert.deepEqual(app.sidebarTitles(), ["Local"]);
  assert.deepEqual(
    [...document.querySelectorAll(".note-folder-name")].map((element) => element.textContent),
    ["Local Folder"]
  );
  assert.equal(app.invocations.some(({ command }) => command.startsWith("save_")), false);
  assert.deepEqual(app.read("scratchpad_notes"), LOCAL_NOTES);
  assert.deepEqual(app.read("scratchpad_folders"), LOCAL_FOLDERS);
});
