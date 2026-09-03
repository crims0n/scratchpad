// SPDX-License-Identifier: GPL-3.0-or-later

// Two launches. The first cannot read the workspace preference, so the app runs
// on the local-only collection; the user edits it. The second reads the
// preference, opens the workspace, and must not take those edits with it.
//
// This is the sequence that used to lose work: local storage held whatever
// collection was active, so a workspace opening later wrote over notes it had
// never contained.

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

const WORKSPACE_PATH = "/tmp/scratchpad-two-launch-workspace.db";

const LOCAL_NOTES = [
  { id: "local-1", title: "Local one", content: "local one body", updatedAt: 1, isTitleLocked: true }
];

const WORKSPACE_NOTES = [
  { id: "ws-1", title: "Workspace note", content: "workspace body", updatedAt: 9, isTitleLocked: true }
];

const EDIT = "edited while the workspace preference was unreadable";

// --- Launch 1: the preference cannot be read ---
const first = await bootApp({
  storage: { scratchpad_notes: LOCAL_NOTES },
  handlers: {
    load_workspace_preference: () => {
      throw new Error("could not parse native preferences");
    }
  }
});

await first.type(EDIT);
const afterFirstLaunch = first.dumpStorage();

test("the indeterminate launch edits the local-only collection", () => {
  assert.deepEqual(first.sidebarTitles(), ["Local one"], "the local note, not a workspace note");
  assert.equal(JSON.parse(afterFirstLaunch.scratchpad_notes)[0].content, EDIT);
});

test("the indeterminate launch never touches a workspace", () => {
  const commands = first.invocations.map(({ command }) => command);

  assert.equal(commands.includes("load_db_notes"), false);
  assert.equal(commands.includes("save_note_db"), false);
  assert.equal(commands.includes("save_notes_db"), false);
  assert.equal(commands.includes("save_workspace_db"), false);
});

// --- Launch 2: the preference reads, the workspace opens ---
const second = await bootApp({
  instance: 2,
  storage: afterFirstLaunch,
  handlers: {
    load_workspace_preference: () => WORKSPACE_PATH,
    load_db_notes: () => WORKSPACE_NOTES
  }
});

test("the workspace opens on the next launch", () => {
  assert.deepEqual(second.sidebarTitles(), ["Workspace note"]);
});

test("the edits made while the preference was unreadable survive", async () => {
  // The overwrite only ever happened on a save, so this has to edit inside the
  // workspace rather than just check the state straight after start-up.
  await second.type("edited inside the workspace");

  assert.equal(
    second.read("scratchpad_notes")[0].content,
    EDIT,
    "a workspace session must not write over the local-only collection"
  );
});

test("disconnecting hands those edits back", async () => {
  second.click("db-disconnect-btn");
  await second.settle();

  assert.deepEqual(second.sidebarTitles(), ["Local one"]);
  assert.equal(second.read("scratchpad_notes")[0].content, EDIT);
});
