// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { bootApp } from "./helpers/app-harness.js";

test("F1 opens Guide, topics follow document order, and Escape restores focus", async () => {
  const app = await bootApp({ instance: 6900 });
  const opener = document.getElementById("help-btn");
  opener.focus();
  const topics = ["guide", "shortcuts", "markdown", "mcp"];
  const press = (key, shiftKey = false) => document.dispatchEvent(new app.dom.window.KeyboardEvent("keydown", {
    key, shiftKey, bubbles: true, cancelable: true
  }));
  press("F1");
  assert.deepEqual([...document.querySelectorAll('.help-tabs [role="tab"]')].map(tab => tab.getAttribute("aria-controls")),
    [...document.querySelectorAll('.help-pane[role="tabpanel"]')].map(pane => pane.id));
  for (const active of [...topics, "guide"]) {
    for (const topic of topics) {
      const selected = topic === active;
      const button = document.getElementById(`tab-${topic}-btn`);
      const pane = document.getElementById(`pane-${topic}`);
      assert.equal(button.getAttribute("aria-selected"), String(selected));
      assert.equal(button.tabIndex, selected ? 0 : -1);
      assert.equal(pane.getAttribute("aria-hidden"), String(!selected));
      if (selected) assert.equal(document.activeElement, button);
    }
    press("Tab");
  }
  press("Tab", true);
  assert.equal(document.activeElement.id, "tab-guide-btn");
  document.getElementById("tab-guide-btn").click();
  assert.equal(document.getElementById("pane-guide").classList.contains("active"), true);
  press("Escape");
  assert.equal(document.getElementById("help-modal-backdrop").getAttribute("aria-hidden"), "true");
  assert.equal(document.activeElement, opener);
  app.dom.window.close();
});

test("the Scratchpad menu opens Help and About dialogs and returns focus", async () => {
  const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
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
  assert.equal(document.getElementById("tab-guide-btn").getAttribute("aria-selected"), "true");

  const mcpTab = document.getElementById("tab-mcp-btn");
  mcpTab.click();
  assert.equal(mcpTab.getAttribute("aria-selected"), "true");
  assert.equal(document.getElementById("pane-mcp").classList.contains("active"), true);
  assert.equal(document.getElementById("pane-markdown").getAttribute("aria-hidden"), "true");

  document.dispatchEvent(new app.dom.window.KeyboardEvent("keydown", { key: "Tab" }));
  assert.equal(document.getElementById("tab-guide-btn").getAttribute("aria-selected"), "true");

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
  assert.equal(document.getElementById("about-version").textContent, version);

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

for (const [platform, keys] of [
  ["MacIntel", ["Cmd", "Shift", "Z"]],
  ["Win32", ["Ctrl", "Y"]],
  ["Linux x86_64", ["Ctrl", "Y", "Ctrl", "Shift", "Z"]]
]) {
  test(`Redo reference shows supported keys on ${platform}`, async () => {
    const app = await bootApp({ instance: 6910 + keys.length, beforeBoot: win => {
      Object.defineProperty(win.navigator, "platform", { value: platform, configurable: true });
    } });
    const row = document.getElementById("redo-shortcut-keys");
    assert.equal(row.className, "shortcut-keys");
    assert.deepEqual([...row.querySelectorAll("kbd")].map(key => key.textContent), keys);
    app.dom.window.close();
  });
}
