// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

test("the native About menu opens the existing in-app About panel", async () => {
  const app = await bootApp();
  const editor = document.getElementById("editor-textarea");
  const backdrop = document.getElementById("about-modal-backdrop");
  editor.focus();

  await app.emit("scratchpad-open-about");

  assert.equal(backdrop.style.display, "flex");
  assert.match(backdrop.textContent, /open-source, local-first Markdown editor/);
  assert.ok(document.getElementById("update-check-btn"));
  assert.equal(document.activeElement, document.getElementById("close-about-btn"));

  // Re-selecting About while it is already open must not replace the element
  // that receives focus when the panel closes.
  await app.emit("scratchpad-open-about");
  document.getElementById("close-about-btn").click();
  assert.equal(backdrop.style.display, "none");
  assert.equal(document.activeElement, editor);
});
