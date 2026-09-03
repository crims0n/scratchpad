// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, settle } from "./helpers/app-harness.js";

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
  assert.equal(document.getElementById("note-title").parentElement.id, "primary-pane-header");
  assert.equal(document.getElementById("primary-pane-header").style.display, "flex");
  assert.equal(document.querySelector(".secondary-pane-header").children[0].id, "secondary-note-title");
  assert.equal(document.querySelector(".secondary-pane-header").children[1].id, "secondary-note-select");

  closeButton.click();
  assert.equal(saveStatus.textContent, "Saved");
  assert.equal(splitButton.getAttribute("aria-pressed"), "false");
  assert.equal(document.getElementById("secondary-pane-wrapper").style.display, "none");
  assert.equal(document.getElementById("note-title").parentElement.id, "topbar-left");
  assert.equal(document.getElementById("primary-pane-header").style.display, "none");
});

test("compare mode highlights live note differences and clears with split view", async () => {
  const app = await bootApp({
    instance: 2,
    storage: {
      scratchpad_syntax_highlighting: "true",
      scratchpad_editor_line_numbers: "true",
      scratchpad_notes: [
        { ...NOTES[0], content: "# Shared heading\nLeft old wording\nSame ending" },
        { ...NOTES[1], content: "# Shared heading\nRight new wording\nSame ending" }
      ]
    },
    handlers: { load_workspace_preference: () => null }
  });
  const { document } = app.dom.window;
  const splitButton = document.getElementById("split-note-btn");
  const compareButton = document.getElementById("compare-notes-btn");
  const compareCount = document.getElementById("compare-notes-count");
  const primaryBackdrop = document.getElementById("editor-backdrop");
  const secondaryBackdrop = document.getElementById("secondary-editor-backdrop");

  assert.equal(compareButton.hidden, true);
  splitButton.click();
  assert.equal(compareButton.hidden, false);
  assert.equal(compareButton.disabled, false);

  compareButton.click();
  assert.equal(compareButton.getAttribute("aria-pressed"), "true");
  assert.equal(compareCount.textContent, "1 changed line");
  assert.equal(
    [...primaryBackdrop.querySelectorAll(".diff-text-removed")].map((node) => node.textContent).join(" "),
    "Left old"
  );
  assert.equal(
    [...secondaryBackdrop.querySelectorAll(".diff-text-added")].map((node) => node.textContent).join(" "),
    "Right new"
  );
  assert.equal(primaryBackdrop.querySelector(".syntax-heading").textContent, "Shared heading");
  assert.equal(document.querySelectorAll("#editor-line-numbers .editor-line-number-diff-removed").length, 1);
  assert.equal(document.querySelectorAll("#secondary-editor-line-numbers .editor-line-number-diff-added").length, 1);

  const secondaryEditor = document.getElementById("secondary-editor-textarea");
  secondaryEditor.value = document.getElementById("editor-textarea").value;
  secondaryEditor.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
  await settle(30);
  assert.equal(compareCount.textContent, "No differences");
  assert.equal(primaryBackdrop.querySelector(".diff-line-removed"), null);
  assert.equal(secondaryBackdrop.querySelector(".diff-line-added"), null);

  secondaryEditor.value = "Different again";
  secondaryEditor.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
  await settle(30);
  assert.ok(primaryBackdrop.querySelector(".diff-line-removed"));

  document.getElementById("close-secondary-btn").click();
  assert.equal(compareButton.hidden, true);
  assert.equal(compareButton.getAttribute("aria-pressed"), "false");
  assert.equal(primaryBackdrop.querySelector(".diff-line-removed"), null);
});

test("switching the secondary pane to the primary note stops comparison cleanly", async () => {
  const app = await bootApp({
    instance: 3,
    storage: { scratchpad_notes: NOTES },
    handlers: { load_workspace_preference: () => null }
  });
  const { document } = app.dom.window;
  const compareButton = document.getElementById("compare-notes-btn");

  document.getElementById("split-note-btn").click();
  compareButton.click();
  assert.ok(document.getElementById("editor-backdrop").querySelector(".diff-line-removed"));

  const secondarySelect = document.getElementById("secondary-note-select");
  secondarySelect.value = "note-one";
  secondarySelect.dispatchEvent(new app.dom.window.Event("change", { bubbles: true }));

  assert.equal(compareButton.disabled, true);
  assert.equal(compareButton.getAttribute("aria-pressed"), "false");
  assert.equal(document.getElementById("editor-backdrop").querySelector(".diff-line-removed"), null);
  assert.equal(document.getElementById("secondary-editor-backdrop").querySelector(".diff-line-added"), null);
});

test("compare shows a change rail for blank lines when line numbers are off", async () => {
  const app = await bootApp({
    instance: 4,
    storage: {
      scratchpad_notes: [
        { ...NOTES[0], content: "first\nlast" },
        { ...NOTES[1], content: "first\n\nlast" }
      ]
    },
    handlers: { load_workspace_preference: () => null }
  });
  const { document } = app.dom.window;

  assert.equal(document.documentElement.classList.contains("editor-line-numbers-enabled"), false);
  document.getElementById("split-note-btn").click();
  document.getElementById("compare-notes-btn").click();

  const secondaryGutter = document.getElementById("secondary-editor-line-numbers");
  const blankLineMarker = secondaryGutter.querySelector(".editor-line-number-diff-added");
  assert.ok(blankLineMarker);
  assert.equal(blankLineMarker.dataset.lineNumber, "2");
  assert.equal(document.getElementById("compare-notes-count").textContent, "1 changed line");

  document.getElementById("compare-notes-btn").click();
  assert.equal(secondaryGutter.childNodes.length, 0);
});

test("compare is unavailable when both panes show the same note", async () => {
  const app = await bootApp({
    instance: 5,
    storage: { scratchpad_notes: [NOTES[0]] },
    handlers: { load_workspace_preference: () => null }
  });
  const compareButton = app.dom.window.document.getElementById("compare-notes-btn");

  app.dom.window.document.getElementById("split-note-btn").click();
  assert.equal(compareButton.disabled, true);
  assert.equal(compareButton.title, "Choose a different note to compare");
  assert.equal(compareButton.getAttribute("aria-pressed"), "false");
});
