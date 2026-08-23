// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { marked } from "marked";
import { bootApp } from "./helpers/app-harness.js";

const NOTES = [
  {
    id: "note-one",
    title: "First",
    content: "Alpha first\nsecond alpha here\nALPHA",
    updatedAt: 2,
    isTitleLocked: true
  },
  {
    id: "note-two",
    title: "Second",
    content: "No result on this note",
    updatedAt: 1,
    isTitleLocked: true
  }
];

test("Find All lists live matches and jumps to the selected result", async () => {
  const app = await bootApp({
    storage: { scratchpad_notes: NOTES },
    handlers: { load_workspace_preference: () => null }
  });
  const { document, Event, KeyboardEvent } = app.dom.window;
  app.dom.window.marked = marked;
  let scrolledPreviewMatch = null;

  // jsdom does not perform layout; provide a visual position for the active
  // backdrop mark so navigation can still verify the real scroll path.
  Object.defineProperty(app.dom.window.HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get() {
      return this.matches?.("mark.active-match") ? 480 : 0;
    }
  });
  app.dom.window.HTMLElement.prototype.scrollIntoView = function () {
    if (this.matches?.("mark.find-preview-match")) {
      scrolledPreviewMatch = this.dataset.findIndex;
    }
  };

  document.dispatchEvent(new KeyboardEvent("keydown", {
    key: "f",
    ctrlKey: true,
    bubbles: true
  }));

  const findInput = document.getElementById("find-input");
  findInput.value = "alpha";
  findInput.dispatchEvent(new Event("input", { bubbles: true }));

  const resultsToggle = document.getElementById("find-results-toggle");
  assert.equal(resultsToggle.disabled, false);
  resultsToggle.click();

  const resultsPane = document.getElementById("find-results-pane");
  assert.equal(resultsPane.style.display, "flex");
  assert.equal(document.getElementById("find-results-summary").textContent, "3 matches");
  assert.deepEqual(
    [...document.querySelectorAll(".find-result-location")].map((element) => element.textContent),
    ["Line 1", "Line 2", "Line 3"]
  );

  const highlightBeforeResize = document.querySelector("#editor-backdrop mark.active-match");
  app.dom.window.dispatchEvent(new Event("resize"));
  await app.settle(150);
  assert.notEqual(
    document.querySelector("#editor-backdrop mark.active-match"),
    highlightBeforeResize,
    "resizing redraws the editor highlights"
  );

  const editor = document.getElementById("editor-textarea");
  const firstResult = document.querySelector('[data-match-index="0"]');
  firstResult.focus();
  firstResult.dispatchEvent(new KeyboardEvent("keydown", {
    key: "ArrowDown",
    bubbles: true
  }));
  assert.equal(document.activeElement.dataset.matchIndex, "1");

  document.activeElement.click();
  assert.equal(editor.selectionStart, 19);
  assert.equal(editor.selectionEnd, 24);
  assert.equal(editor.scrollTop, 480);
  assert.equal(document.getElementById("cursor-position").textContent, "Ln 2, Col 13");
  assert.equal(document.activeElement, editor);
  assert.equal(document.querySelector(".find-result-button.active").dataset.matchIndex, "1");

  const highlightBeforeModeChange = document.querySelector("#editor-backdrop mark.active-match");
  document.getElementById("mode-preview").click();
  await app.settle(80);
  assert.notEqual(
    document.querySelector("#editor-backdrop mark.active-match"),
    highlightBeforeModeChange,
    "changing layout mode redraws the editor highlights"
  );
  assert.equal(document.querySelectorAll("mark.find-preview-match").length, 3);
  assert.equal(
    document.querySelector("mark.find-preview-match.active-match").dataset.findIndex,
    "1"
  );

  document.querySelector('[data-match-index="2"]').click();
  assert.equal(
    document.querySelector("mark.find-preview-match.active-match").dataset.findIndex,
    "2"
  );
  assert.equal(scrolledPreviewMatch, "2");

  editor.value = "alpha only";
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  await app.settle(200);
  assert.equal(document.querySelectorAll(".find-result-button").length, 1);
  assert.equal(document.querySelectorAll("mark.find-preview-match").length, 1);
  assert.equal(document.getElementById("find-results-summary").textContent, "1 match");

  document.querySelector('[data-id="note-two"]').click();
  assert.equal(document.querySelectorAll(".find-result-button").length, 0);
  assert.match(document.querySelector(".find-results-empty").textContent, /No matches/);

  document.querySelector('[data-id="note-one"]').click();
  assert.equal(document.querySelectorAll(".find-result-button").length, 1);

  document.getElementById("split-note-btn").click();
  assert.equal(resultsPane.style.display, "none");
  assert.equal(document.getElementById("secondary-pane-wrapper").style.display, "flex");

  resultsToggle.click();
  assert.equal(resultsPane.style.display, "flex");
  assert.equal(document.getElementById("secondary-pane-wrapper").style.display, "none");
});
