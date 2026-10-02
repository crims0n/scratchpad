// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

test("printing an empty collection never prepares a phantom note or opens a native window", async () => {
  const app = await bootApp({ storage: { scratchpad_notes: [], scratchpad_folders: [], scratchpad_trash: [] } });
  app.invocations.length = 0;
  app.click("print-note-btn");
  await app.settle();
  assert.deepEqual(app.invocations, []);
  assert.equal(document.getElementById("save-status").textContent, "Select a note to print");
  assert.equal(document.querySelectorAll("iframe").length, 0);
  assert.deepEqual(app.read("scratchpad_notes"), []);
});
