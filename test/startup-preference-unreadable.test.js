// SPDX-License-Identifier: GPL-3.0-or-later

// The native preference file cannot be read — an I/O error, or contents that no
// longer parse. That is not the same as "no workspace is configured": the file
// may still name a workspace that opens on a later launch, so the set-aside
// notes have to survive this start-up untouched.

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
    load_workspace_preference: () => {
      throw new Error("could not parse native preferences");
    }
  }
});

test("an unreadable preference leaves the set-aside notes alone", () => {
  assert.deepEqual(
    app.read("scratchpad_local_notes"),
    LOCAL_NOTES,
    "the protected copy must survive an indeterminate start-up"
  );
});

test("the mirror is left as it was", () => {
  assert.deepEqual(app.read("scratchpad_notes"), MIRRORED_WORKSPACE_NOTES);
  assert.deepEqual(app.sidebarTitles(), ["Workspace note"]);
});

test("no workspace is opened or written to", () => {
  const commands = app.invocations.map(({ command }) => command);

  assert.equal(commands.includes("load_db_notes"), false);
  assert.equal(commands.includes("save_notes_db"), false);
});
