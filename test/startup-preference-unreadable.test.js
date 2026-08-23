// SPDX-License-Identifier: GPL-3.0-or-later

// The native preference file cannot be read — an I/O error, or contents that no
// longer parse. The workspace identity is unknown for this launch, so the app
// runs on the local-only collection and must not touch any workspace.

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

const LOCAL_NOTES = [
  { id: "local-1", title: "Local one", content: "local one body", updatedAt: 1, isTitleLocked: true }
];

const app = await bootApp({
  storage: { scratchpad_notes: LOCAL_NOTES },
  handlers: {
    load_workspace_preference: () => {
      throw new Error("could not parse native preferences");
    }
  }
});

test("an unreadable preference runs on the local collection", () => {
  assert.deepEqual(app.sidebarTitles(), ["Local one"]);
  assert.deepEqual(app.read("scratchpad_notes"), LOCAL_NOTES);
});

test("no workspace is opened or written to", () => {
  const commands = app.invocations.map(({ command }) => command);

  assert.equal(commands.includes("load_db_notes"), false);
  assert.equal(commands.includes("save_notes_db"), false);
});
