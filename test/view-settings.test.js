// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { bootApp } from "./helpers/app-harness.js";

test("editor and sidebar view settings are adjustable and persistent", async () => {
  const app = await bootApp({
    storage: {
      scratchpad_editor_zoom: "1.2",
      scratchpad_editor_line_spacing: "1.8",
      scratchpad_note_preview_lines: "2",
      scratchpad_notes: [{
        id: "preview-note",
        title: "Preview note",
        content: "First detail\nSecond detail\nThird detail",
        updatedAt: 1,
        isTitleLocked: true
      }]
    }
  });

  const root = document.documentElement;
  const actionsDropdown = document.getElementById("actions-dropdown-content");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.equal(document.querySelector(".dropdown-menu-section").textContent, "Global");
  assert.equal(document.getElementById("theme-picker-btn").textContent, "Color Themes");
  assert.deepEqual(
    [...document.querySelectorAll("#view-settings .view-setting-label")].map(label => label.textContent),
    ["Preview lines", "Zoom", "Line spacing"]
  );
  assert.deepEqual(
    [...document.querySelectorAll("#view-settings .dropdown-section-title")].map(label => label.textContent),
    ["Sidebar", "Editor"]
  );
  assert.equal(root.style.getPropertyValue("zoom"), "", "the application UI is not scaled");
  assert.match(
    styles,
    /\.editor-textarea,\s*\.editor-backdrop\s*\{[^}]*font-size:\s*var\(--editor-font-size\)/s
  );
  assert.equal(root.style.getPropertyValue("--editor-font-size"), "1.2rem");
  assert.equal(root.style.getPropertyValue("--editor-line-height"), "1.8");
  assert.equal(root.style.getPropertyValue("--note-preview-lines"), "2");
  assert.equal(document.getElementById("zoom-reset-btn").textContent, "120%");
  assert.equal(document.getElementById("line-spacing-value").textContent, "1.8×");
  assert.equal(document.getElementById("preview-lines-value").textContent, "2");
  assert.equal(document.querySelector(".note-item-snippet").textContent, "First detail\nSecond detail");

  document.getElementById("actions-btn").click();
  document.getElementById("zoom-in-btn").click();
  document.getElementById("line-spacing-increase-btn").click();
  document.getElementById("preview-lines-increase-btn").click();

  assert.equal(actionsDropdown.classList.contains("show"), true, "view controls keep the menu open");
  assert.equal(root.style.getPropertyValue("zoom"), "");
  assert.equal(root.style.getPropertyValue("--editor-font-size"), "1.3rem");
  assert.equal(root.style.getPropertyValue("--editor-line-height"), "1.9");
  assert.equal(app.storage.getItem("scratchpad_editor_zoom"), "1.3");
  assert.equal(app.storage.getItem("scratchpad_editor_line_spacing"), "1.9");
  assert.equal(app.storage.getItem("scratchpad_note_preview_lines"), "3");
  assert.equal(document.querySelector(".note-item-snippet").textContent, "First detail\nSecond detail\nThird detail");

  for (let index = 0; index < 12; index += 1) {
    document.getElementById("preview-lines-increase-btn").click();
  }
  assert.equal(document.getElementById("preview-lines-value").textContent, "10");
  assert.equal(document.getElementById("preview-lines-increase-btn").disabled, true);
  assert.equal(app.storage.getItem("scratchpad_note_preview_lines"), "10");

  const zoomOutEvent = new app.dom.window.KeyboardEvent("keydown", {
    key: "-",
    ctrlKey: true,
    bubbles: true,
    cancelable: true
  });
  document.dispatchEvent(zoomOutEvent);
  assert.equal(zoomOutEvent.defaultPrevented, true);
  assert.equal(root.style.getPropertyValue("--editor-font-size"), "1.2rem");

  document.getElementById("zoom-reset-btn").click();
  assert.equal(root.style.getPropertyValue("--editor-font-size"), "1rem");
  assert.equal(app.storage.getItem("scratchpad_editor_zoom"), "1");

  document.getElementById("line-spacing-value").click();
  assert.equal(root.style.getPropertyValue("--editor-line-height"), "1.6");
  assert.equal(app.storage.getItem("scratchpad_editor_line_spacing"), "1.6");

  document.getElementById("preview-lines-value").click();
  assert.equal(root.style.getPropertyValue("--note-preview-lines"), "2");
  assert.equal(app.storage.getItem("scratchpad_note_preview_lines"), "2");
});
