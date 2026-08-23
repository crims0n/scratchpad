// SPDX-License-Identifier: GPL-3.0-or-later

// A remembered workspace that can no longer be opened — moved, deleted, or on a
// volume that is not mounted. Start-up falls back to local mode, where the
// Disconnect button is hidden, so this path has to restore the set-aside notes
// itself or they become unreachable.

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

const LOCAL_NOTES = [
  { id: "local-1", title: "Local one", content: "local one body", updatedAt: 1, isTitleLocked: true }
];

// The mirror holds a copy of the workspace, as it would after any save made
// while that workspace was connected.
const MIRRORED_WORKSPACE_NOTES = [
  { id: "ws-1", title: "Workspace note", content: "workspace body", updatedAt: 9, isTitleLocked: true }
];

const app = await bootApp({
  storage: {
    scratchpad_notes: MIRRORED_WORKSPACE_NOTES,
    scratchpad_local_notes: LOCAL_NOTES
  },
  handlers: {
    load_workspace_preference: () => "/tmp/scratchpad-missing-workspace.db",
    load_db_notes: () => {
      throw new Error("unable to open database file");
    }
  }
});

test("an unavailable workspace restores the set-aside notes", () => {
  assert.deepEqual(app.sidebarTitles(), ["Local one"]);
  assert.deepEqual(app.read("scratchpad_notes"), LOCAL_NOTES, "the mirror is rewritten");
  assert.equal(app.read("scratchpad_local_notes"), null, "the set-aside copy is consumed");
});

test("the workspace is not left active after the failure", () => {
  const document = app.dom.window.document;

  assert.equal(document.getElementById("db-connect-btn").style.display, "block");
  assert.equal(document.getElementById("db-disconnect-btn").style.display, "none");
});
