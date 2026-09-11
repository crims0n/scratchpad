// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

const app = await bootApp({
  handlers: {
    import_file_native: () => ({ title: "Imported", content: "# Imported heading" })
  },
  storage: {
    scratchpad_layout_mode: "preview",
    scratchpad_notes: [
      { id: "written", title: "Written", content: "# Heading", updatedAt: 1, isTitleLocked: true }
    ]
  }
});

const appContainer = () => document.getElementById("app");
const mode = () => (
  appContainer().classList.contains("mode-preview") ? "preview"
    : appContainer().classList.contains("mode-split") ? "split"
      : "edit"
);

test("a blank scratchpad opens in edit mode instead of an empty preview", () => {
  assert.equal(mode(), "preview", "the remembered mode is restored on launch");

  document.getElementById("new-note-btn").click();

  assert.equal(mode(), "edit");
  assert.equal(document.getElementById("mode-edit").getAttribute("aria-pressed"), "true");
  assert.equal(document.getElementById("mode-preview").getAttribute("aria-pressed"), "false");
  // The buttons and the remembered mode have to agree, or the next launch
  // reopens in a mode the toolbar was not showing.
  assert.equal(app.storage.getItem("scratchpad_layout_mode"), "edit");
});

// Split still shows an editor, so a new scratchpad there is already typable and
// switching would discard a layout the user picked deliberately.
test("split mode is left alone", () => {
  document.getElementById("mode-split").click();
  document.getElementById("new-note-btn").click();

  assert.equal(mode(), "split");
  assert.equal(app.storage.getItem("scratchpad_layout_mode"), "split");
});

// An import arrives with Markdown worth rendering, so preview is the right view.
test("a scratchpad created with content keeps preview", async () => {
  document.getElementById("mode-preview").click();
  assert.equal(mode(), "preview");

  document.getElementById("import-btn").click();
  await app.settle();

  assert.equal(document.getElementById("editor-textarea").value, "# Imported heading");
  assert.equal(mode(), "preview");
  assert.equal(app.storage.getItem("scratchpad_layout_mode"), "preview");
});
