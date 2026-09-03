// SPDX-License-Identifier: GPL-3.0-or-later

// No workspace preference stored — either none was ever set, or the write that
// would have stored one failed. Start-up runs on the local-only collection.

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

const LOCAL_NOTES = [
  { id: "local-1", title: "Local one", content: "local one body", updatedAt: 1, isTitleLocked: true },
  { id: "local-2", title: "Local two", content: "local two body", updatedAt: 2, isTitleLocked: true }
];

const app = await bootApp({
  storage: { scratchpad_notes: LOCAL_NOTES },
  handlers: { load_workspace_preference: () => null }
});

test("start-up without a workspace shows the local collection", () => {
  assert.deepEqual(app.sidebarTitles(), ["Local one", "Local two"]);
  assert.deepEqual(app.read("scratchpad_notes"), LOCAL_NOTES);
});

test("no workspace command is issued", () => {
  const commands = app.invocations.map(({ command }) => command);

  assert.equal(commands.includes("load_db_notes"), false);
  assert.equal(commands.includes("save_notes_db"), false);
  assert.equal(commands.includes("save_workspace_db"), false);
});
