// SPDX-License-Identifier: GPL-3.0-or-later

// A remembered workspace that can no longer be opened — moved, deleted, or on a
// volume that is not mounted. Start-up falls back to the local-only collection,
// which is still intact because the workspace never wrote over it.

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

const LOCAL_NOTES = [
  { id: "local-1", title: "Local one", content: "local one body", updatedAt: 1, isTitleLocked: true }
];

const app = await bootApp({
  storage: { scratchpad_notes: LOCAL_NOTES },
  handlers: {
    load_workspace_preference: () => "/tmp/scratchpad-missing-workspace.db",
    load_db_notes: () => {
      throw new Error("unable to open database file");
    }
  }
});

test("an unavailable workspace falls back to the local collection", () => {
  assert.deepEqual(app.sidebarTitles(), ["Local one"]);
  assert.deepEqual(app.read("scratchpad_notes"), LOCAL_NOTES);
});

test("the workspace is not left active after the failure", () => {
  const document = app.dom.window.document;

  assert.equal(document.getElementById("db-connect-btn").style.display, "block");
  assert.equal(document.getElementById("db-disconnect-btn").style.display, "none");
});

test("nothing is written to the unavailable workspace", () => {
  assert.equal(app.invocations.some(({ command }) => command === "save_notes_db"), false);
});
