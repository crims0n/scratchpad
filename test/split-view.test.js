// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

const NOTES = [
  {
    id: "note-one",
    title: "First",
    content: "First note",
    updatedAt: 2,
    isTitleLocked: true
  },
  {
    id: "note-two",
    title: "Second",
    content: "Second note",
    updatedAt: 1,
    isTitleLocked: true
  }
];

test("closing split view immediately clears its enabled notification", async () => {
  const app = await bootApp({
    storage: { scratchpad_notes: NOTES },
    handlers: { load_workspace_preference: () => null }
  });
  const { document } = app.dom.window;
  const splitButton = document.getElementById("split-note-btn");
  const closeButton = document.getElementById("close-secondary-btn");
  const saveStatus = document.getElementById("save-status");

  assert.equal(saveStatus.textContent, "Saved");

  splitButton.click();
  assert.equal(saveStatus.textContent, "Dual-Note Split View enabled");
  assert.equal(splitButton.getAttribute("aria-pressed"), "true");

  closeButton.click();
  assert.equal(saveStatus.textContent, "Saved");
  assert.equal(splitButton.getAttribute("aria-pressed"), "false");
  assert.equal(document.getElementById("secondary-pane-wrapper").style.display, "none");
});
