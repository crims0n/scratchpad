// SPDX-License-Identifier: GPL-3.0-or-later

// Earlier commits on this branch set notes aside under their own key while
// local storage was still shared between the local-only collection and the
// active workspace. Anyone who ran those builds gets them folded back in.

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

const STASHED = [
  { id: "local-1", title: "Set aside", content: "older copy", updatedAt: 1, isTitleLocked: true },
  { id: "local-2", title: "Only stashed", content: "stashed body", updatedAt: 2, isTitleLocked: true }
];

const CURRENT = [
  { id: "local-1", title: "Set aside", content: "newer copy", updatedAt: 5, isTitleLocked: true }
];

const app = await bootApp({
  storage: {
    scratchpad_notes: CURRENT,
    scratchpad_local_notes: STASHED
  },
  handlers: { load_workspace_preference: () => null }
});

test("set-aside notes are folded back into the local collection", () => {
  const stored = app.read("scratchpad_notes");

  assert.deepEqual(
    stored.map((note) => note.id).sort(),
    ["local-1", "local-2"],
    "notes held only in the set-aside copy are kept"
  );
  assert.equal(
    stored.find((note) => note.id === "local-1").content,
    "newer copy",
    "the more recently updated version of a shared note wins"
  );
});

test("the old key is cleared once folded in", () => {
  assert.equal(app.storage.getItem("scratchpad_local_notes"), null);
});
