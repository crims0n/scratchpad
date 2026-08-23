// SPDX-License-Identifier: GPL-3.0-or-later

// A workspace was connected but the preference write failed, so the next
// start-up finds no workspace to reopen. Without a restore here the set-aside
// notes would sit in storage with no way to reach them: the Disconnect button
// only exists while a workspace is active.

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

const LOCAL_NOTES = [
  { id: "local-1", title: "Local one", content: "local one body", updatedAt: 1, isTitleLocked: true },
  { id: "local-2", title: "Local two", content: "local two body", updatedAt: 2, isTitleLocked: true }
];

const MIRRORED_WORKSPACE_NOTES = [
  { id: "ws-1", title: "Workspace note", content: "workspace body", updatedAt: 9, isTitleLocked: true }
];

const app = await bootApp({
  storage: {
    scratchpad_notes: MIRRORED_WORKSPACE_NOTES,
    scratchpad_local_notes: LOCAL_NOTES
  },
  // No workspace preference was ever stored.
  handlers: { load_workspace_preference: () => null }
});

test("starting without a workspace restores the set-aside notes", () => {
  assert.deepEqual(app.sidebarTitles(), ["Local one", "Local two"]);
  assert.deepEqual(app.read("scratchpad_notes"), LOCAL_NOTES, "the mirror is rewritten");
  assert.equal(app.read("scratchpad_local_notes"), null, "the set-aside copy is consumed");
});

test("a plain start-up with nothing set aside is untouched", () => {
  // Guards against the restore firing when there is nothing to restore.
  assert.equal(app.invocations.some(({ command }) => command === "save_notes_db"), false);
});
