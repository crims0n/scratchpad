// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

test("About exposes release notes before downloading, skip, later, offline retry, and opt-in privacy", async () => {
  let response = { version: "0.8.0", channel: "beta", notes: "# New features\n<img src=https://example.com/tracker onerror=alert(1)>", url: "https://github.com/crims0n/scratchpad/releases/tag/scratchpad-beta-v0.8.0" };
  let offline = false;
  const app = await bootApp({ handlers: {
    get_update_info: () => ({ installedVersion: "0.7.1", channel: "beta" }),
    check_for_updates: () => { if (offline) throw new Error("offline"); return response; }
  } });
  const el = (id) => document.getElementById(id);
  assert.equal(app.invocations.some(({ command }) => command === "check_for_updates"), false);
  assert.equal(el("update-automatic").checked, false);
  assert.match(el("update-privacy").textContent, /sends no notes or workspace data/);
  app.click("actions-btn");
  app.click("about-menu-btn");
  assert.equal(el("update-menu-btn"), null);
  assert.equal(app.invocations.some(({ command }) => command === "check_for_updates"), false);
  app.click("update-check-btn");
  await app.settle();
  assert.equal(el("about-modal-backdrop").style.display, "flex");
  assert.equal(el("update-channel").textContent, "Beta");
  assert.match(el("update-status").textContent, /0.8.0 is available/);
  assert.equal(el("update-release-notes").open, false);
  el("update-release-notes").querySelector("summary").click();
  assert.equal(el("update-release-notes").open, true);
  assert.equal(el("update-notes-content").textContent, response.notes);
  assert.equal(el("update-notes-content").querySelector("img"), null);
  assert.equal(app.invocations.some(({ command }) => command === "open_update_release"), false);
  app.click("update-download-btn");
  await app.settle();
  assert.deepEqual(app.invocations.at(-1), { command: "open_update_release", args: { url: response.url } });
  app.click("update-later-btn");
  assert.equal(el("about-modal-backdrop").style.display, "none");
  assert.equal(document.activeElement, el("actions-btn"));
  assert.equal(el("update-menu-indicator").hidden, false);
  assert.equal(el("update-menu-indicator").closest("button"), el("about-menu-btn"));
  app.click("about-menu-btn");
  app.click("update-skip-btn");
  assert.equal(el("update-available").hidden, true);
  assert.equal(el("update-menu-indicator").hidden, true);
  app.click("update-check-btn");
  await app.settle();
  assert.equal(el("update-available").hidden, false);
  offline = true;
  app.click("update-check-btn");
  await app.settle();
  assert.match(el("update-status").textContent, /Unable to check/);
  assert.equal(el("update-check-btn").textContent, "Retry");
  offline = false;
  response = null;
  app.click("update-check-btn");
  await app.settle();
  assert.match(el("update-status").textContent, /up to date/);
  assert.equal(el("update-available").hidden, true);
  app.dom.window.dispatchEvent(new app.dom.window.Event("pagehide"));
  app.dom.window.close();
});
