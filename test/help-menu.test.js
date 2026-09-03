// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { bootApp } from "./helpers/app-harness.js";

test("the Scratchpad menu opens Help and About dialogs and returns focus", async () => {
  const app = await bootApp();
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

  actionsButton.click();
  const aboutMenuButton = document.getElementById("about-menu-btn");
  assert.equal(document.getElementById("help-menu-section").lastElementChild, aboutMenuButton);
  aboutMenuButton.click();

  const aboutBackdrop = document.getElementById("about-modal-backdrop");
  assert.equal(actionsDropdown.classList.contains("show"), false);
  assert.equal(aboutBackdrop.style.display, "flex");
  assert.equal(document.querySelectorAll(".about-description").length, 2);
  assert.match(aboutBackdrop.textContent, /open-source, local-first Markdown editor/);
  assert.match(aboutBackdrop.textContent, /without an account, cloud service, analytics, or telemetry/);
  assert.equal(document.getElementById("about-version").textContent, "0.6.0");

  document.querySelector('.about-links a[href="https://github.com/crims0n/scratchpad"]').click();
  await app.settle(20);
  assert.deepEqual(app.invocations.at(-1), {
    command: "plugin:opener|open_url",
    args: { url: "https://github.com/crims0n/scratchpad" }
  });

  document.getElementById("close-about-btn").click();
  assert.equal(aboutBackdrop.style.display, "none");
  assert.equal(document.activeElement, actionsButton);
});
