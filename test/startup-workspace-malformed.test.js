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

const app = await bootApp({
  storage: { scratchpad_notes: LOCAL_NOTES },
  handlers: {
    load_workspace_preference: () => "/tmp/scratchpad-malformed-workspace.db",
    load_db_notes: () => ({ unexpected: "shape" })
  }
});

test("a malformed response is never seeded over", () => {
  assert.equal(
    app.invocations.some(({ command }) => command === "save_workspace_db"),
    false,
    "the workspace's rows must not be deleted and rewritten"
  );
});

test("start-up falls back to the local collection", () => {
  assert.deepEqual(app.sidebarTitles(), ["Local one"]);
  assert.deepEqual(app.read("scratchpad_notes"), LOCAL_NOTES);
  assert.equal(
    app.dom.window.document.getElementById("db-disconnect-btn").style.display,
    "none"
  );
});
