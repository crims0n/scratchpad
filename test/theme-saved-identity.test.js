// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/app-harness.js";

test("a saved theme without an ID stays active when another theme is deleted and after restart", async () => {
  const legacy = { id: "legacy", name: "Legacy", background: "light-dark(white, black)", foreground: "#fff" };
  const themes = [{ id: "remove", name: "Remove", background: "#000", foreground: "#fff" },
    { name: "Active without ID", background: "#101010", foreground: "#eee" }, legacy];
  const app = await bootApp({ storage: { scratchpad_custom_themes: themes, scratchpad_active_theme: "custom_saved_1" } });
  assert.equal(app.storage.getItem("scratchpad_custom_themes"), JSON.stringify(themes));
  assert.equal(document.documentElement.style.getPropertyValue("--bg-app"), "#101010");
  const remove = [...document.querySelectorAll(".theme-card")]
    .find(card => card.querySelector(".theme-card-name")?.textContent === "Remove");
  remove.querySelector(".theme-card-delete").click();
  assert.equal(app.storage.getItem("scratchpad_active_theme"), "custom_saved_1");
  const saved = app.read("scratchpad_custom_themes");
  assert.equal(saved[0].id, "custom_saved_1");
  assert.deepEqual(saved[1], legacy);
  const next = await bootApp({ instance: 2, storage: app.dumpStorage() });
  assert.equal(next.storage.getItem("scratchpad_active_theme"), "custom_saved_1");
  assert.equal(document.querySelector(".theme-card.active .theme-card-name").textContent, "Active without ID");
  assert.equal(document.documentElement.style.getPropertyValue("--bg-app"), "#101010");
  assert.deepEqual(next.read("scratchpad_custom_themes")[1], legacy);
});
