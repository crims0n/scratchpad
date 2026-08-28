// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { bootApp } from "./helpers/app-harness.js";

test("the actions menu opens Help and returns focus to the menu button", async () => {
  await bootApp();
  const actionsButton = document.getElementById("actions-btn");
  const actionsDropdown = document.getElementById("actions-dropdown-content");
  const helpMenuButton = document.getElementById("help-menu-btn");
  const helpBackdrop = document.getElementById("help-modal-backdrop");

  actionsButton.click();
  assert.equal(actionsDropdown.classList.contains("show"), true);

  helpMenuButton.click();
  assert.equal(actionsDropdown.classList.contains("show"), false);
  assert.equal(helpBackdrop.style.display, "flex");
  assert.equal(document.getElementById("help-btn").getAttribute("aria-expanded"), "true");

  document.getElementById("close-help-btn").click();
  assert.equal(helpBackdrop.style.display, "none");
  assert.equal(document.activeElement, actionsButton);
});
