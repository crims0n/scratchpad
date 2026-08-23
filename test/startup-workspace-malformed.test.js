// SPDX-License-Identifier: GPL-3.0-or-later

// A remembered workspace answering with something that is not a list of notes.
// The Rust command cannot currently do this, so the cover is defensive — but
// seeding does DELETE FROM notes and rewrites, so treating a malformed response
// as an empty workspace would destroy its contents.

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

const LOCAL_NOTES = [
  { id: "local-1", title: "Local one", content: "local one body", updatedAt: 1, isTitleLocked: true }
];

const MIRRORED_WORKSPACE_NOTES = [
  { id: "ws-1", title: "Workspace note", content: "workspace body", updatedAt: 9, isTitleLocked: true }
];

const app = await bootApp({
  storage: {
    scratchpad_notes: MIRRORED_WORKSPACE_NOTES,
    scratchpad_local_notes: LOCAL_NOTES
  },
  handlers: {
    load_workspace_preference: () => "/tmp/scratchpad-malformed-workspace.db",
    load_db_notes: () => ({ unexpected: "shape" })
  }
});

test("a malformed response is never seeded over", () => {
  assert.equal(
    app.invocations.some(({ command }) => command === "save_notes_db"),
    false,
    "the workspace's rows must not be deleted and rewritten"
  );
});

test("start-up falls back to local mode with the notes restored", () => {
  assert.deepEqual(app.sidebarTitles(), ["Local one"]);
  assert.deepEqual(app.read("scratchpad_notes"), LOCAL_NOTES);
  assert.equal(app.read("scratchpad_local_notes"), null, "the set-aside copy is consumed");
  assert.equal(
    app.dom.window.document.getElementById("db-disconnect-btn").style.display,
    "none"
  );
});
